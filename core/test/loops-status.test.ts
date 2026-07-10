import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  cadenceMsFromPlist,
  computeLoopStatuses,
  LOOP_KEYS,
  type LoopInputs,
  type LoopKey,
  parseLaunchctl,
  parseRunnerLog,
  parseScoreboard,
} from '../src/loops/status.js'

const run = promisify(execFile)
const NOW = new Date('2026-07-10T12:00:00Z').getTime()
const DAILY_PLIST = '<key>StartCalendarInterval</key><dict><key>Hour</key><integer>2</integer></dict>'

const SCOREBOARD = `# Scoreboard
| Date | Loop | Item | PR / NO-OP | Outcome |
|---|---|---|---|---|
| 2026-07-05 | piq | old item | NO-OP | fine |
| 2026-07-10 | piq | fresh item | https://github.com/x/y/pull/55 | PR open, all green |
| 2026-07-07 | trading-bot | stale item | NO-OP | clean no-op |
| 2026-07-10 | etsy | broke | NO-OP | failed: session limit hit |
`

// piq: daily + fresh row → live. trading-bot: daily + 3-day-old row → stalled.
// etsy: outcome says "failed" → errored. journeyforce: paused sentinel.
// halo: no plist + no row → unknown.
function inputs(overrides: Partial<LoopInputs> = {}): LoopInputs {
  return {
    scoreboard: SCOREBOARD,
    sentinels: new Set(['PAUSED-journeyforce']),
    runnerLog: '[piq] finished rc=0\n[trading-bot] finished rc=0\n',
    launchctl: null,
    plists: {
      piq: DAILY_PLIST,
      'trading-bot': DAILY_PLIST,
      etsy: DAILY_PLIST,
      journeyforce: DAILY_PLIST,
      halo: null,
    },
    now: NOW,
    ...overrides,
  }
}

const byKey = (arr: ReturnType<typeof computeLoopStatuses>, k: LoopKey) => arr.find((s) => s.key === k)!

describe('computeLoopStatuses', () => {
  it('classifies each loop by its distinct signal', () => {
    const s = computeLoopStatuses(inputs())
    expect(byKey(s, 'piq').state).toBe('live')
    expect(byKey(s, 'trading-bot').state).toBe('stalled')
    expect(byKey(s, 'etsy').state).toBe('errored')
    expect(byKey(s, 'journeyforce').state).toBe('paused')
    expect(byKey(s, 'halo').state).toBe('unknown')
  })

  it('global PAUSED overrides every loop', () => {
    const s = computeLoopStatuses(inputs({ sentinels: new Set(['PAUSED']) }))
    expect(s.every((x) => x.state === 'paused')).toBe(true)
  })

  it('errors on a non-zero runner rc even with a clean outcome', () => {
    const s = computeLoopStatuses(inputs({ runnerLog: '[piq] finished rc=1\n' }))
    expect(byKey(s, 'piq').state).toBe('errored')
  })

  it('surfaces last outcome + open PR count from the scoreboard', () => {
    const piq = byKey(computeLoopStatuses(inputs()), 'piq')
    expect(piq.lastRun).toBe('2026-07-10')
    expect(piq.lastOutcome).toContain('PR open')
    expect(piq.openLoopPRs).toBe(1)
  })

  it('never throws when every source is missing', () => {
    const s = computeLoopStatuses({
      scoreboard: null,
      sentinels: new Set(),
      runnerLog: null,
      launchctl: null,
      plists: Object.fromEntries(LOOP_KEYS.map((k) => [k, null])) as Record<LoopKey, null>,
      now: NOW,
    })
    expect(s.every((x) => x.state === 'unknown')).toBe(true)
  })
})

describe('parsers', () => {
  it('cadence: StartInterval is exact seconds→ms', () => {
    expect(cadenceMsFromPlist('<key>StartInterval</key><integer>3600</integer>')).toBe(3_600_000)
  })
  it('cadence: Weekday=weekly, Hour=daily, absent=unknown', () => {
    expect(cadenceMsFromPlist('<key>StartCalendarInterval</key><key>Weekday</key>')).toBe(7 * 86_400_000)
    expect(cadenceMsFromPlist(DAILY_PLIST)).toBe(86_400_000)
    expect(cadenceMsFromPlist(null)).toBeNull()
  })
  it('runner log keeps the last rc per key', () => {
    const m = parseRunnerLog('[piq] finished rc=1\n[piq] finished rc=0\n')
    expect(m.get('piq')).toBe(0)
  })
  it('launchctl: PID<TAB>Status<TAB>Label → status by key', () => {
    const m = parseLaunchctl('-\t2\tcom.shumon.loop.halo\n123\t0\tcom.apple.other')
    expect(m.get('halo')).toBe(2)
    expect(m.size).toBe(1)
  })
  it('scoreboard ignores non-loop rows', () => {
    expect(parseScoreboard('| 2026-07-10 | notaloop | x | NO-OP | ok |').size).toBe(0)
  })
})

// Required non-mocked artifact: parse the REAL `launchctl list` format.
describe('launchctl integration', () => {
  it('parses the real launchctl list output', async () => {
    let stdout: string
    try {
      ;({ stdout } = await run('launchctl', ['list']))
    } catch (err) {
      // launchctl absent or blocked (e.g. sandbox deny-list) — skip, don't fake.
      console.warn(`SKIP launchctl integration: ${(err as Error).message}`)
      return
    }
    // Header is "PID\tStatus\tLabel"; parser must accept it without throwing.
    expect(stdout).toContain('\t')
    const map = parseLaunchctl(stdout)
    for (const [key, status] of map) {
      expect(LOOP_KEYS).toContain(key)
      expect(Number.isFinite(status)).toBe(true)
    }
  })
})
