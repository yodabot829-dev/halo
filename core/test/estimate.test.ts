import { describe, expect, it } from 'vitest'
import { estimateTokens } from '../src/server/routes/chat.js'

describe('estimateTokens', () => {
  it('estimates ~4 chars per token, rounding up', () => {
    expect(estimateTokens(0)).toBe(0)
    expect(estimateTokens(1)).toBe(1)
    expect(estimateTokens(4)).toBe(1)
    expect(estimateTokens(1000)).toBe(250)
    expect(estimateTokens(1001)).toBe(251)
  })
})
