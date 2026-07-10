import type { FastifyInstance } from 'fastify'
import { gatherLoopInputs } from '../../loops/sources.js'
import { computeLoopStatuses } from '../../loops/status.js'
import type { AppContext } from '../app.js'

/** Read-only health of the launchd improvement loops. Never mutates any loop. */
export function registerLoopRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/loops', async () => {
    const inputs = await gatherLoopInputs(ctx.config.vault.path)
    return { success: true, data: computeLoopStatuses(inputs) }
  })
}
