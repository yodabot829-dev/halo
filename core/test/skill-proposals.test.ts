import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createSkill,
  latestAuditFile,
  listProposals,
  parseSkillAudit,
  type SkillDirs,
} from '../src/skills/proposals.js'

const REPORT = `# Skill Audit — 2026-07-16

## Proposals (ranked by frequency)

| Task | Freq (of 150) | Proposed skill | What it would do |
|---|---|---|---|
| Post-deploy verification | ~20 | \`/deploy-verify\` | Smoke-test a just-deployed Worker. |
| STATE.md upkeep | ~9 | (hook, not skill) | Better as a Stop hook. |
| PR sweep | ~14 | /pr-babysit | Sweep open PRs, reconcile ClickUp. |
`

describe('skill proposals', () => {
  let dirs: SkillDirs

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), 'halo-skills-'))
    dirs = { reportsDir: join(base, 'reports'), skillsDir: join(base, 'skills') }
    mkdirSync(dirs.reportsDir, { recursive: true })
    mkdirSync(dirs.skillsDir, { recursive: true })
  })

  afterEach(() => rmSync(join(dirs.reportsDir, '..'), { recursive: true, force: true }))

  it('parses proposal rows, skipping header/separator and non-skill rows', () => {
    const rows = parseSkillAudit(REPORT)
    expect(rows.map((r) => r.name)).toEqual(['deploy-verify', 'pr-babysit'])
    expect(rows[0].frequency).toBe('~20')
    expect(rows[0].what).toBe('Smoke-test a just-deployed Worker.')
  })

  it('picks the newest audit file by mtime and flags existing skills', () => {
    writeFileSync(join(dirs.reportsDir, 'skill-audit-2026-07-10.md'), '| a | b | /old-one | c |')
    writeFileSync(join(dirs.reportsDir, 'skill-audit-2026-07-16.md'), REPORT)
    const past = new Date(Date.now() - 60_000)
    utimesSync(join(dirs.reportsDir, 'skill-audit-2026-07-10.md'), past, past)
    expect(latestAuditFile(dirs.reportsDir)).toContain('2026-07-16')

    // same-day suffixed report written later must win despite sorting before ".md"
    writeFileSync(join(dirs.reportsDir, 'skill-audit-2026-07-16-pm.md'), REPORT)
    const future = new Date(Date.now() + 60_000)
    utimesSync(join(dirs.reportsDir, 'skill-audit-2026-07-16-pm.md'), future, future)
    expect(latestAuditFile(dirs.reportsDir)).toContain('-pm')

    mkdirSync(join(dirs.skillsDir, 'pr-babysit'), { recursive: true })
    writeFileSync(join(dirs.skillsDir, 'pr-babysit', 'SKILL.md'), 'x')
    const proposals = listProposals(dirs)
    expect(proposals.find((p) => p.name === 'pr-babysit')?.exists).toBe(true)
    expect(proposals.find((p) => p.name === 'deploy-verify')?.exists).toBe(false)
  })

  it('returns empty when no reports dir or no audit files', () => {
    expect(listProposals({ ...dirs, reportsDir: join(dirs.reportsDir, 'nope') })).toEqual([])
    expect(listProposals(dirs)).toEqual([])
  })

  it('scaffolds SKILL.md from a proposal and refuses duplicates and bad names', () => {
    writeFileSync(join(dirs.reportsDir, 'skill-audit-2026-07-16.md'), REPORT)
    const { path } = createSkill(dirs, 'deploy-verify')
    expect(existsSync(path)).toBe(true)
    const md = readFileSync(path, 'utf8')
    expect(md).toContain('name: deploy-verify')
    expect(md).toContain('trigger: /deploy-verify')
    expect(md).toContain('Smoke-test a just-deployed Worker.')

    expect(() => createSkill(dirs, 'deploy-verify')).toThrow(/already exists/)
    expect(() => createSkill(dirs, '../evil')).toThrow(/invalid skill name/)
    expect(() => createSkill(dirs, 'not-proposed')).toThrow(/no proposal/)
  })
})
