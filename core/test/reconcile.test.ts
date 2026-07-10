import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GoalStore, type Goal } from '../src/goals/goal-file.js'
import { reconcileStrandedGoals } from '../src/goals/reconcile.js'

function makeGoal(id: string, status: Goal['status']): Goal {
  return {
    id,
    title: `Goal ${id}`,
    status,
    project: 'demo',
    executor: 'claude-code',
    objective: 'Do the thing.',
    criteria: ['it is done'],
    plan: '',
    doneSoFar: '',
    iterations: 1,
    log: ['2026-07-01T00:00:00.000Z [status] iteration 1/3'],
  }
}

describe('reconcileStrandedGoals', () => {
  let dir: string
  let store: GoalStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'halo-reconcile-'))
    store = new GoalStore(dir)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('marks running goals stopped and appends a log line', () => {
    store.save(makeGoal('stranded', 'running'))

    const now = new Date('2026-07-06T09:00:00.000Z')
    const reconciled = reconcileStrandedGoals(store, now)

    expect(reconciled.map((g) => g.id)).toEqual(['stranded'])
    const saved = store.get('stranded')
    expect(saved?.status).toBe('stopped')
    expect(saved?.log.at(-1)).toBe(
      '2026-07-06T09:00:00.000Z [status] marked stopped at boot — daemon restarted while goal was running',
    )
    // Earlier log entries are preserved.
    expect(saved?.log).toHaveLength(2)
  })

  it('leaves non-running goals untouched', () => {
    store.save(makeGoal('pending-goal', 'pending'))
    store.save(makeGoal('done-goal', 'done'))
    store.save(makeGoal('failed-goal', 'failed'))
    store.save(makeGoal('stopped-goal', 'stopped'))

    expect(reconcileStrandedGoals(store)).toEqual([])
    expect(store.get('pending-goal')?.status).toBe('pending')
    expect(store.get('done-goal')?.status).toBe('done')
    expect(store.get('failed-goal')?.status).toBe('failed')
    expect(store.get('stopped-goal')?.log).toHaveLength(1)
  })

  it('is a no-op on an empty or missing goals dir', () => {
    expect(reconcileStrandedGoals(store)).toEqual([])
    expect(reconcileStrandedGoals(new GoalStore(join(dir, 'nope')))).toEqual([])
  })
})
