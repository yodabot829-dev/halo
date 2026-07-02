import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { parseConfig } from '../src/config/load.js'
import { makePanelJudge } from '../src/goals/judge.js'
import type { Goal } from '../src/goals/goal-file.js'
import { Meter } from '../src/meter/meter.js'
import type { ModelEntry, ModelSource } from '../src/providers/registry.js'

const config = parseConfig(`
vault: { path: /v }
providers:
  ollama: { kind: ollama }
models:
  - { ref: ollama/mock, classes: [reason], tier: free }
`)

const ENTRY: ModelEntry = {
  ref: 'ollama/mock',
  provider: 'ollama',
  modelId: 'mock',
  classes: ['reason'],
  tier: 'free',
  label: 'Mock',
  available: true,
}

const GOAL: Goal = {
  id: 'g',
  title: 'g',
  status: 'running',
  project: 'demo',
  executor: 'fake',
  objective: 'do it',
  criteria: ['a'],
  iterations: 1,
  log: [],
}

/** Model that returns queued replies in order — one per judge call. */
function scriptedSource(replies: string[]): ModelSource {
  let i = 0
  return {
    list: () => [ENTRY],
    resolve: () =>
      new MockLanguageModelV3({
        doGenerate: async () => ({
          finishReason: 'stop',
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
          content: [{ type: 'text', text: replies[Math.min(i++, replies.length - 1)]! }],
          warnings: [],
        }),
      }),
  }
}

describe('makePanelJudge', () => {
  it('passes only when all three lenses approve', async () => {
    const meter = new Meter(':memory:')
    const judge = makePanelJudge(
      scriptedSource(['{"met":true,"feedback":"ok"}']),
      config,
      meter,
    )
    const verdict = await judge(GOAL, 'the work is done, here is evidence')
    expect(verdict.met).toBe(true)
    // three judge calls metered
    expect(meter.totals()[0]?.calls).toBe(3)
    meter.close()
  })

  it('fails and aggregates dissent when any lens rejects', async () => {
    const meter = new Meter(':memory:')
    const judge = makePanelJudge(
      scriptedSource([
        '{"met":true,"feedback":"literally fine"}',
        '{"met":false,"feedback":"no evidence of the file"}',
        '{"met":true,"feedback":"seems ok"}',
      ]),
      config,
      meter,
    )
    const verdict = await judge(GOAL, 'claims done but shows nothing')
    expect(verdict.met).toBe(false)
    expect(verdict.feedback).toContain('no evidence')
    meter.close()
  })
})
