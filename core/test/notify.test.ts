import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Executor, ExecResult } from '../src/executor/types.js'
import { GoalEngine } from '../src/goals/engine.js'
import { GoalStore, type Goal } from '../src/goals/goal-file.js'
import { makeOsascriptNotifier } from '../src/goals/notify.js'

const okResult: ExecResult = { ok: true, output: 'did the work', exitCode: 0 }

describe('makeOsascriptNotifier', () => {
  it('fires an osascript display notification with title and status', () => {
    const calls: { cmd: string; args: string[] }[] = []
    const notify = makeOsascriptNotifier((cmd, args, cb) => {
      calls.push({ cmd, args })
      cb(null)
    })
    notify({ title: 'Fix the flaky test', status: 'done' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.cmd).toBe('osascript')
    expect(calls[0]?.args[0]).toBe('-e')
    expect(calls[0]?.args[1]).toContain('display notification')
    expect(calls[0]?.args[1]).toContain('Fix the flaky test — done')
    expect(calls[0]?.args[1]).toContain('HALO goal')
  })

  it('escapes quotes in the goal title', () => {
    const scripts: string[] = []
    const notify = makeOsascriptNotifier((_cmd, args, cb) => {
      scripts.push(args[1] ?? '')
      cb(null)
    })
    notify({ title: 'Fix the "auth" bug', status: 'failed' })
    expect(scripts[0]).toContain('\\"auth\\"')
  })
})

describe('GoalEngine completion notification', () => {
  let dir: string
  let notified: Goal[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'halo-notify-'))
    notified = []
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function makeEngine(executor: Executor, verdictMet: boolean) {
    const store = new GoalStore(dir)
    const engine = new GoalEngine({
      store,
      executors: new Map([['fake', executor]]),
      projects: { demo: dir },
      judge: async () => ({ met: verdictMet, feedback: 'x' }),
      maxIterations: 2,
      stepTimeoutMs: 5000,
      maxConcurrent: 1,
      notify: (goal) => notified.push(goal),
    })
    return { store, engine }
  }

  const instant: Executor = { name: 'fake', available: () => true, execute: async () => okResult }

  const input = {
    title: 'Notify me',
    objective: 'obj',
    criteria: ['c'],
    project: 'demo',
    executor: 'fake',
  }

  it('notifies when a goal completes', async () => {
    const { store, engine } = makeEngine(instant, true)
    const goal = store.create(input)
    await engine.run(goal.id)
    expect(notified.map((g) => g.status)).toEqual(['done'])
  })

  it('notifies when a goal fails', async () => {
    const { store, engine } = makeEngine(instant, false)
    const goal = store.create(input)
    await engine.run(goal.id)
    expect(notified.map((g) => g.status)).toEqual(['failed'])
  })

  it('stays silent when a goal is stopped by the user', async () => {
    const slow: Executor = {
      name: 'fake',
      available: () => true,
      execute: () => new Promise((r) => setTimeout(() => r(okResult), 200)),
    }
    const { store, engine } = makeEngine(slow, true)
    const goal = store.create(input)
    const run = engine.run(goal.id)
    setTimeout(() => engine.stop(goal.id), 50)
    const finished = await run
    expect(finished.status).toBe('stopped')
    expect(notified).toEqual([])
  })
})
