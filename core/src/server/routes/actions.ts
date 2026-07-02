import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../app.js'

const rejectSchema = z.object({ feedback: z.string().min(1).max(2000) })

export function registerActionRoutes(app: FastifyInstance, ctx: AppContext): void {
  if (!ctx.actions) return
  const { runner, runLog, scheduler } = ctx.actions

  app.get('/api/actions', async () => ({
    success: true,
    data: runner.list().map((a) => ({
      name: a.name,
      label: a.label ?? a.name,
      project: a.project,
      schedule: a.schedule ?? null,
      approval: a.approval,
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

  app.post('/api/actions/:name/runs/:id/approve', async (req, reply) => {
    const { name, id } = req.params as { name: string; id: string }
    try {
      const promise = runner.approve(name, id)
      promise.catch((err) => app.log.error(err, `apply phase of ${name} failed`))
      return { success: true, data: { name, id, applying: true } }
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message })
    }
  })

  app.post('/api/actions/:name/runs/:id/reject', async (req, reply) => {
    const { name, id } = req.params as { name: string; id: string }
    const parsed = rejectSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'feedback is required' })
    }
    try {
      const run = runner.reject(name, id, parsed.data.feedback)
      return { success: true, data: { name, id, status: run.status } }
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message })
    }
  })

  app.get('/api/runs', async (req) => {
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 20), 50)
    return { success: true, data: runLog.recentAll(limit) }
  })

  // Mission control: everything the machine is doing, on one screen.
  app.get('/api/board', async () => {
    const goals = ctx.goals
      ? ctx.goals.store.list().map((g) => ({
          id: g.id,
          title: g.title,
          status: g.status,
          project: g.project,
          running: ctx.goals!.engine.isRunning(g.id),
        }))
      : []
    return {
      success: true,
      data: {
        awaiting: runner.awaitingApproval(),
        runningActions: runner.runningNames(),
        runningGoals: goals.filter((g) => g.running),
        goals: goals.filter((g) => !g.running).slice(0, 8),
        routines: scheduler?.nextRuns() ?? [],
        recent: runLog.recentAll(12),
      },
    }
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
    const unsubscribe = runner.subscribe(name, send)
    const keepalive = setInterval(() => reply.raw.write(': ping\n\n'), 15000)
    reply.raw.on('close', () => {
      clearInterval(keepalive)
      unsubscribe()
    })
    await new Promise<void>((resolve) => reply.raw.on('close', () => resolve()))
  })
}
