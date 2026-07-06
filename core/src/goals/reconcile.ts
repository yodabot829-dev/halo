import type { Goal, GoalStore } from './goal-file.js'

/** Engine state is in-memory, so a daemon crash/restart strands goal files at
 * status:running forever. Called once at boot, before the engine accepts work:
 * marks each stranded goal stopped with an explanatory log line. */
export function reconcileStrandedGoals(store: GoalStore, now = new Date()): Goal[] {
  return store
    .list()
    .filter((g) => g.status === 'running')
    .map((goal) => {
      const reconciled: Goal = {
        ...goal,
        status: 'stopped',
        log: [
          ...goal.log,
          `${now.toISOString()} [status] marked stopped at boot — daemon restarted while goal was running`,
        ],
      }
      store.save(reconciled)
      return reconciled
    })
}
