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

function makeEngine(
  dir: string,
  executor: Executor,
  verdicts: Verdict[],
  opts: { maxConcurrent?: number; projects?: Record<string, string> } = {},
) {
  let judgeCall = 0
  const store = new GoalStore(dir)
  const engine = new GoalEngine({
    store,
    executors: new Map([['fake', executor]]),
    projects: opts.projects ?? { demo: dir },
    judge: async () => verdicts[Math.min(judgeCall++, verdicts.length - 1)]!,
    maxIterations: 3,
    stepTimeoutMs: 5000,
    maxConcurrent: opts.maxConcurrent ?? 1,
  })
  return { store, engine }
}

function slowExecutor(delayMs: number): Executor {
  return {
    name: 'fake',
    available: () => true,
    execute: () => new Promise((r) => setTimeout(() => r(okResult), delayMs)),
  }
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
      plan: 'refactor parser then add tests',
      doneSoFar: 'parser refactored, tests pending',
      iterations: 2,
      log: ['one', 'two'],
    }
    expect(parseGoal('fix-it', serializeGoal(goal))).toEqual(goal)
  })

  it('parses legacy goal files without checkpoint sections', () => {
    const legacy = [
      '---',
      'title: Old goal',
      'status: pending',
      'project: demo',
      'executor: claude-code',
      'iterations: 0',
      '---',
      '## Objective\nDo it.',
      '',
      '## Success criteria\n- done',
      '',
      '## Log\n',
    ].join('\n')
    const parsed = parseGoal('old-goal', legacy)
    expect(parsed.plan).toBe('')
    expect(parsed.doneSoFar).toBe('')
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
    const { store, engine } = makeEngine(dir, slowExecutor(200), [{ met: true, feedback: 'ok' }])
    const goal = store.create(GOAL_INPUT)
    const first = engine.run(goal.id)
    await expect(engine.run(goal.id)).rejects.toThrow(/already running/)
    await first
  })

  it('rejects a second goal when maxConcurrent is reached', async () => {
    const { store, engine } = makeEngine(dir, slowExecutor(200), [{ met: true, feedback: 'ok' }], {
      maxConcurrent: 1,
      projects: { demo: dir, other: dir },
    })
    const a = store.create(GOAL_INPUT)
    const b = store.create({ ...GOAL_INPUT, title: 'Second goal', project: 'other' })
    const first = engine.run(a.id)
    await expect(engine.run(b.id)).rejects.toThrow(/concurrency limit reached \(1\/1 running\)/)
    await first
  })

  it('allows parallel goals in different projects within the cap', async () => {
    const { store, engine } = makeEngine(dir, slowExecutor(50), [{ met: true, feedback: 'ok' }], {
      maxConcurrent: 2,
      projects: { demo: dir, other: dir },
    })
    const a = store.create(GOAL_INPUT)
    const b = store.create({ ...GOAL_INPUT, title: 'Second goal', project: 'other' })
    const [first, second] = await Promise.all([engine.run(a.id), engine.run(b.id)])
    expect(first.status).toBe('done')
    expect(second.status).toBe('done')
  })

  it('rejects a goal whose project already has one running', async () => {
    const { store, engine } = makeEngine(dir, slowExecutor(200), [{ met: true, feedback: 'ok' }], {
      maxConcurrent: 2,
    })
    const a = store.create(GOAL_INPUT)
    const b = store.create({ ...GOAL_INPUT, title: 'Same project goal' })
    const first = engine.run(a.id)
    await expect(engine.run(b.id)).rejects.toThrow(
      `Project "demo" already has goal "${a.id}" running`,
    )
    await first
  })

  it('tells the executor to maintain the checkpoint in the goal file', async () => {
    const prompts: string[] = []
    const executor: Executor = {
      name: 'fake',
      available: () => true,
      execute: async (task) => {
        prompts.push(task)
        return okResult
      },
    }
    const { store, engine } = makeEngine(dir, executor, [{ met: true, feedback: 'ok' }])
    const goal = store.create(GOAL_INPUT)
    await engine.run(goal.id)
    expect(prompts[0]).toContain(store.pathFor(goal.id))
    expect(prompts[0]).toContain('## Plan')
    expect(prompts[0]).toContain('## Done so far')
  })

  it('carries the executor-written checkpoint into the next iteration prompt', async () => {
    const prompts: string[] = []
    const store = new GoalStore(dir)
    const goal = store.create(GOAL_INPUT)
    const executor: Executor = {
      name: 'fake',
      available: () => true,
      execute: async (task) => {
        prompts.push(task)
        if (prompts.length === 1) {
          // Simulate the executor editing the goal file's checkpoint sections.
          const onDisk = store.get(goal.id)!
          store.save({
            ...onDisk,
            plan: 'stabilise the auth mock first',
            doneSoFar: 'reproduced the flake locally',
          })
        }
        return okResult
      },
    }
    const { engine } = makeEngine(dir, executor, [
      { met: false, feedback: 'keep going' },
      { met: true, feedback: 'ok' },
    ])
    const finished = await engine.run(goal.id)
    expect(finished.status).toBe('done')
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('stabilise the auth mock first')
    expect(prompts[1]).toContain('reproduced the flake locally')
    // Engine saves along the way must not clobber the executor's checkpoint.
    expect(store.get(goal.id)?.plan).toBe('stabilise the auth mock first')
    expect(store.get(goal.id)?.doneSoFar).toBe('reproduced the flake locally')
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
