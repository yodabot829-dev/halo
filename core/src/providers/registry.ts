import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'
import { createOllama } from 'ollama-ai-provider-v2'
import { binaryExists } from '../executor/which.js'
import {
  parseModelRef,
  type HaloConfig,
  type ProviderConfig,
  type TaskClass,
  type Tier,
} from '../config/schema.js'

export interface ModelEntry {
  ref: string
  provider: string
  modelId: string
  classes: readonly TaskClass[]
  tier: Tier
  label: string
  available: boolean
}

/** Minimal surface the server needs; tests provide stubs with mock models. */
export interface ModelSource {
  list(): readonly ModelEntry[]
  resolve(ref: string): LanguageModel
}

type ModelFactory = (modelId: string) => LanguageModel

function makeFactory(p: ProviderConfig, apiKey: string | undefined): ModelFactory {
  switch (p.kind) {
    case 'anthropic':
      return (id) => createAnthropic({ apiKey, baseURL: p.baseURL })(id)
    case 'openai':
      return (id) => createOpenAI({ apiKey, baseURL: p.baseURL })(id)
    case 'google':
      return (id) => createGoogleGenerativeAI({ apiKey, baseURL: p.baseURL })(id)
    case 'openrouter':
      return (id) => createOpenRouter({ apiKey, baseURL: p.baseURL }).chat(id)
    case 'ollama':
      return (id) => createOllama({ baseURL: p.baseURL })(id)
    case 'claude-code':
      // Not an API model — the chat route dispatches these via the CLI bridge.
      return () => {
        throw new Error('claude-code is a chat bridge, not an API model — resolve() must not be called')
      }
  }
}

/**
 * Maps "provider/model-id" refs to AI SDK LanguageModel instances.
 * A model is available when its provider needs no key (ollama) or the
 * configured env var is set — keys come from Infisical-injected env, never files.
 */
export class ModelRegistry implements ModelSource {
  private readonly entries: ModelEntry[]
  private readonly factories: Map<string, ModelFactory>

  constructor(config: HaloConfig, env: NodeJS.ProcessEnv = process.env) {
    this.factories = new Map()
    const availability = new Map<string, boolean>()

    for (const [name, provider] of Object.entries(config.providers)) {
      const apiKey = provider.apiKeyEnv ? env[provider.apiKeyEnv] : undefined
      let available: boolean
      if (provider.kind === 'ollama') available = true
      else if (provider.kind === 'claude-code') available = binaryExists(provider.command ?? 'claude')
      else available = Boolean(apiKey)
      availability.set(name, available)
      this.factories.set(name, makeFactory(provider, apiKey))
    }

    this.entries = config.models.map((m) => {
      const { provider, modelId } = parseModelRef(m.ref)
      return {
        ref: m.ref,
        provider,
        modelId,
        classes: m.classes,
        tier: m.tier,
        label: m.label ?? modelId,
        available: availability.get(provider) ?? false,
      }
    })
  }

  list(): readonly ModelEntry[] {
    return this.entries
  }

  resolve(ref: string): LanguageModel {
    const { provider, modelId } = parseModelRef(ref)
    const factory = this.factories.get(provider)
    if (!factory) throw new Error(`Unknown provider "${provider}" for model ref "${ref}"`)
    return factory(modelId)
  }
}
