import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from '../src/memory/context.js'

describe('buildSystemPrompt', () => {
  it('returns undefined with no persona and no memory', () => {
    expect(buildSystemPrompt(null, [])).toBeUndefined()
  })

  it('returns persona alone', () => {
    expect(buildSystemPrompt('You are Cortana.', [])).toBe('You are Cortana.')
  })

  it('appends memory notes as plain markdown sections', () => {
    const prompt = buildSystemPrompt('You are Cortana.', [
      { title: 'Trading bot', content: 'Runs via launchd.' },
    ])
    expect(prompt).toContain('You are Cortana.')
    expect(prompt).toContain('## Memory')
    expect(prompt).toContain('### Trading bot')
    expect(prompt).toContain('Runs via launchd.')
  })

  it('works memory-only (no persona)', () => {
    const prompt = buildSystemPrompt(null, [{ title: 'A', content: 'B' }])
    expect(prompt).toContain('### A')
    expect(prompt).not.toContain('undefined')
  })
})
