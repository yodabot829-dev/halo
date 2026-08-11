import type { FastifyInstance } from 'fastify'
import { quit, snapshot } from '../../system/processes.js'
import type { AppContext } from '../app.js'
import { originAllowed } from '../auth.js'

export function registerSystemRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/system/memory', async (_req, reply) => {
    try {
      return { success: true, data: await snapshot() }
    } catch (err) {
      app.log.error(err, 'memory snapshot failed')
      return reply.code(500).send({ success: false, error: (err as Error).message })
    }
  })

  app.post('/api/system/quit/:pid', async (req, reply) => {
    // This route kills processes. With no auth token configured (the default
    // for a localhost bind) the Origin check is the ONLY thing stopping any
    // open tab from POSTing here, so it runs before anything else.
    if (!originAllowed(req.headers, ctx.config.server.corsOrigins)) {
      app.log.warn({ origin: req.headers.origin }, 'quit blocked — cross-origin')
      return reply.code(403).send({ success: false, error: 'cross-origin request refused' })
    }
    const pid = Number((req.params as { pid: string }).pid)
    const result = await quit(pid)
    if (!result.ok) return reply.code(400).send({ success: false, error: result.error })
    app.log.warn({ pid }, 'quit requested from Ops')
    return { success: true, data: { pid, signalled: true } }
  })
}
