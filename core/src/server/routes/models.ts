import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../app.js'

export function registerModelRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/models', async () => ({
    success: true,
    data: ctx.registry.list(),
  }))

  app.get('/api/usage', async () => ({
    success: true,
    data: ctx.meter.totals(),
  }))
}
