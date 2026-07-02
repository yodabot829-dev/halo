import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseConfig } from '../src/config/load.js'
import { Meter } from '../src/meter/meter.js'
import { budgetStatus, exhaustedProviders, monthStart } from '../src/router/budget.js'

const config = parseConfig(`
vault: { path: /v }
providers:
  synthetic: { kind: anthropic, apiKeyEnv: SYNTHETIC_API_KEY }
  anthropic: { kind: anthropic, apiKeyEnv: ANTHROPIC_API_KEY }
  ollama: { kind: ollama }
budgets:
  synthetic: { monthlyTokens: 1000 }
models:
  - { ref: ollama/gemma3:12b, classes: [chat], tier: free }
`)

describe('budgetStatus', () => {
  let meter: Meter

  beforeEach(() => {
    meter = new Meter(':memory:')
  })

  afterEach(() => meter.close())

  const NOW = new Date(2026, 6, 2) // 2 July 2026

  it('computes remaining tokens for budgeted providers', () => {
    meter.record(
      { provider: 'synthetic', model: 'm', taskClass: 'chat', inputTokens: 300, outputTokens: 100, ok: true },
      NOW.getTime() - 1000,
    )
    const statuses = budgetStatus(config, meter, NOW)
    const synthetic = statuses.find((s) => s.provider === 'synthetic')
    expect(synthetic).toEqual({
      provider: 'synthetic',
      monthlyTokens: 1000,
      usedTokens: 400,
      remainingTokens: 600,
    })
  })

  it('treats unbudgeted providers as unmetered', () => {
    const statuses = budgetStatus(config, meter, NOW)
    expect(statuses.find((s) => s.provider === 'anthropic')?.remainingTokens).toBeNull()
    expect(statuses.find((s) => s.provider === 'ollama')?.remainingTokens).toBeNull()
  })

  it('ignores usage from previous months', () => {
    meter.record(
      { provider: 'synthetic', model: 'm', taskClass: 'chat', inputTokens: 900, outputTokens: 0, ok: true },
      monthStart(NOW) - 1,
    )
    const synthetic = budgetStatus(config, meter, NOW).find((s) => s.provider === 'synthetic')
    expect(synthetic?.usedTokens).toBe(0)
    expect(synthetic?.remainingTokens).toBe(1000)
  })

  it('flags exhausted providers, clamped at zero', () => {
    meter.record(
      { provider: 'synthetic', model: 'm', taskClass: 'chat', inputTokens: 2000, outputTokens: 0, ok: true },
      NOW.getTime() - 1000,
    )
    const statuses = budgetStatus(config, meter, NOW)
    expect(statuses.find((s) => s.provider === 'synthetic')?.remainingTokens).toBe(0)
    expect(exhaustedProviders(statuses)).toEqual(new Set(['synthetic']))
  })
})
