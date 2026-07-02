import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MemoryService } from './service.js'

/** Project-scoped chat context: STATE.md + the project's freshest memory,
 * as plain markdown any model can use. */
export function buildProjectContext(
  project: string,
  projectPath: string | undefined,
  memory: MemoryService | undefined,
  maxChars = 6000,
): string | null {
  const parts: string[] = []

  if (projectPath) {
    const statePath = join(projectPath, 'STATE.md')
    if (existsSync(statePath)) {
      parts.push(`### ${project}/STATE.md\n${readFileSync(statePath, 'utf8').slice(0, 2500)}`)
    }
    if (existsSync(join(projectPath, 'graphify-out'))) {
      parts.push(`(A graphify-out/ knowledge graph exists in this repo at ${projectPath}.)`)
    }
  }

  if (memory) {
    const notes = memory.recentNotes(project, 4)
    for (const note of notes) {
      const full = memory.contextFor([{ path: note.path, title: note.title, snippet: '', score: 0 }])
      if (full[0]) parts.push(`### ${full[0].title}\n${full[0].content}`)
    }
  }

  if (parts.length === 0) return null
  const block = parts.join('\n\n')
  return `## Active project: ${project}\nThe user is asking in the context of this project.\n\n${block}`.slice(
    0,
    maxChars,
  )
}
