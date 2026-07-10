import { describe, expect, it, vi } from 'vitest'
import { type AlarmDeps, fireSilenceAlarm } from '../src/loops/alarm.js'
import type { LoopStatus } from '../src/loops/status.js'

const stalled: LoopStatus = {
  key: 'trading-bot',
  state: 'stalled',
  lastRun: '2026-07-05',
  lastOutcome: 'clean',
  openLoopPRs: 0,
}
const recovered: LoopStatus = { ...stalled, state: 'live' }

/** In-memory debounce state — stands in for the dataDir JSON file. */
function memDeps() {
  let state: string[] = []
  const notify = vi.fn()
  const deps: AlarmDeps = {
    readState: () => state,
    writeState: (keys) => {
      state = keys
    },
    notify,
  }
  return { deps, notify }
}

describe('fireSilenceAlarm', () => {
  it('alarms once for a persistently-stalled loop across two calls', async () => {
    const { deps, notify } = memDeps()

    const first = await fireSilenceAlarm([stalled], deps)
    expect(first).toEqual(['trading-bot'])
    expect(notify).toHaveBeenCalledTimes(1)

    const second = await fireSilenceAlarm([stalled], deps)
    expect(second).toEqual([])
    expect(notify).toHaveBeenCalledTimes(1) // debounced — no re-alarm
  })

  it('re-arms after a loop recovers, then re-stalls', async () => {
    const { deps, notify } = memDeps()

    await fireSilenceAlarm([stalled], deps)
    await fireSilenceAlarm([recovered], deps) // drops from already-alarmed set
    const again = await fireSilenceAlarm([stalled], deps)

    expect(again).toEqual(['trading-bot'])
    expect(notify).toHaveBeenCalledTimes(2)
  })

  it('ignores non-stalled loops', async () => {
    const { deps, notify } = memDeps()
    const fired = await fireSilenceAlarm([recovered], deps)
    expect(fired).toEqual([])
    expect(notify).not.toHaveBeenCalled()
  })
})
