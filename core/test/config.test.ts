import { describe, expect, it } from 'vitest'
import { parseConfig } from '../src/config/load.js'
import { parseModelRef } from '../src/config/schema.js'

const VALID = `
vault:
  path: ~/vault
providers:
  ollama:
    kind: ollama
    baseURL: http://127.0.0.1:11434/api
  synthetic:
    kind: anthropic
    baseURL: https://api.synthetic.new/anthropic/v1
    apiKeyEnv: SYNTHETIC_API_KEY
models:
  - ref: ollama/gemma3:12b
    classes: [chat, summarise]
    tier: free
  - ref: synthetic/hf:MiniMaxAI/MiniMax-M2.5
    classes: [chat, code]
    tier: quota
`

describe('parseConfig', () => {
  it('parses valid config and applies defaults', () => {
    const config = parseConfig(VALID)
    expect(config.server.port).toBe(4720)
    expect(config.server.bind).toBe('127.0.0.1')
    expect(config.vault.memoryDir).toBe('OS/Memory')
    expect(config.models).toHaveLength(2)
  })

  it('expands ~ in vault path', () => {
    const config = parseConfig(VALID)
    expect(config.vault.path.startsWith('/')).toBe(true)
    expect(config.vault.path).not.toContain('~')
  })

  it('rejects a model referencing an unknown provider', () => {
    const bad = VALID.replace('ref: ollama/gemma3:12b', 'ref: nope/gemma3:12b')
    expect(() => parseConfig(bad)).toThrow(/unknown provider "nope"/)
  })

  it('rejects empty models list', () => {
    const bad = `
vault: { path: /v }
providers: {}
models: []
`
    expect(() => parseConfig(bad)).toThrow()
  })
})

describe('terminal config', () => {
  it('defaults the terminal section to a Claude session', () => {
    const config = parseConfig(VALID)
    expect(config.terminal.scrollbackBytes).toBe(200_000)
    expect(config.terminal.command).toBe('claude')
    expect(config.terminal.args).toEqual([])
  })

  it('accepts explicit terminal settings', () => {
    const config = parseConfig(`${VALID}
terminal:
  command: /bin/bash
  args: [-l]
  scrollbackBytes: 50000
`)
    expect(config.terminal.command).toBe('/bin/bash')
    expect(config.terminal.args).toEqual(['-l'])
    expect(config.terminal.scrollbackBytes).toBe(50_000)
  })
})

describe('parseModelRef', () => {
  it('splits on the first slash only', () => {
    expect(parseModelRef('synthetic/hf:MiniMaxAI/MiniMax-M2.5')).toEqual({
      provider: 'synthetic',
      modelId: 'hf:MiniMaxAI/MiniMax-M2.5',
    })
  })

  it('throws on refs without a provider or model id', () => {
    expect(() => parseModelRef('nomodel')).toThrow(/Invalid model ref/)
    expect(() => parseModelRef('provider/')).toThrow(/Invalid model ref/)
  })
})
