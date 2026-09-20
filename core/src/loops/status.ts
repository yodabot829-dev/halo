// Read-only health monitor for the launchd "improvement loops". Pure functions
// take already-read file contents / command output as inputs so the whole
// classifier is unit-testable without touching the real system. Nothing here
// ever writes to a scoreboard, sentinel, plist or launchd — READ ONLY.

/** The five loop keys, matching the scoreboard control panel. */
export const LOOP_KEYS = ['piq', 'trading-bot', 'journeyforce', 'etsy', 'halo', 'app-framework'] as const
export type LoopKey = (typeof LOOP_KEYS)[number]

export type LoopState = 'live' | 'paused' | 'stalled' | 'errored' | 'unknown'

export interface LoopStatus {
  key: LoopKey
  state: LoopState
  /** ISO date of the last scoreboard row for this loop, if any. */
  lastRun: string | null
  /** Outcome cell of the last scoreboard row, if any. */
  lastOutcome: string | null
  /** Scoreboard rows for this loop whose PR/NO-OP cell is a PR link. */
  openLoopPRs: number
}

/** Inputs — every field is content already read from disk / a command. A null
 *  field means that source was missing or unreadable (never a crash). */
export interface LoopInputs {
  /** LOOP-SCOREBOARD.md content. */
  scoreboard: string | null
  /** PAUSED sentinel names present, e.g. {'PAUSED'} or {'PAUSED-piq'}. */
  sentinels: ReadonlySet<string>
  /** runner.log content (`[key] finished rc=N` lines). */
  runnerLog: string | null
  /** Raw `launchctl list` output. */
  launchctl: string | null
  /** Per-key plist XML (null = plist missing). */
  plists: Readonly<Record<LoopKey, string | null>>
  now: number
}

const DAY_MS = 24 * 3600 * 1000
const STALL_FACTOR = 1.5

/** Last scoreboard row per loop key + a PR count. Naive pipe-table parse.
 *  ponytail: positional `| Date | Loop | Item | PR/NO-OP | Outcome |` parse,
 *  swap for a real markdown-table lib only if the scoreboard format changes. */
export function parseScoreboard(md: string | null): Map<LoopKey, { date: string; outcome: string; prs: number }> {
  const out = new Map<LoopKey, { date: string; outcome: string; prs: number }>()
  if (!md) return out
  for (const line of md.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 5) continue
    const [date, loop, , pr, outcome] = cells as [string, string, string, string, string]
    if (!isLoopKey(loop) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const prev = out.get(loop)
    const prs = (prev?.prs ?? 0) + (/pull\//.test(pr) ? 1 : 0)
    out.set(loop, { date, outcome, prs }) // later row wins as "last"
  }
  return out
}

/** Last exit code per loop key from runner.log `[key] finished rc=N` lines. */
export function parseRunnerLog(log: string | null): Map<LoopKey, number> {
  const out = new Map<LoopKey, number>()
  if (!log) return out
  const re = /\[([a-z-]+)\]\s+finished\s+rc=(-?\d+)/g
  for (const m of log.matchAll(re)) {
    const key = m[1] ?? ''
    if (isLoopKey(key)) out.set(key, Number(m[2])) // later line wins
  }
  return out
}

/** Map loop label → last exit status from `launchctl list` (PID<TAB>Status<TAB>Label). */
export function parseLaunchctl(out: string | null): Map<LoopKey, number> {
  const map = new Map<LoopKey, number>()
  if (!out) return map
  for (const line of out.split('\n')) {
    const cols = line.split('\t')
    if (cols.length < 3) continue
    const key = cols[2]?.replace(/^com\.shumon\.loop\./, '') ?? ''
    const status = Number(cols[1])
    if (isLoopKey(key) && Number.isFinite(status)) map.set(key, status)
  }
  return map
}

/** Cadence in ms from a plist. StartInterval is exact; StartCalendarInterval is
 *  bucketed by its coarsest key. ponytail: Weekday→7d / Hour→1d / Minute→1h
 *  heuristic — good enough for the fixed generator, not a full cron model. */
export function cadenceMsFromPlist(xml: string | null): number | null {
  if (!xml) return null
  const interval = xml.match(/<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/)
  if (interval) return Number(interval[1]) * 1000
  if (!/<key>StartCalendarInterval<\/key>/.test(xml)) return null
  if (/<key>Weekday<\/key>/.test(xml)) return 7 * DAY_MS
  if (/<key>Hour<\/key>/.test(xml)) return DAY_MS
  if (/<key>Minute<\/key>/.test(xml)) return 3600 * 1000
  return null
}

const FAIL_RE = /\b(fail(?:ed|ure)?|errored|blocked|aborted)\b/i

/** Classify one loop. Precedence: paused → errored → stalled → live → unknown. */
function classify(key: LoopKey, i: LoopInputs, ctx: ClassifyCtx): LoopStatus {
  const row = ctx.scoreboard.get(key)
  const base = { key, lastRun: row?.date ?? null, lastOutcome: row?.outcome ?? null, openLoopPRs: row?.prs ?? 0 }
  const paused = i.sentinels.has('PAUSED') || i.sentinels.has(`PAUSED-${key}`)
  if (paused) return { ...base, state: 'paused' }

  const rc = ctx.runner.get(key) ?? ctx.launchd.get(key)
  const errored = (rc !== undefined && rc !== 0) || (row ? FAIL_RE.test(row.outcome) : false)
  if (errored) return { ...base, state: 'errored' }

  const cadence = cadenceMsFromPlist(i.plists[key])
  if (cadence && row) {
    const ageMs = i.now - Date.parse(`${row.date}T00:00:00`)
    if (ageMs > cadence * STALL_FACTOR) return { ...base, state: 'stalled' }
    return { ...base, state: 'live' }
  }
  // No cadence, or cadence but never ran → cannot judge freshness.
  return { ...base, state: cadence && !row ? 'unknown' : row ? 'live' : 'unknown' }
}

interface ClassifyCtx {
  scoreboard: ReturnType<typeof parseScoreboard>
  runner: ReturnType<typeof parseRunnerLog>
  launchd: ReturnType<typeof parseLaunchctl>
}

/** Per-key health for all loops. */
export function computeLoopStatuses(i: LoopInputs): LoopStatus[] {
  const ctx: ClassifyCtx = {
    scoreboard: parseScoreboard(i.scoreboard),
    runner: parseRunnerLog(i.runnerLog),
    launchd: parseLaunchctl(i.launchctl),
  }
  return LOOP_KEYS.map((key) => classify(key, i, ctx))
}

function isLoopKey(s: string): s is LoopKey {
  return (LOOP_KEYS as readonly string[]).includes(s)
}
