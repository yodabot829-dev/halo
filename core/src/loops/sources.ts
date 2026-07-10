// Impure side: read the loop signal off disk + `launchctl list`, hand it to the
// pure classifier in status.ts. Every read is best-effort — a missing or
// unreadable source becomes null, never a throw (that loop lands as `unknown`).

import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { LOOP_KEYS, type LoopInputs, type LoopKey } from './status.js'

const run = promisify(execFile)
const LOOPS_DIR = join(homedir(), '.claude', 'loops')
const AGENTS_DIR = join(homedir(), 'Library', 'LaunchAgents')

function readSafe(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** Which PAUSED* sentinel files currently exist under ~/.claude/loops. */
function readSentinels(): Set<string> {
  const names = new Set<string>()
  if (existsSync(join(LOOPS_DIR, 'PAUSED'))) names.add('PAUSED')
  for (const key of LOOP_KEYS) {
    if (existsSync(join(LOOPS_DIR, `PAUSED-${key}`))) names.add(`PAUSED-${key}`)
  }
  return names
}

/** `launchctl list` — null if the binary is unavailable or blocked. */
async function readLaunchctl(): Promise<string | null> {
  try {
    const { stdout } = await run('launchctl', ['list'])
    return stdout
  } catch {
    return null
  }
}

/** Gather every input the classifier needs. Scoreboard lives at the vault root. */
export async function gatherLoopInputs(vaultPath: string, now = Date.now()): Promise<LoopInputs> {
  const plists = Object.fromEntries(
    LOOP_KEYS.map((k) => [k, readSafe(join(AGENTS_DIR, `com.shumon.loop.${k}.plist`))]),
  ) as Record<LoopKey, string | null>

  return {
    scoreboard: readSafe(join(vaultPath, 'LOOP-SCOREBOARD.md')),
    sentinels: readSentinels(),
    runnerLog: readSafe(join(LOOPS_DIR, 'logs', 'runner.log')),
    launchctl: await readLaunchctl(),
    plists,
    now,
  }
}
