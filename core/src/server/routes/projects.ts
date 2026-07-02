import type { FastifyInstance } from 'fastify'
import { gatherProjectInfo, type ProjectInfo } from '../../projects/info.js'
import type { AppContext } from '../app.js'

const CACHE_MS = 60_000

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
}
