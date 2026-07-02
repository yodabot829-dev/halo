import { runCli } from './spawn.js'
import type { Executor, ExecuteOptions, ExecResult } from './types.js'
import { binaryExists } from './which.js'

/** OpenAI Codex CLI worker — same interface as claude-code, so the primary
 * executor is a config change, not a rewrite. */
export class CodexExecutor implements Executor {
  readonly name = 'codex'
  private readonly command: string
  private readonly extraArgs: string[]

  constructor(command = 'codex', extraArgs: string[] = []) {
    this.command = command
    this.extraArgs = extraArgs
  }

  available(): boolean {
    return binaryExists(this.command)
  }

  execute(task: string, opts: ExecuteOptions): Promise<ExecResult> {
    return runCli({
      command: this.command,
      args: ['exec', ...this.extraArgs, task],
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      parseLine: (line) => ({ kind: 'output', text: line }),
      finalOutput: (events) =>
        events
          .filter((e) => e.kind === 'output')
          .map((e) => e.text)
          .join('\n')
          .slice(-8000),
      onEvent: opts.onEvent,
    })
  }
}
