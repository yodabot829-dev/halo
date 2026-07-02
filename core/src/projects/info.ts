import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface ProjectInfo {
  name: string
  path: string
  exists: boolean
  lastCommitAt: string | null
  lastCommitMessage: string | null
  /** Commits per week, oldest → newest, 12 weeks. */
  weeklyCommits: number[]
  /** First "Next" item from STATE.md, if present. */
  next: string | null
}

export const WEEKS = 12
const WEEK_MS = 7 * 24 * 3600 * 1000

/** Bucket ISO commit dates into weekly counts, oldest → newest. */
export function bucketWeeks(dates: readonly string[], now: number): number[] {
  const buckets = new Array<number>(WEEKS).fill(0)
  for (const iso of dates) {
    const age = now - new Date(iso).getTime()
    const bucket = Math.floor(age / WEEK_MS)
    if (bucket >= 0 && bucket < WEEKS) {
      buckets[WEEKS - 1 - bucket] = (buckets[WEEKS - 1 - bucket] ?? 0) + 1
    }
  }
  return buckets
}

/** First bullet under "## Next" in a STATE.md. */
export function parseStateNext(markdown: string): string | null {
  const section = markdown.match(/^##\s*Next\s*$([\s\S]*?)(?=^##\s|$(?![\s\S]))/m)?.[1]
  const bullet = section?.split('\n').find((l) => l.trim().startsWith('- '))
  return bullet?.trim().replace(/^- /, '').slice(0, 200) ?? null
}

export async function gatherProjectInfo(
  name: string,
  path: string,
  now = Date.now(),
): Promise<ProjectInfo> {
  const base: ProjectInfo = {
    name,
    path,
    exists: existsSync(path),
    lastCommitAt: null,
    lastCommitMessage: null,
    weeklyCommits: new Array<number>(WEEKS).fill(0),
    next: null,
  }
  if (!base.exists) return base

  const statePath = join(path, 'STATE.md')
  const next = existsSync(statePath) ? parseStateNext(readFileSync(statePath, 'utf8')) : null

  try {
    const [last, recent] = await Promise.all([
      run('git', ['-C', path, 'log', '-1', '--format=%cI%x09%s']),
      run('git', ['-C', path, 'log', `--since=${WEEKS * 7}.days`, '--format=%cI']),
    ])
    const [iso, ...msg] = last.stdout.trim().split('\t')
    return {
      ...base,
      next,
      lastCommitAt: iso || null,
      lastCommitMessage: msg.join('\t') || null,
      weeklyCommits: bucketWeeks(recent.stdout.trim().split('\n').filter(Boolean), now),
    }
  } catch {
    // Not a git repo — still a valid project card.
    return { ...base, next }
  }
}
