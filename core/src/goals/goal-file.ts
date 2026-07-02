import matter from 'gray-matter'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { slugify } from '../memory/note.js'

export const GOAL_STATUSES = ['pending', 'running', 'done', 'failed', 'stopped'] as const
export type GoalStatus = (typeof GOAL_STATUSES)[number]

export interface Goal {
  id: string
  title: string
  status: GoalStatus
  project: string
  executor: string
  objective: string
  criteria: string[]
  iterations: number
  log: string[]
}

export function serializeGoal(goal: Goal): string {
  const body = [
    `## Objective\n${goal.objective}`,
    `## Success criteria\n${goal.criteria.map((c) => `- ${c}`).join('\n')}`,
    `## Log\n${goal.log.map((l) => `- ${l}`).join('\n')}`,
  ].join('\n\n')
  return matter.stringify(`${body}\n`, {
    title: goal.title,
    status: goal.status,
    project: goal.project,
    executor: goal.executor,
    iterations: goal.iterations,
  })
}

function section(body: string, heading: string): string {
  const re = new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm')
  return body.match(re)?.[1]?.trim() ?? ''
}

export function parseGoal(id: string, raw: string): Goal {
  const { data, content } = matter(raw)
  const meta = data as Record<string, unknown>
  const status = GOAL_STATUSES.includes(meta['status'] as GoalStatus)
    ? (meta['status'] as GoalStatus)
    : 'pending'
  const listItems = (text: string) =>
    text
      .split('\n')
      .map((l) => l.replace(/^- /, '').trim())
      .filter(Boolean)
  return {
    id,
    title: String(meta['title'] ?? id),
    status,
    project: String(meta['project'] ?? ''),
    executor: String(meta['executor'] ?? 'claude-code'),
    iterations: Number(meta['iterations'] ?? 0),
    objective: section(content, 'Objective'),
    criteria: listItems(section(content, 'Success criteria')),
    log: listItems(section(content, 'Log')),
  }
}

/** Goals live as markdown in the vault — reviewable, editable, versionable. */
export class GoalStore {
  constructor(private readonly dir: string) {}

  list(): Goal[] {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => parseGoal(f.replace(/\.md$/, ''), readFileSync(join(this.dir, f), 'utf8')))
  }

  get(id: string): Goal | undefined {
    const abs = join(this.dir, `${id}.md`)
    if (!existsSync(abs) || !/^[a-z0-9-]+$/.test(id)) return undefined
    return parseGoal(id, readFileSync(abs, 'utf8'))
  }

  save(goal: Goal): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, `${goal.id}.md`), serializeGoal(goal), 'utf8')
  }

  create(input: Omit<Goal, 'id' | 'status' | 'iterations' | 'log'>): Goal {
    let id = slugify(input.title)
    for (let i = 2; this.get(id); i++) id = `${slugify(input.title)}-${i}`
    const goal: Goal = { ...input, id, status: 'pending', iterations: 0, log: [] }
    this.save(goal)
    return goal
  }
}
