import { describe, expect, it } from 'vitest'
import { parseConfig } from '../src/config/load.js'
import type { ModelEntry } from '../src/providers/registry.js'
import { selectModel } from '../src/router/select.js'

const config = parseConfig(`
vault: { path: /v }
providers:
  ollama: { kind: ollama }
  synthetic: { kind: anthropic, apiKeyEnv: SYNTHETIC_API_KEY }
  anthropic: { kind: anthropic, apiKeyEnv: ANTHROPIC_API_KEY }
models:
  - { ref: ollama/gemma3:12b, classes: [chat, summarise], tier: free }
  - { ref: synthetic/hf:zai-org/GLM-5, classes: [chat, code, reason], tier: quota }
  - { ref: anthropic/claude-sonnet-5, classes: [chat, code, reason, vision], tier: premium }
routing:
  classOrder:
    chat: [quota, free]
`)

const entry = (
  ref: string,
  classes: ModelEntry['classes'],
  tier: ModelEntry['tier'],
  available = true,
): ModelEntry => {
  const slash = ref.indexOf('/')
  return {
    ref,
    provider: ref.slice(0, slash),
    modelId: ref.slice(slash + 1),
    classes,
    tier,
    label: ref,
    available,
  }
}

const MODELS: ModelEntry[] = [
  entry('ollama/gemma3:12b', ['chat', 'summarise'], 'free'),
  entry('synthetic/hf:zai-org/GLM-5', ['chat', 'code', 'reason'], 'quota'),
  entry('anthropic/claude-sonnet-5', ['chat', 'code', 'reason', 'vision'], 'premium'),
]

describe('selectModel', () => {
  it('honours configured class order (chat → quota first)', () => {
    const sel = selectModel('chat', MODELS, config)
    expect(sel.entry.ref).toBe('synthetic/hf:zai-org/GLM-5')
    expect(sel.reason).toContain('tier=quota')
  })

  it('uses default order for unconfigured classes (code → premium first)', () => {
    const sel = selectModel('code', MODELS, config)
    expect(sel.entry.ref).toBe('anthropic/claude-sonnet-5')
  })

  it('skips unavailable models', () => {
    const models = [
      entry('anthropic/claude-sonnet-5', ['code'], 'premium', false),
      entry('synthetic/hf:zai-org/GLM-5', ['code'], 'quota'),
    ]
    const sel = selectModel('code', models, config)
    expect(sel.entry.ref).toBe('synthetic/hf:zai-org/GLM-5')
  })

  it('user override always wins', () => {
    const sel = selectModel('chat', MODELS, config, 'anthropic/claude-sonnet-5')
    expect(sel.entry.ref).toBe('anthropic/claude-sonnet-5')
    expect(sel.reason).toBe('user override')
  })

  it('rejects an override that is not available', () => {
    const models = [
      entry('ollama/gemma3:12b', ['chat'], 'free'),
      entry('anthropic/claude-sonnet-5', ['chat'], 'premium', false),
    ]
    expect(() => selectModel('chat', models, config, 'anthropic/claude-sonnet-5')).toThrow(
      /not available/,
    )
  })

  it('falls back to any available model when nothing declares the class', () => {
    const models = [entry('ollama/gemma3:12b', ['chat'], 'free')]
    const sel = selectModel('vision', models, config)
    expect(sel.entry.ref).toBe('ollama/gemma3:12b')
    expect(sel.reason).toContain('fallback')
  })

  it('throws when no models are available at all', () => {
    const models = [entry('ollama/gemma3:12b', ['chat'], 'free', false)]
    expect(() => selectModel('chat', models, config)).toThrow(/No models available/)
  })

  it('skips providers with exhausted budgets and says so', () => {
    const sel = selectModel('chat', MODELS, config, undefined, new Set(['synthetic']))
    expect(sel.entry.ref).toBe('ollama/gemma3:12b')
    expect(sel.reason).toContain('budget exhausted')
  })

  it('user override beats an exhausted budget', () => {
    const sel = selectModel(
      'chat',
      MODELS,
      config,
      'synthetic/hf:zai-org/GLM-5',
      new Set(['synthetic']),
    )
    expect(sel.entry.ref).toBe('synthetic/hf:zai-org/GLM-5')
  })
})
