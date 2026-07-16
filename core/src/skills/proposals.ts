import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** One row from a skill-audit report's proposals table. */
export interface SkillProposal {
  /** Skill slug without the leading slash, e.g. "deploy-verify". */
  name: string
  task: string
  frequency: string
  what: string
  /** True when ~/.claude/skills/<name>/SKILL.md already exists. */
  exists: boolean
}

export interface SkillDirs {
  reportsDir: string
  skillsDir: string
}

export function defaultSkillDirs(): SkillDirs {
  return {
    reportsDir: join(homedir(), 'Documents', 'Openclaw yodabot', 'OS', 'Reports'),
    skillsDir: join(homedir(), '.claude', 'skills'),
  }
}

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/

/** Newest skill-audit-*.md by filename — dates are zero-padded so lexical sort works. */
export function latestAuditFile(reportsDir: string): string | null {
  if (!existsSync(reportsDir)) return null
  const files = readdirSync(reportsDir)
    .filter((f) => f.startsWith('skill-audit-') && f.endsWith('.md'))
    .sort()
  const newest = files[files.length - 1]
  return newest ? join(reportsDir, newest) : null
}

/**
 * Extract proposals from the report's markdown table. Expected columns:
 * task | frequency | proposed skill | what it would do. Rows whose "proposed
 * skill" cell has no /slug (e.g. "(hook, not skill)") are skipped.
 */
export function parseSkillAudit(md: string): Omit<SkillProposal, 'exists'>[] {
  const proposals: Omit<SkillProposal, 'exists'>[] = []
  for (const line of md.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    const cells = line.split('|').map((c) => c.trim())
    // ['', task, freq, skill, what, ''] — anything else isn't a proposal row
    if (cells.length < 6) continue
    const slug = /`?\/([a-z0-9][a-z0-9-]*)`?/.exec(cells[3] ?? '')
    if (!slug?.[1]) continue
    proposals.push({
      name: slug[1],
      task: cells[1] ?? '',
      frequency: cells[2] ?? '',
      what: cells[4] ?? '',
    })
  }
  return proposals
}

/** Proposals from the latest audit report, flagged with whether they're built. */
export function listProposals(dirs: SkillDirs): SkillProposal[] {
  const file = latestAuditFile(dirs.reportsDir)
  if (!file) return []
  return parseSkillAudit(readFileSync(file, 'utf8')).map((p) => ({
    ...p,
    exists: existsSync(join(dirs.skillsDir, p.name, 'SKILL.md')),
  }))
}

/**
 * Scaffold ~/.claude/skills/<name>/SKILL.md from a proposal. The body is a
 * starting point copied from the audit's "what it would do" — meant to be
 * refined by hand or by an agent afterwards.
 */
export function createSkill(dirs: SkillDirs, name: string): { path: string } {
  if (!NAME_RE.test(name)) throw new Error(`invalid skill name: ${name}`)
  const proposal = listProposals(dirs).find((p) => p.name === name)
  if (!proposal) throw new Error(`no proposal named ${name} in the latest skill audit`)
  const dir = join(dirs.skillsDir, name)
  const path = join(dir, 'SKILL.md')
  if (existsSync(path)) throw new Error(`skill ${name} already exists`)
  mkdirSync(dir, { recursive: true })
  const description = proposal.what.replaceAll('"', "'")
  writeFileSync(
    path,
    `---
name: ${name}
description: "${description} Use when the user says /${name}."
trigger: /${name}
---

# /${name}

> Scaffolded from skill-audit proposal — refine before relying on it.

**Recurring task it automates:** ${proposal.task}

## What it should do

${proposal.what}
`,
  )
  return { path }
}
