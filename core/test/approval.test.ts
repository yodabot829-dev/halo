import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunLog } from '../src/actions/run-log.js'
import { ActionRunner } from '../src/actions/runner.js'
import type { Executor } from '../src/executor/types.js'

const APPROVAL_ACTION = {
  name: 'cleanup',
  prompt: 'Propose a cleanup plan.',
  applyPrompt: 'Execute the approved draft below exactly as written.',
  project: 'demo',
  loop: true,
  historyRuns: 3,
  approval: true,
}

describe('approval flow', () => {
  let dir: string
  let runLog: RunLog
  let prompts: string[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'halo-approval-'))
    runLog = new RunLog(dir)
    prompts = []
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function makeRunner(output = 'PLAN: move a to b') {
    const executor: Executor = {
      name: 'fake',
      available: () => true,
      execute: async (task) => {
        prompts.push(task)
        return { ok: true, output, exitCode: 0 }
      },
    }
    return new ActionRunner({
      actions: [APPROVAL_ACTION],
      executors: new Map([['fake', executor]]),
      defaultExecutor: 'fake',
      projects: { demo: dir },
      runLog,
      stepTimeoutMs: 5000,
    })
  }

  it('draft runs end awaiting approval, with no-side-effects instruction', async () => {
    const runner = makeRunner()
    const run = await runner.run('cleanup')
    expect(run.status).toBe('awaiting_approval')
    expect(run.phase).toBe('draft')
    expect(prompts[0]).toContain('DRAFT phase')
    expect(runner.awaitingApproval().map((r) => r.id)).toContain(run.id)
  })

  it('approve dispatches the apply phase with the draft injected', async () => {
    const runner = makeRunner()
    const draft = await runner.run('cleanup')
    const applied = await runner.approve('cleanup', draft.id)
    expect(applied.status).toBe('done')
    expect(applied.phase).toBe('apply')
    expect(applied.appliedFrom).toBe(draft.id)
    expect(prompts[1]).toContain('Approved draft')
    expect(prompts[1]).toContain('PLAN: move a to b')
    expect(runLog.get('cleanup', draft.id)?.status).toBe('approved')
    expect(runner.awaitingApproval()).toHaveLength(0)
  })

  it('reject stores feedback and the next draft sees it', async () => {
    const runner = makeRunner()
    const draft = await runner.run('cleanup')
    const rejected = runner.reject('cleanup', draft.id, 'do not touch the Reports folder')
    expect(rejected.status).toBe('rejected')
    await runner.run('cleanup')
    expect(prompts[1]).toContain('REVIEWER FEEDBACK: do not touch the Reports folder')
  })

  it('cannot approve a run that is not awaiting approval', async () => {
    const runner = makeRunner()
    const draft = await runner.run('cleanup')
    runner.reject('cleanup', draft.id, 'no')
    await expect(runner.approve('cleanup', draft.id)).rejects.toThrow(/not awaiting approval/)
  })
})
