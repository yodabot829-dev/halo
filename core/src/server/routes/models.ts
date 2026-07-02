import type { FastifyInstance } from 'fastify'
import { budgetStatus } from '../../router/budget.js'
import type { AppContext } from '../app.js'

export function registerModelRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/models', async () => ({
    success: true,
    data: ctx.registry.list(),
  }))

  app.get('/api/usage', async () => ({
    success: true,
    data: {
      totals: ctx.meter.totals(),
      budgets: budgetStatus(ctx.config, ctx.meter, new Date()),
    },
  }))
}
