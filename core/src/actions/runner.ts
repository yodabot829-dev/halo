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
  if (action.loop && history.length > 0) {
    const past = history
      .map((r) => `### ${r.id} (${r.status})\n${r.output.slice(0, 1200)}`)
      .join('\n\n')
    parts.push(
      `## Previous runs (newest first)\n${past}\n\nImprove on the previous runs: keep what worked, fix what did not, avoid repeating mistakes.`,
    )
  }
  parts.push('End your reply with a concise summary of what you did and produced.')
  return parts.join('\n\n')
}

/** One-click actions: named prompts dispatched headlessly, logged to the
 * vault, with past runs injected so each run can improve on the last. */
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

  subscribe(name: string, fn: (e: ExecEvent) => void): () => void {
    const set = this.listeners.get(name) ?? new Set()
    set.add(fn)
    this.listeners.set(name, set)
    return () => set.delete(fn)
  }

  private emit(name: string, event: ExecEvent): void {
    for (const fn of this.listeners.get(name) ?? []) fn(event)
  }

  async run(name: string): Promise<RunRecord> {
    const action = this.deps.actions.find((a) => a.name === name)
    if (!action) throw new Error(`Unknown action "${name}"`)
    if (this.running.has(name)) throw new Error(`Action "${name}" is already running`)

    const cwd = this.deps.projects[action.project]
    if (!cwd) throw new Error(`Action project "${action.project}" is not registered`)
    const executorName = action.executor ?? this.deps.defaultExecutor
    const executor = this.deps.executors.get(executorName)
    if (!executor?.available()) throw new Error(`Executor "${executorName}" unavailable`)

    const startedAt = new Date()
    const run: RunRecord = {
      id: `${startedAt.toISOString().replace(/[:.]/g, '-')}-${name}`,
      action: name,
      status: 'running',
      startedAt: startedAt.toISOString(),
      executor: executorName,
      project: action.project,
      output: '',
    }
    this.running.add(name)
    this.deps.log?.(`action ${name} started`)
    this.emit(name, { kind: 'started', text: name })

    try {
      const history = action.loop ? this.deps.runLog.recent(name, action.historyRuns) : []
      const result = await executor.execute(buildPrompt(action, history), {
        cwd,
        timeoutMs: this.deps.stepTimeoutMs,
        onEvent: (e) => this.emit(name, e),
      })
      run.status = result.ok ? 'done' : 'failed'
      run.output = result.output || `(exit ${result.exitCode})`
    } catch (err) {
      run.status = 'failed'
      run.output = (err as Error).message
    } finally {
      run.finishedAt = new Date().toISOString()
      this.running.delete(name)
      this.deps.runLog.save(run)
      this.deps.log?.(`action ${name} ${run.status}`)
      this.emit(name, { kind: 'output', text: `FINISHED ${run.status}` })
    }
    return run
  }
}
