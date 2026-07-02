import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import { existsSync } from 'node:fs'
import type { ActionRunner } from '../actions/runner.js'
import type { RunLog } from '../actions/run-log.js'
import type { HaloConfig } from '../config/schema.js'
import type { GoalEngine } from '../goals/engine.js'
import type { GoalStore } from '../goals/goal-file.js'
import type { MemoryService } from '../memory/service.js'
import type { Meter } from '../meter/meter.js'
import type { ModelSource } from '../providers/registry.js'
import { isLoopback, tokenMatches } from './auth.js'
import { registerActionRoutes } from './routes/actions.js'
import { registerChatRoute } from './routes/chat.js'
import { registerGoalRoutes } from './routes/goals.js'
import { registerMemoryRoutes } from './routes/memory.js'
import { registerModelRoutes } from './routes/models.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerVoiceRoutes } from './routes/voice.js'

export interface AppContext {
  config: HaloConfig
  registry: ModelSource
  meter: Meter
  /** Bearer token for API auth. Required unless bound to loopback. */
  authToken?: string
  /** Absolute path to built web assets; served at / when present. */
  webDist?: string
  /** Fastify logger flag; tests pass false. */
  logger?: boolean
  /** Memory service; absent = memory routes and injection disabled. */
  memory?: MemoryService
  memoryStats?: () => { notes: number; embedded: number }
  /** Cortana persona text prepended to every system prompt. */
  persona?: string | null
  /** Goal engine; absent = goal routes disabled. */
  goals?: { store: GoalStore; engine: GoalEngine }
  /** One-click actions; absent = action routes disabled. */
  actions?: { runner: ActionRunner; runLog: RunLog }
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  if (!ctx.authToken && !isLoopback(ctx.config.server.bind)) {
    throw new Error(
      `Refusing to bind ${ctx.config.server.bind} without HALO_TOKEN — ` +
        'a non-loopback bind with auth disabled would expose the API to the network',
    )
  }

  const app = Fastify({ logger: ctx.logger ?? true })

  // SPA is served same-origin by this daemon; cross-origin callers are only
  // ever allowed when explicitly listed in config.
  const origins = ctx.config.server.corsOrigins
  if (origins.length > 0) {
    await app.register(cors, { origin: origins, credentials: false })
  }

  await app.register(rateLimit, {
    max: ctx.config.server.rateLimitPerMinute,
    timeWindow: '1 minute',
  })

  app.addHook('onRequest', async (req, reply) => {
    if (!ctx.authToken) return
    if (!req.url.startsWith('/api/')) return
    if (!tokenMatches(req.headers.authorization, ctx.authToken)) {
      await reply.code(401).send({ success: false, error: 'unauthorized' })
      return reply
    }
  })

  app.get('/api/health', async () => ({ success: true, data: { status: 'ok' } }))

  registerModelRoutes(app, ctx)
  registerChatRoute(app, ctx)
  registerMemoryRoutes(app, ctx)
  registerGoalRoutes(app, ctx)
  registerVoiceRoutes(app, ctx)
  registerProjectRoutes(app, ctx)
  registerActionRoutes(app, ctx)

  if (ctx.webDist && existsSync(ctx.webDist)) {
    await app.register(fastifyStatic, { root: ctx.webDist })
  }

  return app
}
