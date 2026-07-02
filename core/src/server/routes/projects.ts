import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { gatherProjectInfo, type ProjectInfo } from '../../projects/info.js'
import type { AppContext } from '../app.js'

const CACHE_MS = 60_000

const GRAPH_PROMPT = `Use the /graphify skill to build or update the knowledge graph
for this repository, writing to graphify-out/. If graphify-out/ already exists,
update it incrementally rather than rebuilding. When done, report the number of
nodes, communities, and god nodes.`

const askPrompt = (question: string) => `Question about this repository: ${question}

If a graphify-out/ knowledge graph exists here, answer by querying it (god nodes,
communities, paths) — it is faster and grounded. Otherwise answer by exploring the
repo directly. Be concise and specific; cite file paths.`

export function registerProjectRoutes(app: FastifyInstance, ctx: AppContext): void {
  let cache: { at: number; data: ProjectInfo[] } | null = null

  app.get('/api/projects', async () => {
    if (!cache || Date.now() - cache.at > CACHE_MS) {
      const data = await Promise.all(
        Object.entries(ctx.config.projects).map(([name, path]) => gatherProjectInfo(name, path)),
      )
      cache = {
        at: Date.now(),
        data: [...data].sort((a, b) => (b.lastCommitAt ?? '').localeCompare(a.lastCommitAt ?? '')),
      }
    }
    return { success: true, data: cache.data }
  })

  app.post('/api/projects/:name/graph', async (req, reply) => {
    const { name } = req.params as { name: string }
    if (!ctx.actions || !(name in ctx.config.projects)) {
      return reply.code(400).send({ success: false, error: 'unknown project' })
    }
    try {
      const promise = ctx.actions.runner.runAdhoc(`graphify-${name}`, name, GRAPH_PROMPT)
      promise.catch((err) => app.log.error(err, `graphify ${name} failed`))
      return { success: true, data: { queued: true, action: `graphify-${name}` } }
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message })
    }
  })

  app.post('/api/projects/:name/ask', async (req, reply) => {
    const { name } = req.params as { name: string }
    const parsed = z.object({ question: z.string().min(3).max(1000) }).safeParse(req.body)
    if (!ctx.actions || !(name in ctx.config.projects)) {
      return reply.code(400).send({ success: false, error: 'unknown project' })
    }
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'invalid question' })
    }
    try {
      const promise = ctx.actions.runner.runAdhoc(`ask-${name}`, name, askPrompt(parsed.data.question))
      promise.catch((err) => app.log.error(err, `ask ${name} failed`))
      return { success: true, data: { queued: true, action: `ask-${name}` } }
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message })
    }
  })
}
