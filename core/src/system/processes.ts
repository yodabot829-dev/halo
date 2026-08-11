import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface AppUsage {
  /** App name processes were grouped under, e.g. "Google Chrome". */
  app: string
  /** Resident memory across every process in the group, MB. */
  memoryMb: number
  processes: { pid: number; memoryMb: number; command: string }[]
  /** False when nothing in the group may be signalled — the UI hides the button. */
  quittable: boolean
}

export interface MemorySnapshot {
  totalMb: number
  /** Percentage of pages free, as macOS reports it. */
  freePercent: number
  swapUsedMb: number
  swapTotalMb: number
  apps: AppUsage[]
}

/**
 * Processes we refuse to signal regardless of who asks. Killing any of these
 * either takes the desktop down or kills HALO mid-request.
 */
const PROTECTED = [
  /^\/System\//,
  /^\/usr\/libexec\//,
  /^\/usr\/sbin\//,
  /^\/sbin\//,
  /^\/usr\/bin\//,
  /WindowServer/,
  /loginwindow/,
  /Finder\.app/,
]

/** Below this, pids belong to the boot-time system daemons. */
const MIN_PID = 500

export function isQuittable(pid: number, command: string): boolean {
  if (pid < MIN_PID) return false
  if (pid === process.pid || pid === process.ppid) return false
  return !PROTECTED.some((re) => re.test(command))
}

/**
 * Group a process command into the app it belongs to, so a browser's 30
 * helper processes read as one row instead of thirty.
 */
export function appNameFor(command: string): string {
  const bundle = command.match(/\/([^/]+)\.app\//)
  if (bundle) return bundle[1]!
  const helper = command.match(/^(.*?) Helper/)
  if (helper) return helper[1]!.trim()
  // argv0 first, then its basename — otherwise "node /path/app.ts" reads as "app.ts"
  const argv0 = command.split(' ')[0] ?? command
  return argv0.split('/').pop() || command
}

const MEM_UNITS: Record<string, number> = { K: 1 / 1024, M: 1, G: 1024 }

/** Parse one `top -stats pid,mem,command` row. Returns null for headers/junk. */
export function parseTopRow(line: string): { pid: number; memoryMb: number; command: string } | null {
  const m = line.match(/^\s*(\d+)\s+([\d.]+)([KMG])[+-]?\s+(.+?)\s*$/)
  if (!m) return null
  return {
    pid: Number(m[1]),
    memoryMb: Math.round(Number(m[2]) * MEM_UNITS[m[3]!]!),
    command: m[4]!,
  }
}

export function groupByApp(
  rows: { pid: number; memoryMb: number; command: string }[],
): AppUsage[] {
  const byApp = new Map<string, AppUsage>()
  for (const row of rows) {
    const app = appNameFor(row.command)
    const entry = byApp.get(app) ?? { app, memoryMb: 0, processes: [], quittable: false }
    entry.memoryMb += row.memoryMb
    entry.processes.push(row)
    entry.quittable ||= isQuittable(row.pid, row.command)
    byApp.set(app, entry)
  }
  return [...byApp.values()].sort((a, b) => b.memoryMb - a.memoryMb)
}

/**
 * `top` reports truncated commands, so pair it with `ps` for the full path —
 * the protected-path checks need the real path, not "com.apple.Virtua".
 */
async function fullCommands(pids: number[]): Promise<Map<number, string>> {
  if (pids.length === 0) return new Map()
  const out = new Map<number, string>()
  // ps exits non-zero when every pid is gone (or out of range) — that is an
  // empty result, not a failure. Callers read "absent" as "no such process".
  const stdout = await run('/bin/ps', ['-ww', '-o', 'pid=,command=', '-p', pids.join(',')])
    .then((r) => r.stdout)
    .catch(() => '')
  for (const line of stdout.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(.+)$/)
    if (m) out.set(Number(m[1]), m[2]!.trim())
  }
  return out
}

async function swapUsage(): Promise<{ usedMb: number; totalMb: number }> {
  const { stdout } = await run('/usr/sbin/sysctl', ['-n', 'vm.swapusage'])
  const total = stdout.match(/total = ([\d.]+)M/)
  const used = stdout.match(/used = ([\d.]+)M/)
  return { usedMb: Math.round(Number(used?.[1] ?? 0)), totalMb: Math.round(Number(total?.[1] ?? 0)) }
}

async function freePercent(): Promise<number> {
  const { stdout } = await run('/usr/bin/memory_pressure', ['-Q'])
  return Number(stdout.match(/free percentage:\s*(\d+)%/)?.[1] ?? 0)
}

/** Top memory consumers on this machine, grouped by app. macOS only. */
export async function snapshot(limit = 40): Promise<MemorySnapshot> {
  const [{ stdout: topOut }, totalBytes, swap, free] = await Promise.all([
    run('/usr/bin/top', ['-l', '1', '-o', 'mem', '-n', String(limit), '-stats', 'pid,mem,command'], {
      maxBuffer: 4 * 1024 * 1024,
    }),
    run('/usr/sbin/sysctl', ['-n', 'hw.memsize']).then((r) => Number(r.stdout.trim())),
    swapUsage(),
    freePercent(),
  ])

  const rows = topOut.split('\n').map(parseTopRow).filter((r) => r !== null)
  const full = await fullCommands(rows.map((r) => r.pid))
  const resolved = rows.map((r) => ({ ...r, command: full.get(r.pid) ?? r.command }))

  return {
    totalMb: Math.round(totalBytes / 1024 / 1024),
    freePercent: free,
    swapUsedMb: swap.usedMb,
    swapTotalMb: swap.totalMb,
    apps: groupByApp(resolved),
  }
}

/**
 * Ask an app to quit (SIGTERM — the app still gets to save). Re-reads the
 * process's real command at call time so the allowlist can't be raced by a
 * stale pid from an older snapshot.
 */
export async function quit(pid: number): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(pid) || pid < MIN_PID) return { ok: false, error: 'pid not permitted' }
  const command = (await fullCommands([pid])).get(pid)
  if (!command) return { ok: false, error: 'no such process' }
  if (!isQuittable(pid, command)) return { ok: false, error: 'process is protected' }
  try {
    process.kill(pid, 'SIGTERM')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
