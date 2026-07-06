import type { Executor } from '../executor/types.js'
import type { CallRecord } from '../meter/meter.js'
import type { Goal, GoalStore } from './goal-file.js'

export interface Verdict {
  met: boolean
  feedback: string
}

export type Judge = (goal: Goal, executorOutput: string) => Promise<Verdict>

export interface GoalEvent {
  kind: 'status' | 'output' | 'error'
  text: string
}

/** Narrow meter surface — the engine only records, never queries. */
export interface UsageRecorder {
  record(call: CallRecord): void
}

export interface EngineDeps {
  store: GoalStore
  executors: Map<string, Executor>
  /** Registered project name → absolute path. Executors run nowhere else. */
  projects: Record<string, string>
  judge: Judge
  maxIterations: number
  stepTimeoutMs: number
  /** Max goals running at once across all projects. */
  maxConcurrent: number
  /** Kill an executor step that produces no output for this long. Off when unset. */
  inactivityTimeoutMs?: number
  /** Records executor token/cost usage (taskClass goal-exec). Off when unset. */
  meter?: UsageRecorder
  /** Fired once when a goal finishes as done or failed (not stopped). */
  notify?: (goal: Goal) => void
}

function buildTaskPrompt(goal: Goal, feedback: string | null, goalFilePath: string): string {
  const parts = [
    `You are completing a goal in this repository.`,
    `## Objective\n${goal.objective}`,
    `## Success criteria\n${goal.criteria.map((c) => `- ${c}`).join('\n')}`,
  ]
  if (goal.plan || goal.doneSoFar) {
    parts.push(
      `## Your checkpoint from the previous iteration\n### Plan\n${goal.plan || '(none)'}\n### Done so far\n${goal.doneSoFar || '(none)'}`,
    )
  }
  if (feedback) {
    parts.push(
      `## Reviewer feedback on the previous attempt\n${feedback}\nAddress this feedback specifically.`,
    )
  }
  parts.push(
    `Maintain your checkpoint in the goal file at ${goalFilePath}: keep its "## Plan" and "## Done so far" sections up to date (edit only those two sections) so the next iteration can resume without losing context.`,
    'Work directly in the repo. When finished, summarise concretely what you changed and how each success criterion is met.',
  )
  return parts.join('\n\n')
}

/** Dispatch → judge → iterate until criteria pass, max iterations hit,
 * or a human stops it. Goal files are updated at every step. */
export class GoalEngine {
  private readonly deps: EngineDeps
  private readonly running = new Map<string, { abort: AbortController; project: string }>()
  private readonly listeners = new Map<string, Set<(e: GoalEvent) => void>>()

  constructor(deps: EngineDeps) {
    this.deps = deps
  }

  isRunning(id: string): boolean {
    return this.running.has(id)
  }

  subscribe(id: string, fn: (e: GoalEvent) => void): () => void {
    const set = this.listeners.get(id) ?? new Set()
    set.add(fn)
    this.listeners.set(id, set)
    return () => set.delete(fn)
  }

  private emit(goal: Goal, event: GoalEvent): void {
    // The executor edits the goal file's checkpoint sections while we hold a
    // stale copy — re-read them so our saves never clobber its progress.
    const onDisk = this.deps.store.get(goal.id)
    if (onDisk) {
      goal.plan = onDisk.plan
      goal.doneSoFar = onDisk.doneSoFar
    }
    goal.log.push(`${new Date().toISOString()} [${event.kind}] ${event.text.slice(0, 500).replace(/\n/g, ' ')}`)
    this.deps.store.save(goal)
    for (const fn of this.listeners.get(goal.id) ?? []) fn(event)
  }

  stop(id: string): boolean {
    const entry = this.running.get(id)
    if (!entry) return false
    entry.abort.abort()
    return true
  }

  async run(id: string): Promise<Goal> {
    const { store, executors, projects, judge, maxIterations, stepTimeoutMs, maxConcurrent } =
      this.deps
    const goal = store.get(id)
    if (!goal) throw new Error(`Unknown goal "${id}"`)
    if (this.running.has(id)) throw new Error(`Goal "${id}" is already running`)

    const cwd = projects[goal.project]
    if (!cwd) throw new Error(`Goal project "${goal.project}" is not a registered project`)
    const executor = executors.get(goal.executor)
    if (!executor) throw new Error(`Unknown executor "${goal.executor}"`)
    if (!executor.available()) throw new Error(`Executor "${goal.executor}" is not installed`)

    if (this.running.size >= maxConcurrent) {
      throw new Error(
        `Goal concurrency limit reached (${this.running.size}/${maxConcurrent} running) — stop a goal or raise goals.maxConcurrent`,
      )
    }
    for (const [otherId, other] of this.running) {
      if (other.project === goal.project) {
        throw new Error(`Project "${goal.project}" already has goal "${otherId}" running`)
      }
    }

    const abort = new AbortController()
    this.running.set(id, { abort, project: goal.project })
    goal.status = 'running'
    this.emit(goal, { kind: 'status', text: `running with ${executor.name} in ${goal.project}` })

    let feedback: string | null = null
    try {
      for (let i = 1; i <= maxIterations; i++) {
        goal.iterations = i
        this.emit(goal, { kind: 'status', text: `iteration ${i}/${maxIterations}` })

        const result = await executor.execute(buildTaskPrompt(goal, feedback, store.pathFor(id)), {
          cwd,
          signal: abort.signal,
          timeoutMs: stepTimeoutMs,
          inactivityTimeoutMs: this.deps.inactivityTimeoutMs,
          onEvent: (e) => this.emit(goal, { kind: e.kind === 'error' ? 'error' : 'output', text: e.text }),
        })

        if (result.usage) {
          this.deps.meter?.record({
            provider: goal.executor,
            model: result.usage.model ?? goal.executor,
            taskClass: 'goal-exec',
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            ok: result.ok,
            ...(result.usage.costUsd !== undefined ? { costUsd: result.usage.costUsd } : {}),
          })
        }

        if (abort.signal.aborted) {
          goal.status = 'stopped'
          this.emit(goal, { kind: 'status', text: 'stopped by user' })
          return goal
        }
        if (!result.ok) {
          feedback = `The executor exited with code ${result.exitCode}. Output tail:\n${result.output.slice(-1500)}`
          this.emit(goal, { kind: 'error', text: `executor failed (exit ${result.exitCode})` })
          continue
        }

        const verdict = await judge(goal, result.output)
        if (verdict.met) {
          goal.status = 'done'
          this.emit(goal, { kind: 'status', text: `criteria met — ${verdict.feedback.slice(0, 300)}` })
          return goal
        }
        feedback = verdict.feedback
        this.emit(goal, { kind: 'status', text: `criteria not met — ${verdict.feedback.slice(0, 300)}` })
      }
      goal.status = 'failed'
      this.emit(goal, { kind: 'status', text: `max iterations reached — needs human review` })
      return goal
    } catch (err) {
      goal.status = abort.signal.aborted ? 'stopped' : 'failed'
      this.emit(goal, { kind: 'error', text: (err as Error).message })
      return goal
    } finally {
      this.running.delete(id)
      store.save(goal)
      if (goal.status === 'done' || goal.status === 'failed') this.deps.notify?.(goal)
    }
  }
}
