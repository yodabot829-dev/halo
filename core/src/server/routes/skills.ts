import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../app.js'
import { createSkill, defaultSkillDirs, listProposals } from '../../skills/proposals.js'

export function registerSkillRoutes(app: FastifyInstance, ctx: AppContext): void {
  const dirs = ctx.skillDirs ?? defaultSkillDirs()

  app.get('/api/skill-proposals', async () => ({
    success: true,
    data: listProposals(dirs),
  }))

  app.post('/api/skill-proposals/:name/create', async (req, reply) => {
    const { name } = req.params as { name: string }
    try {
      const { path } = createSkill(dirs, name)
      return { success: true, data: { name, path } }
    } catch (err) {
      return reply.code(400).send({ success: false, error: (err as Error).message })
    }
  })
}
