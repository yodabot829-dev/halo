import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parseGoal, serializeGoal, type Goal } from '../src/goals/goal-file.js'

// The one deliberately non-mocked test in the suite: it boots the real daemon
// module (tsx src/index.ts) in a temp dir on an ephemeral port, SIGKILLs it to
// simulate a crash, boots it again and asserts boot-time reconciliation marked
// the stranded running goal as stopped. No `claude` is ever spawned — the goal
// is planted, never run. NEVER port 4720 (the live daemon).

const coreDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('no port allocated'))
        return
      }
      srv.close(() => resolvePort(address.port))
    })
  })
}

function writeConfig(root: string, port: number): string {
  const config = [
    'server:',
    `  port: ${port}`,
    '  bind: 127.0.0.1',
    `dataDir: ${join(root, 'data')}`,
    'vault:',
    `  path: ${join(root, 'vault')}`,
    'providers:',
    '  ollama:',
    '    kind: ollama',
    '    baseURL: http://127.0.0.1:1/api',
    'models:',
    '  - ref: ollama/test-model',
    '    classes: [chat]',
    '    tier: free',
    'goals:',
    '  notify: false',
    '',
  ].join('\n')
  const path = join(root, 'halo.config.yaml')
  writeFileSync(path, config, 'utf8')
  return path
}

const strandedGoal: Goal = {
  id: 'stranded-goal',
  title: 'Stranded goal',
  status: 'running',
  project: 'demo',
  executor: 'claude-code',
  objective: 'Survive a daemon crash.',
  criteria: ['reconciled at boot'],
  plan: 'the plan',
  doneSoFar: 'half of it',
  iterations: 1,
  log: ['2026-07-06T00:00:00.000Z [status] iteration 1/3'],
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`daemon not healthy on :${port} within ${timeoutMs}ms`)
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((r) => child.once('exit', () => r()))
}

describe('boot-time goal reconciliation (real daemon)', () => {
  let root: string
  const children: ChildProcess[] = []
  const logs: string[] = []

  function startDaemon(configPath: string): ChildProcess {
    const env = { ...process.env, HALO_CONFIG: configPath }
    delete env['HALO_TOKEN'] // loopback bind needs no auth; keeps /api/health open
    // node --import tsx (not the tsx bin): one process, so SIGKILL is a true
    // crash of the daemon itself rather than of a wrapper.
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: coreDir,
      env,
    })
    child.stdout.on('data', (c: Buffer) => logs.push(c.toString()))
    child.stderr.on('data', (c: Buffer) => logs.push(c.toString()))
    children.push(child)
    return child
  }

  afterEach(async () => {
    for (const child of children) {
      child.kill('SIGKILL')
      await waitForExit(child)
    }
    children.length = 0
    rmSync(root, { recursive: true, force: true })
  })

  it('marks a goal stranded by a crash as stopped on restart', { timeout: 120_000 }, async () => {
    root = mkdtempSync(join(tmpdir(), 'halo-boot-'))
    const goalsDir = join(root, 'vault', 'OS', 'Goals')
    mkdirSync(goalsDir, { recursive: true })
    const port = await freePort()
    const configPath = writeConfig(root, port)

    // Boot #1 and wait until it serves traffic.
    const first = startDaemon(configPath)
    await waitForHealth(port, 45_000).catch((err) => {
      throw new Error(`${(err as Error).message}\ndaemon output:\n${logs.join('')}`)
    })

    // A goal starts "running", then the daemon dies without any cleanup.
    const goalPath = join(goalsDir, 'stranded-goal.md')
    writeFileSync(goalPath, serializeGoal(strandedGoal), 'utf8')
    first.kill('SIGKILL')
    await waitForExit(first)
    expect(parseGoal('stranded-goal', readFileSync(goalPath, 'utf8')).status).toBe('running')

    // Boot #2: reconciliation runs before the server starts listening.
    startDaemon(configPath)
    await waitForHealth(port, 45_000).catch((err) => {
      throw new Error(`${(err as Error).message}\ndaemon output:\n${logs.join('')}`)
    })

    const reconciled = parseGoal('stranded-goal', readFileSync(goalPath, 'utf8'))
    expect(reconciled.status).toBe('stopped')
    expect(reconciled.log.at(-1)).toMatch(/marked stopped at boot — daemon restarted/)
    // Checkpoint sections survive reconciliation.
    expect(reconciled.plan).toBe('the plan')
    expect(reconciled.doneSoFar).toBe('half of it')
  })
})
