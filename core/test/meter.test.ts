import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Meter } from '../src/meter/meter.js'

describe('Meter', () => {
  let meter: Meter

  beforeEach(() => {
    meter = new Meter(':memory:')
  })

  afterEach(() => {
    meter.close()
  })

  it('records calls and aggregates per provider', () => {
    meter.record({
      provider: 'synthetic',
      model: 'hf:zai-org/GLM-5',
      taskClass: 'chat',
      inputTokens: 100,
      outputTokens: 50,
      ok: true,
    })
    meter.record({
      provider: 'synthetic',
      model: 'hf:moonshotai/Kimi-K2.5',
      taskClass: 'code',
      inputTokens: 200,
      outputTokens: 80,
      ok: true,
    })
    meter.record({
      provider: 'ollama',
      model: 'gemma3:12b',
      taskClass: 'chat',
      inputTokens: 10,
      outputTokens: 5,
      ok: true,
    })

    const totals = meter.totals()
    expect(totals).toEqual([
      { provider: 'ollama', calls: 1, inputTokens: 10, outputTokens: 5 },
      { provider: 'synthetic', calls: 2, inputTokens: 300, outputTokens: 130 },
    ])
  })

  it('filters by since timestamp', () => {
    meter.record(
      { provider: 'a', model: 'm', taskClass: 'chat', inputTokens: 1, outputTokens: 1, ok: true },
      1000,
    )
    meter.record(
      { provider: 'a', model: 'm', taskClass: 'chat', inputTokens: 2, outputTokens: 2, ok: true },
      2000,
    )
    expect(meter.totals(1500)).toEqual([
      { provider: 'a', calls: 1, inputTokens: 2, outputTokens: 2 },
    ])
  })

  it('persists cost per call and sums it per provider', () => {
    meter.record({
      provider: 'claude-code',
      model: 'claude-sonnet-4-5',
      taskClass: 'goal-exec',
      inputTokens: 10,
      outputTokens: 5,
      ok: true,
      costUsd: 0.25,
    })
    meter.record({
      provider: 'claude-code',
      model: 'claude-sonnet-4-5',
      taskClass: 'goal-exec',
      inputTokens: 10,
      outputTokens: 5,
      ok: true,
      costUsd: 0.5,
    })
    expect(meter.costSince(0).get('claude-code')).toBeCloseTo(0.75)
  })

  it('records failed calls too', () => {
    meter.record({
      provider: 'a',
      model: 'm',
      taskClass: 'chat',
      inputTokens: 0,
      outputTokens: 0,
      ok: false,
    })
    expect(meter.totals()[0]?.calls).toBe(1)
  })
})
