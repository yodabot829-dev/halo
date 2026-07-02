import { describe, expect, it } from 'vitest'
import { isLoopback, tokenMatches } from '../src/server/auth.js'

describe('isLoopback', () => {
  it('accepts loopback addresses', () => {
    expect(isLoopback('127.0.0.1')).toBe(true)
    expect(isLoopback('::1')).toBe(true)
    expect(isLoopback('localhost')).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isLoopback('0.0.0.0')).toBe(false)
    expect(isLoopback('100.64.1.2')).toBe(false)
    expect(isLoopback('192.168.1.10')).toBe(false)
  })
})

describe('tokenMatches', () => {
  it('matches a correct bearer header', () => {
    expect(tokenMatches('Bearer secret-123', 'secret-123')).toBe(true)
  })

  it('rejects wrong token, wrong scheme, missing header', () => {
    expect(tokenMatches('Bearer wrong', 'secret-123')).toBe(false)
    expect(tokenMatches('Basic secret-123', 'secret-123')).toBe(false)
    expect(tokenMatches(undefined, 'secret-123')).toBe(false)
    expect(tokenMatches('', 'secret-123')).toBe(false)
  })

  it('rejects length mismatches without throwing', () => {
    expect(tokenMatches('Bearer s', 'secret-123')).toBe(false)
    expect(tokenMatches(`Bearer ${'x'.repeat(500)}`, 'secret-123')).toBe(false)
  })
})
