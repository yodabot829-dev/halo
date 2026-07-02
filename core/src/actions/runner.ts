import type { HaloConfig } from '../config/schema.js'
import type { ExecEvent, Executor } from '../executor/types.js'
import { RunLog, type RunRecord } from './run-log.js'

type ActionConfig = HaloConfig['actions'][number]

export interface RunnerDeps {
  actions: readonly ActionConfig[]
  executors: Map<string, Executor>
  defaultExecutor: string
  projects: Record<string, string>
  runLog: RunLog
  stepTimeoutMs: number
  log?: (msg: string) => void
}

function buildPrompt(action: ActionConfig, history: RunRecord[]): string {
  const parts = [action.prompt]
  if (action.approval) {
    parts.push(
      'IMPORTANT: this is a DRAFT phase. Produce the draft/plan only — take no side-effecting steps (no sending, publishing, moving, or deleting anything). A human will review it.',
    )
  }
  if (action.loop && history.length > 0) {
    const past = history
      .map((r) => {
        const feedback = r.feedback ? `\nREVIEWER FEEDBACK: ${r.feedback}` : ''
        return `### ${r.id} (${r.status})${feedback}\n${r.output.slice(0, 1200)}`
      })
      .join('\n\n')
    parts.push(
      `## Previous runs (newest first)\n${past}\n\nImprove on the previous runs: keep what worked, fix what did not, address any reviewer feedback, avoid repeating mistakes.`,
    )
  }
  parts.push('End your reply with a concise summary of what you did and produced.')
  return parts.join('\n\n')
}

/** One-click actions: named prompts dispatched headlessly, logged to the
 * vault, with past runs injected so each run can improve on the last.
 * Approval actions run in two phases: draft → human approval → apply. */
export class ActionRunner {
  private readonly deps: RunnerDeps
  private readonly running = new Set<string>()
  private readonly listeners = new Map<string, Set<(e: ExecEvent) => void>>()

  constructor(deps: RunnerDeps) {
    this.deps = deps
  }

  list(): (ActionConfig & { running: boolean; lastRun?: RunRecord })[] {
    return this.deps.actions.map((a) => ({
      ...a,
      running: this.running.has(a.name),
      lastRun: this.deps.runLog.recent(a.name, 1)[0],
    }))
  }

  isRunning(name: string): boolean {
    return this.running.has(name)
  }

  runningNames(): string[] {
    return [...this.running]
  }

  subscribe(name: string, fn: (e: ExecEvent) => void): () => void {
    const set = this.listeners.get(name) ?? new Set()
    set.add(fn)
    this.listeners.set(name, set)
    return () => set.delete(fn)
  }

  private emit(name: string, event: ExecEvent): void {
    for (const fn of this.listeners.get(name) ?? []) fn(event)
  }

  private action(name: string): ActionConfig {
    const action = this.deps.actions.find((a) => a.name === name)
    if (!action) throw new Error(`Unknown action "${name}"`)
    return action
  }

  async run(name: string): Promise<RunRecord> {
    const action = this.action(name)
    const history = action.loop ? this.deps.runLog.recent(name, action.historyRuns) : []
    return this.dispatch(action, buildPrompt(action, history), {
      ...(action.approval ? { phase: 'draft' as const } : {}),
    })
  }

  /** Approve a draft: mark it approved and dispatch the apply phase with the
   * approved draft injected verbatim. */
  async approve(name: string, runId: string): Promise<RunRecord> {
    const action = this.action(name)
    const draft = this.deps.runLog.get(name, runId)
    if (!draft || draft.status !== 'awaiting_approval') {
      throw new Error(`Run "${runId}" is not awaiting approval`)
    }
    this.deps.runLog.save({ ...draft, status: 'approved' })
    const prompt = `${action.applyPrompt}\n\n## Approved draft\n${draft.output}`
    return this.dispatch(action, prompt, { phase: 'apply', appliedFrom: draft.id })
  }

  reject(name: string, runId: string, feedback: string): RunRecord {
    const draft = this.deps.runLog.get(name, runId)
    if (!draft || draft.status !== 'awaiting_approval') {
      throw new Error(`Run "${runId}" is not awaiting approval`)
    }
    const rejected: RunRecord = { ...draft, status: 'rejected', feedback }
    this.deps.runLog.save(rejected)
    this.deps.log?.(`action ${name} draft rejected`)
    return rejected
  }

  awaitingApproval(): RunRecord[] {
    return this.deps.actions
      .flatMap((a) => this.deps.runLog.recent(a.name, 5))
      .filter((r) => r.status === 'awaiting_approval')
  }

  private async dispatch(
    action: ActionConfig,
    prompt: string,
    extra: Partial<RunRecord>,
  ): Promise<RunRecord> {
    if (this.running.has(action.name)) throw new Error(`Action "${action.name}" is already running`)
    const cwd = this.deps.projects[action.project]
    if (!cwd) throw new Error(`Action project "${action.project}" is not registered`)
    const executorName = action.executor ?? this.deps.defaultExecutor
    const executor = this.deps.executors.get(executorName)
    if (!executor?.available()) throw new Error(`Executor "${executorName}" unavailable`)

    const startedAt = new Date()
    const run: RunRecord = {
      id: `${startedAt.toISOString().replace(/[:.]/g, '-')}-${action.name}`,
      action: action.name,
      status: 'running',
      startedAt: startedAt.toISOString(),
      executor: executorName,
      project: action.project,
      output: '',
      ...extra,
    }
    this.running.add(action.name)
    this.deps.log?.(`action ${action.name} started (${run.phase ?? 'single'})`)
    this.emit(action.name, { kind: 'started', text: action.name })

    try {
      const result = await executor.execute(prompt, {
        cwd,
        timeoutMs: this.deps.stepTimeoutMs,
        onEvent: (e) => this.emit(action.name, e),
      })
      if (!result.ok) {
        run.status = 'failed'
      } else if (run.phase === 'draft') {
        run.status = 'awaiting_approval'
      } else {
        run.status = 'done'
      }
      run.output = result.output || `(exit ${result.exitCode})`
    } catch (err) {
      run.status = 'failed'
      run.output = (err as Error).message
    } finally {
      run.finishedAt = new Date().toISOString()
      this.running.delete(action.name)
      this.deps.runLog.save(run)
      this.deps.log?.(`action ${action.name} ${run.status}`)
      this.emit(action.name, { kind: 'output', text: `FINISHED ${run.status}` })
    }
    return run
  }
}
