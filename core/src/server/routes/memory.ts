import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../app.js'

const searchQuerySchema = z.object({
  q: z.string().min(1).max(1000),
  k: z.coerce.number().int().min(1).max(50).default(8),
})

const createNoteSchema = z.object({
  title: z.string().min(1).max(200),
  type: z.enum(['fact', 'feedback', 'project', 'reference', 'session']).default('fact'),
  description: z.string().max(500).default(''),
  tags: z.array(z.string().max(50)).max(20).default([]),
  content: z.string().min(1).max(64_000),
})

export function registerMemoryRoutes(app: FastifyInstance, ctx: AppContext): void {
  if (!ctx.memory) return

  app.get('/api/memory/search', async (req, reply) => {
    const parsed = searchQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'invalid query' })
    }
    const results = await ctx.memory!.search(parsed.data.q, parsed.data.k)
    return { success: true, data: results }
  })

  app.post('/api/memory', async (req, reply) => {
    const parsed = createNoteSchema.safeParse(req.body)
    if (!parsed.success) {
      app.log.warn({ issues: parsed.error.issues }, 'invalid memory note')
      return reply.code(400).send({ success: false, error: 'invalid request body' })
    }
    const path = ctx.memory!.writeNote({ ...parsed.data, source: 'halo-api' })
    return { success: true, data: { path } }
  })

  app.get('/api/memory/stats', async () => ({
    success: true,
    data: ctx.memoryStats?.() ?? null,
  }))

  app.get('/api/memory/projects', async () => ({
    success: true,
    data: ctx.memory!.projectStats(),
  }))

  app.get('/api/memory/notes', async (req, reply) => {
    const parsed = z
      .object({
        project: z.string().min(1).max(100),
        limit: z.coerce.number().int().min(1).max(50).default(10),
      })
      .safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'invalid query' })
    }
    return {
      success: true,
      data: ctx.memory!.recentNotes(parsed.data.project, parsed.data.limit),
    }
  })
}
