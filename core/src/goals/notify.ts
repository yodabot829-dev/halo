import { execFile } from 'node:child_process'
import type { Goal } from './goal-file.js'

export type GoalNotifier = (goal: Pick<Goal, 'title' | 'status'>) => void

type RunFn = (cmd: string, args: string[], cb: (err: Error | null) => void) => void

/** macOS banner on goal completion — the only notification rail for now
 * (Telegram comes later). argv array + JSON-escaped AppleScript string, so a
 * hostile goal title cannot break out of the notification text. */
export function makeOsascriptNotifier(run: RunFn = execFile): GoalNotifier {
  return (goal) => {
    const message = `${goal.title} — ${goal.status}`.slice(0, 200)
    const script = `display notification ${JSON.stringify(message)} with title "HALO goal"`
    run('osascript', ['-e', script], (err) => {
      if (err) console.warn(`goal notification failed: ${err.message}`)
    })
  }
}
