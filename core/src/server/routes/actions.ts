import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../app.js'

export function registerActionRoutes(app: FastifyInstance, ctx: AppContext): void {
  if (!ctx.actions) return
  const { runner, runLog } = ctx.actions

  app.get('/api/actions', async () => ({
    success: true,
    data: runner.list().map((a) => ({
      name: a.name,
      label: a.label ?? a.name,
      project: a.project,
      schedule: a.schedule ?? null,
      running: a.running,
      lastRun: a.lastRun
        ? { id: a.lastRun.id, status: a.lastRun.status, finishedAt: a.lastRun.finishedAt }
        : null,
    })),
  }))

  app.post('/api/actions/:name/run', async (req, reply) => {
    const { name } = req.params as { name: string }
    try {
      const promise = runner.run(name)
      promise.catch((err) => app.log.error(err, `action ${name} failed`))
      return { success: true, data: { name, queued: true } }
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message })
    }
  })

  app.get('/api/runs', async (req) => {
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 20), 50)
    return { success: true, data: runLog.recentAll(limit) }
  })

  app.get('/api/actions/:name/events', async (req, reply) => {
    const { name } = req.params as { name: string }
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const send = (data: unknown) =>
      reply.raw.write(`event: action\ndata: ${JSON.stringify(data)}\n\n`)
    const unsubscribe = ctx.actions!.runner.subscribe(name, send)
    const keepalive = setInterval(() => reply.raw.write(': ping\n\n'), 15000)
    reply.raw.on('close', () => {
      clearInterval(keepalive)
      unsubscribe()
    })
    await new Promise<void>((resolve) => reply.raw.on('close', () => resolve()))
  })
}
