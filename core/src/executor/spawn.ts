import { spawn } from 'node:child_process'
import type { ExecEvent, ExecResult } from './types.js'

const KILL_ESCALATION_MS = 15_000

export interface SpawnSpec {
  command: string
  args: string[]
  cwd: string
  timeoutMs: number
  /** Kill the process if it produces no output for this long. Off when unset. */
  inactivityTimeoutMs?: number
  /** SIGKILL if still alive this long after SIGTERM. Default 15s. */
  killEscalationMs?: number
  signal?: AbortSignal
  /** Map one stdout line to an event (or null to drop it). */
  parseLine: (line: string) => ExecEvent | null
  /** Extract the final output from all collected events + raw tail. */
  finalOutput: (events: ExecEvent[], rawTail: string) => string
  onEvent?: (event: ExecEvent) => void
}

function fmtDuration(ms: number): string {
  return ms >= 60_000 ? `${Math.round(ms / 60_000)}min` : `${Math.round(ms / 1000)}s`
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

    // Every kill path goes through terminate() so a SIGTERM-ignoring child is
    // always SIGKILLed after the escalation window.
    let killTimer: NodeJS.Timeout | undefined
    const terminate = () => {
      child.kill('SIGTERM')
      killTimer ??= setTimeout(
        () => child.kill('SIGKILL'),
        spec.killEscalationMs ?? KILL_ESCALATION_MS,
      )
    }

    const timer = setTimeout(() => {
      emit({ kind: 'error', text: `timed out after ${fmtDuration(spec.timeoutMs)}` })
      terminate()
    }, spec.timeoutMs)

    // Stall watchdog: a hung executor otherwise burns the whole total timeout.
    let inactivityTimer: NodeJS.Timeout | undefined
    const armInactivity = () => {
      const ms = spec.inactivityTimeoutMs
      if (!ms) return
      clearTimeout(inactivityTimer)
      inactivityTimer = setTimeout(() => {
        emit({ kind: 'error', text: `no output for ${fmtDuration(ms)} — killing stalled process` })
        terminate()
      }, ms)
    }
    armInactivity()

    const onAbort = () => terminate()
    spec.signal?.addEventListener('abort', onAbort, { once: true })

    let buffer = ''
    child.stdout.on('data', (chunk: Buffer) => {
      armInactivity()
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
      armInactivity()
      const text = chunk.toString().trim()
      if (text) emit({ kind: 'error', text: text.slice(0, 2000) })
    })

    const settle = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(inactivityTimer)
      clearTimeout(killTimer)
      spec.signal?.removeEventListener('abort', onAbort)
      const usage = [...events].reverse().find((e) => e.usage)?.usage
      resolvePromise({
        ok: exitCode === 0,
        output: spec.finalOutput(events, rawTail),
        exitCode,
        ...(usage ? { usage } : {}),
      })
    }

    child.on('error', (err) => {
      emit({ kind: 'error', text: err.message })
      settle(null)
    })
    child.on('close', (code) => settle(code))
  })
}
