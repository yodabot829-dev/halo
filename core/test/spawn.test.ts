import { describe, expect, it } from 'vitest'
import { runCli, type SpawnSpec } from '../src/executor/spawn.js'
import type { ExecEvent } from '../src/executor/types.js'

// Real child processes (plain `node -e`, never an LLM CLI) — the watchdog and
// kill escalation are process-level behaviours a mock cannot prove.
function makeSpec(script: string, overrides: Partial<SpawnSpec> = {}) {
  const events: ExecEvent[] = []
  const spec: SpawnSpec = {
    command: process.execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    timeoutMs: 10_000,
    parseLine: (line) => ({ kind: 'output', text: line }),
    finalOutput: (evts) =>
      evts
        .filter((e) => e.kind === 'output')
        .map((e) => e.text)
        .join('\n'),
    onEvent: (e) => events.push(e),
    ...overrides,
  }
  return { events, spec }
}

describe('runCli usage propagation', () => {
  it('surfaces the last parsed usage on the result', async () => {
    const { spec } = makeSpec('console.log("done")', {
      parseLine: (line) => ({
        kind: 'output',
        text: line,
        usage: { inputTokens: 7, outputTokens: 3 },
      }),
    })
    const result = await runCli(spec)
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 })
  })
})

describe('runCli stall watchdog', () => {
  it('kills a silent process after the inactivity timeout', async () => {
    const { events, spec } = makeSpec('setInterval(() => {}, 1000)', {
      inactivityTimeoutMs: 200,
    })
    const started = Date.now()
    const result = await runCli(spec)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(result.ok).toBe(false)
    expect(events.some((e) => e.kind === 'error' && /no output for/.test(e.text))).toBe(true)
  })

  it('does not fire while the process keeps producing output', async () => {
    const script =
      'let i = 0; const t = setInterval(() => { console.log("tick" + i); if (++i >= 6) clearInterval(t) }, 50)'
    const { events, spec } = makeSpec(script, { inactivityTimeoutMs: 500 })
    const result = await runCli(spec)
    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(events.filter((e) => e.kind === 'error')).toEqual([])
  })

  it('escalates SIGTERM to SIGKILL when the process refuses to die', async () => {
    // Traps SIGTERM and lives on; only SIGKILL can end it.
    const script = 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'
    const { spec } = makeSpec(script, { timeoutMs: 200, killEscalationMs: 300 })
    const started = Date.now()
    const result = await runCli(spec)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(result.ok).toBe(false)
    expect(result.exitCode).not.toBe(0)
  })
})
