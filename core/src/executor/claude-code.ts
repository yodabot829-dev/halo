import { runCli } from './spawn.js'
import type { ExecEvent, Executor, ExecuteOptions, ExecResult } from './types.js'
import { binaryExists } from './which.js'

/** One line of `claude -p --output-format stream-json` → event. Exported
 * for direct unit testing. */
export function parseClaudeLine(line: string): ExecEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  const obj = parsed as Record<string, unknown>
  if (obj['type'] === 'assistant') {
    const message = obj['message'] as { content?: { type: string; text?: string }[] } | undefined
    const text = (message?.content ?? [])
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text)
      .join('\n')
    return text ? { kind: 'output', text } : null
  }
  if (obj['type'] === 'result') {
    const text = typeof obj['result'] === 'string' ? obj['result'] : JSON.stringify(obj['result'])
    return { kind: 'output', text: `RESULT: ${text}` }
  }
  return null
}

export class ClaudeCodeExecutor implements Executor {
  readonly name = 'claude-code'
  private readonly command: string
  private readonly extraArgs: string[]

  constructor(command = 'claude', extraArgs: string[] = ['--permission-mode', 'acceptEdits']) {
    this.command = command
    this.extraArgs = extraArgs
  }

  available(): boolean {
    return binaryExists(this.command)
  }

  execute(task: string, opts: ExecuteOptions): Promise<ExecResult> {
    return runCli({
      command: this.command,
      args: ['-p', task, '--output-format', 'stream-json', '--verbose', ...this.extraArgs],
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      parseLine: parseClaudeLine,
      finalOutput: (events) => {
        const result = [...events].reverse().find((e) => e.text.startsWith('RESULT: '))
        if (result) return result.text.slice('RESULT: '.length)
        return events
          .filter((e) => e.kind === 'output')
          .map((e) => e.text)
          .join('\n')
          .slice(-8000)
      },
      onEvent: opts.onEvent,
    })
  }
}
