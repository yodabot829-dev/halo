import { describe, expect, it } from 'vitest'
import { aggregateProjectStats, deriveProject, monthOf } from '../src/memory/project-stats.js'

describe('deriveProject', () => {
  it('maps vault paths to projects', () => {
    expect(deriveProject('Claude Memory/aiprojects/2026-06/010157-note.md')).toBe('propertyinvestiq')
    expect(deriveProject('Claude Memory/yodaclaude/2026-05/006928-note.md')).toBe('yodaclaude')
    expect(deriveProject('OS/Memory/sessions/trading-bot/2026-06-01-s5-fix.md')).toBe('trading-bot')
    expect(deriveProject('OS/Memory/facts/imported/openclaw-workspace-yodaclaude-AIProjects/x.md')).toBe(
      'propertyinvestiq',
    )
    expect(deriveProject('OS/Memory/facts/ollama-context-cap.md')).toBe('halo')
    expect(deriveProject('Welcome.md')).toBe('other')
  })

  it('maps vault Projects folders including the Etsy store', () => {
    expect(deriveProject('Projects/JFStudioTemplates — Etsy Store/STATE.md')).toBe('etsy-store')
    expect(deriveProject('Projects/PropertyInvestor-AI/notes.md')).toBe('propertyinvestiq')
  })
})

describe('monthOf', () => {
  it('prefers a date found in the path', () => {
    expect(monthOf('Claude Memory/aiprojects/2026-06/010157.md', 0)).toBe('2026-06')
    expect(monthOf('OS/Memory/sessions/halo/2026-07-02-s1-x.md', 0)).toBe('2026-07')
  })

  it('falls back to mtime', () => {
    expect(monthOf('OS/Memory/facts/no-date.md', new Date(2026, 3, 15).getTime())).toBe('2026-04')
  })
})

describe('aggregateProjectStats', () => {
  it('aggregates totals, types, and months per project, sorted by size', () => {
    const notes = [
      { path: 'Claude Memory/aiprojects/2026-06/a.md', type: 'fact', mtime: 0 },
      { path: 'Claude Memory/aiprojects/2026-07/b.md', type: 'fact', mtime: 0 },
      { path: 'OS/Memory/sessions/aiprojects/2026-07-01-s1-c.md', type: 'session', mtime: 0 },
      { path: 'OS/Memory/facts/d.md', type: 'fact', mtime: new Date(2026, 6, 1).getTime() },
    ]
    const stats = aggregateProjectStats(notes)
    expect(stats[0]).toEqual({
      project: 'propertyinvestiq',
      total: 3,
      types: { fact: 2, session: 1 },
      months: { '2026-06': 1, '2026-07': 2 },
    })
    expect(stats[1]?.project).toBe('halo')
  })
})
