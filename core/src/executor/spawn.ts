import { spawn } from 'node:child_process'
import type { ExecEvent, ExecResult } from './types.js'

export interface SpawnSpec {
  command: string
  args: string[]
  cwd: string
  timeoutMs: number
  signal?: AbortSignal
  /** Map one stdout line to an event (or null to drop it). */
  parseLine: (line: string) => ExecEvent | null
  /** Extract the final output from all collected events + raw tail. */
  finalOutput: (events: ExecEvent[], rawTail: string) => string
  onEvent?: (event: ExecEvent) => void
}

/** Shared line-streaming process runner for CLI executors. shell:false —
 * the task text is always a single argv entry, never shell-interpolated. */
export function runCli(spec: SpawnSpec): Promise<ExecResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })

    const events: ExecEvent[] = []
    let rawTail = ''
    let settled = false

    const emit = (event: ExecEvent) => {
      events.push(event)
      spec.onEvent?.(event)
    }
    emit({ kind: 'started', text: `${spec.command} in ${spec.cwd}` })

    const timer = setTimeout(() => {
      emit({ kind: 'error', text: `timed out after ${Math.round(spec.timeoutMs / 60000)}min` })
      child.kill('SIGTERM')
    }, spec.timeoutMs)

    const onAbort = () => child.kill('SIGTERM')
    spec.signal?.addEventListener('abort', onAbort, { once: true })

    let buffer = ''
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let nl
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        rawTail = line
        const event = spec.parseLine(line)
        if (event) emit(event)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      if (text) emit({ kind: 'error', text: text.slice(0, 2000) })
    })

    const settle = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      spec.signal?.removeEventListener('abort', onAbort)
      resolvePromise({
        ok: exitCode === 0,
        output: spec.finalOutput(events, rawTail),
        exitCode,
      })
    }

    child.on('error', (err) => {
      emit({ kind: 'error', text: err.message })
      settle(null)
    })
    child.on('close', (code) => settle(code))
  })
}
