import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../app.js'

const createGoalSchema = z.object({
  title: z.string().min(1).max(200),
  objective: z.string().min(1).max(8000),
  criteria: z.array(z.string().min(1).max(500)).min(1).max(20),
  project: z.string().min(1).max(100),
  executor: z.string().max(50).optional(),
})

export function registerGoalRoutes(app: FastifyInstance, ctx: AppContext): void {
  if (!ctx.goals) return
  const { store, engine } = ctx.goals

  app.get('/api/goals', async () => ({
    success: true,
    data: store.list().map((g) => ({ ...g, running: engine.isRunning(g.id) })),
  }))

  app.post('/api/goals', async (req, reply) => {
    const parsed = createGoalSchema.safeParse(req.body)
    if (!parsed.success) {
      app.log.warn({ issues: parsed.error.issues }, 'invalid goal')
      return reply.code(400).send({ success: false, error: 'invalid request body' })
    }
    if (!(parsed.data.project in ctx.config.projects)) {
      return reply.code(400).send({ success: false, error: 'unknown project' })
    }
    const goal = store.create({
      title: parsed.data.title,
      objective: parsed.data.objective,
      criteria: parsed.data.criteria,
      project: parsed.data.project,
      executor: parsed.data.executor ?? ctx.config.executors.default,
    })
    return { success: true, data: goal }
  })

  app.post('/api/goals/:id/run', async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      const promise = engine.run(id)
      promise.catch((err) => app.log.error(err, `goal ${id} run failed`))
      return { success: true, data: { id, started: true } }
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message })
    }
  })

  app.post('/api/goals/:id/stop', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!engine.stop(id)) {
      return reply.code(404).send({ success: false, error: 'goal is not running' })
    }
    return { success: true, data: { id, stopping: true } }
  })

  app.get('/api/goals/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string }
    const goal = store.get(id)
    if (!goal) return reply.code(404).send({ success: false, error: 'unknown goal' })

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const send = (event: string, data: unknown) =>
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

    send('snapshot', { ...goal, running: engine.isRunning(id) })
    const unsubscribe = engine.subscribe(id, (e) => send('goal', e))
    const keepalive = setInterval(() => reply.raw.write(': ping\n\n'), 15000)
    reply.raw.on('close', () => {
      clearInterval(keepalive)
      unsubscribe()
    })
    // Held open until the client disconnects.
    await new Promise<void>((resolve) => reply.raw.on('close', () => resolve()))
  })
}
