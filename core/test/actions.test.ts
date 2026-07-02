import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunLog } from '../src/actions/run-log.js'
import { ActionRunner } from '../src/actions/runner.js'
import type { Executor, ExecResult } from '../src/executor/types.js'

const ACTION = {
  name: 'brief',
  prompt: 'Do the brief.',
  project: 'demo',
  loop: true,
  historyRuns: 2,
}

function fakeExecutor(result: ExecResult, capture: string[]): Executor {
  return {
    name: 'fake',
    available: () => true,
    execute: async (task) => {
      capture.push(task)
      return result
    },
  }
}

describe('ActionRunner', () => {
  let dir: string
  let runLog: RunLog

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'halo-runs-'))
    runLog = new RunLog(dir)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function makeRunner(executor: Executor, actions = [ACTION]) {
    return new ActionRunner({
      actions,
      executors: new Map([['fake', executor]]),
      defaultExecutor: 'fake',
      projects: { demo: dir },
      runLog,
      stepTimeoutMs: 5000,
    })
  }

  it('runs an action, saves the run, reports it in list()', async () => {
    const prompts: string[] = []
    const runner = makeRunner(fakeExecutor({ ok: true, output: 'did it', exitCode: 0 }, prompts))
    const run = await runner.run('brief')
    expect(run.status).toBe('done')
    expect(run.output).toBe('did it')
    expect(runLog.recent('brief', 5)).toHaveLength(1)
    expect(runner.list()[0]?.lastRun?.status).toBe('done')
  })

  it('injects previous runs into the prompt (loop engineering)', async () => {
    const prompts: string[] = []
    const runner = makeRunner(fakeExecutor({ ok: true, output: 'first output', exitCode: 0 }, prompts))
    await runner.run('brief')
    await runner.run('brief')
    expect(prompts[0]).not.toContain('Previous runs')
    expect(prompts[1]).toContain('Previous runs')
    expect(prompts[1]).toContain('first output')
    expect(prompts[1]).toContain('Improve on the previous runs')
  })

  it('does not inject history when loop is false', async () => {
    const prompts: string[] = []
    const action = { ...ACTION, loop: false }
    const runner = makeRunner(
      fakeExecutor({ ok: true, output: 'x', exitCode: 0 }, prompts),
      [action],
    )
    await runner.run('brief')
    await runner.run('brief')
    expect(prompts[1]).not.toContain('Previous runs')
  })

  it('records failed executor runs', async () => {
    const runner = makeRunner(fakeExecutor({ ok: false, output: 'boom', exitCode: 2 }, []))
    const run = await runner.run('brief')
    expect(run.status).toBe('failed')
    expect(runLog.recent('brief', 1)[0]?.status).toBe('failed')
  })

  it('rejects unknown actions and concurrent runs', async () => {
    const slow: Executor = {
      name: 'fake',
      available: () => true,
      execute: () => new Promise((r) => setTimeout(() => r({ ok: true, output: 'x', exitCode: 0 }), 150)),
    }
    const runner = makeRunner(slow)
    await expect(runner.run('nope')).rejects.toThrow(/Unknown action/)
    const first = runner.run('brief')
    await expect(runner.run('brief')).rejects.toThrow(/already running/)
    await first
  })
})

describe('RunLog', () => {
  it('roundtrips runs and orders recentAll newest first', () => {
    const dir = mkdtempSync(join(tmpdir(), 'halo-runlog-'))
    const log = new RunLog(dir)
    log.save({
      id: '2026-07-02T10-00-00-000Z-a',
      action: 'a',
      status: 'done',
      startedAt: 'x',
      finishedAt: 'y',
      executor: 'fake',
      project: 'demo',
      output: 'one',
    })
    log.save({
      id: '2026-07-02T11-00-00-000Z-b',
      action: 'b',
      status: 'failed',
      startedAt: 'x',
      executor: 'fake',
      project: 'demo',
      output: 'two',
    })
    const all = log.recentAll(10)
    expect(all.map((r) => r.action)).toEqual(['b', 'a'])
    expect(all[0]?.output).toBe('two')
    rmSync(dir, { recursive: true, force: true })
  })
})
