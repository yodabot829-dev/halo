// Silence alarm: notify once per newly-stalled, un-paused loop. Debounced via a
// small JSON set persisted in HALO's dataDir (alongside meter.sqlite) so a
// persistently-stalled loop alarms once, not on every call. A loop that
// recovers is dropped from the set so it can alarm again if it re-stalls.
//
// Callable + proven by test only. ponytail: wiring this to a timer/scheduler is
// a deliberate follow-up — see registerLoopRoutes / index.ts for where a croner
// tick would call fireSilenceAlarm on an interval.

import { execFile } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import type { LoopStatus } from './status.js'

const run = promisify(execFile)

export interface AlarmDeps {
  /** Read the persisted already-alarmed key set (missing file → empty). */
  readState: () => string[]
  /** Persist the updated already-alarmed key set. */
  writeState: (keys: string[]) => void
  /** Fire a single OS notification for one loop. */
  notify: (status: LoopStatus) => void | Promise<void>
}

/** Stalled loops are already un-paused by construction (paused overrides stalled
 *  in the classifier), so no extra pause check is needed here. */
export async function fireSilenceAlarm(statuses: readonly LoopStatus[], deps: AlarmDeps): Promise<string[]> {
  const stalled = new Set(statuses.filter((s) => s.state === 'stalled').map((s) => s.key))
  const alreadyAlarmed = new Set(deps.readState())

  const newlyStalled = [...stalled].filter((k) => !alreadyAlarmed.has(k))
  for (const key of newlyStalled) {
    const status = statuses.find((s) => s.key === key)
    if (status) await deps.notify(status)
  }

  // Keep only keys still stalled → recovered loops re-arm for next time.
  deps.writeState([...stalled])
  return newlyStalled
}

/** Default notifier — one macOS `osascript` banner. Failure is swallowed: a
 *  missing notification must never crash the monitor. */
export async function osascriptNotify(status: LoopStatus): Promise<void> {
  const msg = `Loop "${status.key}" is stalled (last run ${status.lastRun ?? 'unknown'})`
  try {
    await run('osascript', ['-e', `display notification "${msg}" with title "HALO Watchtower"`])
  } catch {
    /* notification best-effort */
  }
}

/** File-backed state helpers for the default (production) wiring. */
export function fileAlarmState(path: string): Pick<AlarmDeps, 'readState' | 'writeState'> {
  return {
    readState: () => {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'))
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
      } catch {
        return []
      }
    },
    writeState: (keys) => writeFileSync(path, JSON.stringify(keys)),
  }
}
