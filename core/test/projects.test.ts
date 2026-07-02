import { describe, expect, it } from 'vitest'
import { bucketWeeks, parseStateNext, WEEKS } from '../src/projects/info.js'

describe('bucketWeeks', () => {
  const NOW = new Date('2026-07-02T12:00:00Z').getTime()

  it('buckets commits into weeks, newest last', () => {
    const dates = [
      '2026-07-01T10:00:00Z', // this week
      '2026-06-30T10:00:00Z', // this week
      '2026-06-20T10:00:00Z', // ~2 weeks ago
    ]
    const buckets = bucketWeeks(dates, NOW)
    expect(buckets).toHaveLength(WEEKS)
    expect(buckets[WEEKS - 1]).toBe(2)
    expect(buckets[WEEKS - 2]).toBe(1)
  })

  it('ignores commits older than the window', () => {
    const buckets = bucketWeeks(['2025-01-01T00:00:00Z'], NOW)
    expect(buckets.every((b) => b === 0)).toBe(true)
  })
})

describe('parseStateNext', () => {
  it('extracts the first Next bullet', () => {
    const md = `# State\n\n## Done\n- everything\n\n## Next\n- Ship slice 6\n- Then slice 7\n`
    expect(parseStateNext(md)).toBe('Ship slice 6')
  })

  it('returns null when there is no Next section', () => {
    expect(parseStateNext('# Nothing here')).toBeNull()
  })
})
