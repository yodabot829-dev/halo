import { Cron } from 'croner'
import type { ActionRunner } from './runner.js'

export interface ScheduledAction {
  name: string
  schedule: string
}

/** Cron automations over actions — the video's "routines". */
export class ActionScheduler {
  private jobs: { name: string; schedule: string; job: Cron }[] = []

  constructor(
    private readonly runner: ActionRunner,
    private readonly log?: (msg: string) => void,
  ) {}

  start(actions: readonly ScheduledAction[]): { scheduled: string[]; invalid: string[] } {
    const scheduled: string[] = []
    const invalid: string[] = []
    for (const action of actions) {
      try {
        const job = new Cron(action.schedule, { protect: true }, () => {
          this.runner.run(action.name).catch((err) => {
            this.log?.(`scheduled action ${action.name} failed: ${(err as Error).message}`)
          })
        })
        this.jobs.push({ name: action.name, schedule: action.schedule, job })
        scheduled.push(`${action.name} @ ${action.schedule}`)
      } catch {
        invalid.push(`${action.name}: bad cron "${action.schedule}"`)
      }
    }
    return { scheduled, invalid }
  }

  nextRuns(): { name: string; schedule: string; nextRun: string | null }[] {
    return this.jobs.map(({ name, schedule, job }) => ({
      name,
      schedule,
      nextRun: job.nextRun()?.toISOString() ?? null,
    }))
  }

  stop(): void {
    for (const { job } of this.jobs) job.stop()
    this.jobs = []
  }
}
