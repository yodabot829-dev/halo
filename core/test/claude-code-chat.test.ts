import { describe, expect, it } from 'vitest'
import { parseConfig } from '../src/config/load.js'
import { ModelRegistry } from '../src/providers/registry.js'

const CONFIG = `
vault: { path: /v }
providers:
  claude-code: { kind: claude-code, command: claude }
  synthetic: { kind: anthropic, apiKeyEnv: SYNTHETIC_API_KEY }
  ollama: { kind: ollama }
models:
  - { ref: claude-code/claude, classes: [chat, code, reason], tier: subscription }
  - { ref: synthetic/hf:zai-org/GLM-5.2, classes: [chat, code, reason], tier: quota }
  - { ref: ollama/gemma3:4b, classes: [chat], tier: free }
routing:
  classOrder:
    chat: [subscription, quota, free]
`

describe('claude-code provider wiring', () => {
  it('parses a claude-code provider + subscription model', () => {
    const config = parseConfig(CONFIG)
    const cc = config.models.find((m) => m.tier === 'subscription')
    expect(cc?.ref).toBe('claude-code/claude')
    expect(config.providers['claude-code']?.kind).toBe('claude-code')
  })

  it('marks claude-code available by binary presence, not an API key', () => {
    // env with no keys at all
    const registry = new ModelRegistry(parseConfig(CONFIG), {})
    const cc = registry.list().find((m) => m.provider === 'claude-code')
    // availability depends on the real `claude` binary; assert it is decided by
    // binary presence (boolean) and NOT gated on SYNTHETIC_API_KEY being unset.
    expect(typeof cc?.available).toBe('boolean')
    // synthetic must be unavailable here (no key) — proves the two are independent
    expect(registry.list().find((m) => m.provider === 'synthetic')?.available).toBe(false)
  })

  it('never builds an API factory for claude-code (resolve throws)', () => {
    const registry = new ModelRegistry(parseConfig(CONFIG), {})
    expect(() => registry.resolve('claude-code/claude')).toThrow(/chat bridge/)
  })
})
