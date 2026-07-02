export interface ExecEvent {
  kind: 'started' | 'output' | 'error'
  text: string
}

export interface ExecResult {
  ok: boolean
  /** Final assistant output (result text), not the full transcript. */
  output: string
  exitCode: number | null
}

export interface ExecuteOptions {
  cwd: string
  signal?: AbortSignal
  timeoutMs: number
  onEvent?: (event: ExecEvent) => void
}

/** A worker that can carry out a coding/ops task in a project directory.
 * Implementations: claude-code (default), codex — swappable via config. */
export interface Executor {
  readonly name: string
  available(): boolean
  execute(task: string, opts: ExecuteOptions): Promise<ExecResult>
}
