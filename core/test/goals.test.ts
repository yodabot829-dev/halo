import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseClaudeLine } from '../src/executor/claude-code.js'
import type { Executor, ExecResult } from '../src/executor/types.js'
import { GoalEngine, type Verdict } from '../src/goals/engine.js'
import { GoalStore, parseGoal, serializeGoal, type Goal } from '../src/goals/goal-file.js'

const GOAL_INPUT = {
  title: 'Fix the flaky test',
  objective: 'Make the flaky auth test deterministic.',
  criteria: ['test passes 10x in a row', 'no sleeps added'],
  project: 'demo',
  executor: 'fake',
}

function fakeExecutor(results: ExecResult[]): Executor {
  let call = 0
  return {
    name: 'fake',
    available: () => true,
    execute: async () => results[Math.min(call++, results.length - 1)]!,
  }
}

const okResult: ExecResult = { ok: true, output: 'did the work', exitCode: 0 }

function makeEngine(dir: string, executor: Executor, verdicts: Verdict[]) {
  let judgeCall = 0
  const store = new GoalStore(dir)
  const engine = new GoalEngine({
    store,
    executors: new Map([['fake', executor]]),
    projects: { demo: dir },
    judge: async () => verdicts[Math.min(judgeCall++, verdicts.length - 1)]!,
    maxIterations: 3,
    stepTimeoutMs: 5000,
  })
  return { store, engine }
}

describe('goal file roundtrip', () => {
  it('serializes and parses all fields', () => {
    const goal: Goal = {
      id: 'fix-it',
      title: 'Fix it',
      status: 'running',
      project: 'demo',
      executor: 'claude-code',
      objective: 'Do the thing.',
      criteria: ['a', 'b'],
      iterations: 2,
      log: ['one', 'two'],
    }
    expect(parseGoal('fix-it', serializeGoal(goal))).toEqual(goal)
  })
})

describe('GoalEngine', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'halo-goals-'))
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('completes when the judge approves the first attempt', async () => {
    const { store, engine } = makeEngine(dir, fakeExecutor([okResult]), [
      { met: true, feedback: 'all criteria satisfied' },
    ])
    const goal = store.create(GOAL_INPUT)
    const finished = await engine.run(goal.id)
    expect(finished.status).toBe('done')
    expect(finished.iterations).toBe(1)
    expect(store.get(goal.id)?.status).toBe('done')
  })

  it('iterates with feedback until the judge approves', async () => {
    const { store, engine } = makeEngine(dir, fakeExecutor([okResult, okResult]), [
      { met: false, feedback: 'still flaky' },
      { met: true, feedback: 'fixed' },
    ])
    const goal = store.create(GOAL_INPUT)
    const finished = await engine.run(goal.id)
    expect(finished.status).toBe('done')
    expect(finished.iterations).toBe(2)
  })

  it('fails after max iterations without approval', async () => {
    const { store, engine } = makeEngine(dir, fakeExecutor([okResult]), [
      { met: false, feedback: 'nope' },
    ])
    const goal = store.create(GOAL_INPUT)
    const finished = await engine.run(goal.id)
    expect(finished.status).toBe('failed')
    expect(finished.iterations).toBe(3)
  })

  it('rejects goals for unregistered projects', async () => {
    const { store, engine } = makeEngine(dir, fakeExecutor([okResult]), [])
    const goal = store.create({ ...GOAL_INPUT, project: 'not-registered' })
    await expect(engine.run(goal.id)).rejects.toThrow(/not a registered project/)
  })

  it('refuses concurrent runs of the same goal', async () => {
    const slow: Executor = {
      name: 'fake',
      available: () => true,
      execute: () => new Promise((r) => setTimeout(() => r(okResult), 200)),
    }
    const { store, engine } = makeEngine(dir, slow, [{ met: true, feedback: 'ok' }])
    const goal = store.create(GOAL_INPUT)
    const first = engine.run(goal.id)
    await expect(engine.run(goal.id)).rejects.toThrow(/already running/)
    await first
  })
})

describe('parseClaudeLine', () => {
  it('extracts assistant text', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'working on it' }] },
    })
    expect(parseClaudeLine(line)).toEqual({ kind: 'output', text: 'working on it' })
  })

  it('extracts the final result', () => {
    const line = JSON.stringify({ type: 'result', result: 'all done' })
    expect(parseClaudeLine(line)).toEqual({ kind: 'output', text: 'RESULT: all done' })
  })

  it('drops noise and non-JSON', () => {
    expect(parseClaudeLine('not json')).toBeNull()
    expect(parseClaudeLine(JSON.stringify({ type: 'system' }))).toBeNull()
  })
})
