import matter from 'gray-matter'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type RunStatus =
  | 'running'
  | 'done'
  | 'failed'
  | 'stopped'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'

export interface RunRecord {
  id: string // <timestamp>-<action>
  action: string
  status: RunStatus
  startedAt: string
  finishedAt?: string
  executor: string
  project: string
  /** Final output (RESULT summary or tail). For approval actions the draft. */
  output: string
  /** Phase of a two-phase (approval) action. */
  phase?: 'draft' | 'apply'
  /** For apply runs: the draft run id they execute. */
  appliedFrom?: string
  /** Reviewer feedback on rejection — feeds the next run's loop history. */
  feedback?: string
}

/** Runs live as markdown in the vault (OS/Runs/<action>/<id>.md) — the
 * state that makes loops self-improving: future runs read past runs. */
export class RunLog {
  constructor(private readonly dir: string) {}

  private actionDir(action: string): string {
    return join(this.dir, action)
  }

  save(run: RunRecord): void {
    mkdirSync(this.actionDir(run.action), { recursive: true })
    const body = matter.stringify(`## Output\n${run.output}\n`, {
      action: run.action,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? null,
      executor: run.executor,
      project: run.project,
      ...(run.phase ? { phase: run.phase } : {}),
      ...(run.appliedFrom ? { appliedFrom: run.appliedFrom } : {}),
      ...(run.feedback ? { feedback: run.feedback } : {}),
    })
    writeFileSync(join(this.actionDir(run.action), `${run.id}.md`), body, 'utf8')
  }

  get(action: string, id: string): RunRecord | undefined {
    if (!/^[A-Za-z0-9-]+$/.test(id)) return undefined
    const file = `${id}.md`
    if (!existsSync(join(this.actionDir(action), file))) return undefined
    return this.parse(action, file)
  }

  /** Most recent runs for one action, newest first. */
  recent(action: string, limit: number): RunRecord[] {
    const dir = this.actionDir(action)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, limit)
      .map((f) => this.parse(action, f))
  }

  /** Most recent runs across all actions, newest first. */
  recentAll(limit: number): RunRecord[] {
    if (!existsSync(this.dir)) return []
    const all: { action: string; file: string }[] = []
    for (const action of readdirSync(this.dir, { withFileTypes: true })) {
      if (!action.isDirectory()) continue
      for (const f of readdirSync(this.actionDir(action.name))) {
        if (f.endsWith('.md')) all.push({ action: action.name, file: f })
      }
    }
    return all
      .sort((a, b) => b.file.localeCompare(a.file))
      .slice(0, limit)
      .map(({ action, file }) => this.parse(action, file))
  }

  private parse(action: string, file: string): RunRecord {
    const raw = readFileSync(join(this.actionDir(action), file), 'utf8')
    const { data, content } = matter(raw)
    const meta = data as Record<string, unknown>
    return {
      id: file.replace(/\.md$/, ''),
      action,
      status: (meta['status'] as RunStatus) ?? 'done',
      startedAt: String(meta['startedAt'] ?? ''),
      finishedAt: meta['finishedAt'] ? String(meta['finishedAt']) : undefined,
      executor: String(meta['executor'] ?? ''),
      project: String(meta['project'] ?? ''),
      output: content.replace(/^## Output\n/, '').trim(),
      phase: meta['phase'] ? (meta['phase'] as 'draft' | 'apply') : undefined,
      appliedFrom: meta['appliedFrom'] ? String(meta['appliedFrom']) : undefined,
      feedback: meta['feedback'] ? String(meta['feedback']) : undefined,
    }
  }
}
