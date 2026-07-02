import { describe, expect, it } from 'vitest'
import { parseNote, serializeNote, slugify } from '../src/memory/note.js'

describe('parseNote', () => {
  it('reads frontmatter fields including nested metadata.type', () => {
    const raw = `---
name: watchlist-sqm
description: Root cause of SQM nulls
metadata:
  type: project
tags: [property, sqm]
---

The real cause was street-only addresses.`
    const note = parseNote('facts/watchlist-sqm.md', raw)
    expect(note.title).toBe('watchlist-sqm')
    expect(note.type).toBe('project')
    expect(note.description).toBe('Root cause of SQM nulls')
    expect(note.tags).toEqual(['property', 'sqm'])
    expect(note.content).toContain('street-only addresses')
  })

  it('falls back to filename title and fact type for bare markdown', () => {
    const note = parseNote('Claude Memory/some-session.md', 'Just prose, no frontmatter.')
    expect(note.title).toBe('some-session')
    expect(note.type).toBe('fact')
    expect(note.content).toBe('Just prose, no frontmatter.')
  })

  it('roundtrips through serializeNote', () => {
    const body = serializeNote({
      title: 'Test Note',
      type: 'reference',
      description: 'desc',
      tags: ['a', 'b'],
      source: 'unit-test',
      content: 'Body here.',
    })
    const parsed = parseNote('facts/test-note.md', body)
    expect(parsed.title).toBe('Test Note')
    expect(parsed.type).toBe('reference')
    expect(parsed.tags).toEqual(['a', 'b'])
    expect(parsed.source).toBe('unit-test')
    expect(parsed.content).toBe('Body here.')
  })
})

describe('slugify', () => {
  it('produces safe filenames', () => {
    expect(slugify('Fix the (SQM) nulls — now!')).toBe('fix-the-sqm-nulls-now')
    expect(slugify('***')).toBe('note')
  })
})
