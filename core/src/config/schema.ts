import { z } from 'zod'

export const PROVIDER_KINDS = ['anthropic', 'openai', 'google', 'openrouter', 'ollama'] as const
export const TASK_CLASSES = ['chat', 'summarise', 'code', 'reason', 'vision'] as const
export const TIERS = ['free', 'quota', 'subscription', 'premium'] as const

export type ProviderKind = (typeof PROVIDER_KINDS)[number]
export type TaskClass = (typeof TASK_CLASSES)[number]
export type Tier = (typeof TIERS)[number]

const taskClassEnum = z.enum(TASK_CLASSES)
const tierEnum = z.enum(TIERS)

export const providerSchema = z.object({
  kind: z.enum(PROVIDER_KINDS),
  baseURL: z.url().optional(),
  apiKeyEnv: z.string().min(1).optional(),
  // Ollama only: cap the KV-cache context; the daemon default (131k) stalls 16GB machines.
  numCtx: z.number().int().min(512).optional(),
})

export const modelSchema = z.object({
  // "provider/model-id" — model-id may itself contain slashes (e.g. hf:Org/Model)
  ref: z.string().regex(/^[a-z0-9_-]+\/.+$/i, 'ref must be "provider/model-id"'),
  classes: z.array(taskClassEnum).min(1),
  tier: tierEnum,
  label: z.string().optional(),
})

export const configSchema = z.object({
  server: z
    .object({
      port: z.number().int().min(1).max(65535).default(4720),
      bind: z.string().default('127.0.0.1'),
      corsOrigins: z.array(z.url()).default([]),
      rateLimitPerMinute: z.number().int().min(1).default(120),
      maxOutputTokens: z.number().int().min(1).default(8192),
    })
    .default({
      port: 4720,
      bind: '127.0.0.1',
      corsOrigins: [],
      rateLimitPerMinute: 120,
      maxOutputTokens: 8192,
    }),
  dataDir: z.string().default('./data'),
  vault: z.object({
    path: z.string().min(1),
    memoryDir: z.string().default('OS/Memory'),
    // Extra vault folders to index read-only (relative to vault path).
    indexDirs: z.array(z.string()).default([]),
  }),
  memory: z
    .object({
      embedModel: z.string().default('nomic-embed-text'),
      injectTopK: z.number().int().min(0).default(6),
      snippetChars: z.number().int().min(100).default(1500),
      personaPath: z.string().optional(),
    })
    .default({ embedModel: 'nomic-embed-text', injectTopK: 6, snippetChars: 1500 }),
  providers: z.record(z.string(), providerSchema),
  models: z.array(modelSchema).min(1),
  routing: z
    .object({
      classOrder: z.partialRecord(taskClassEnum, z.array(tierEnum).min(1)).default({}),
    })
    .default({ classOrder: {} }),
})

export type HaloConfig = z.infer<typeof configSchema>
export type ProviderConfig = z.infer<typeof providerSchema>
export type ModelConfig = z.infer<typeof modelSchema>

// Cheapest-capable-first; premium last so hard classes can override via config.
export const DEFAULT_CLASS_ORDER: Record<TaskClass, readonly Tier[]> = {
  chat: ['quota', 'free', 'subscription', 'premium'],
  summarise: ['free', 'quota', 'subscription', 'premium'],
  code: ['premium', 'subscription', 'quota', 'free'],
  reason: ['premium', 'subscription', 'quota', 'free'],
  vision: ['quota', 'premium', 'subscription', 'free'],
}

export function parseModelRef(ref: string): { provider: string; modelId: string } {
  const slash = ref.indexOf('/')
  if (slash < 1 || slash === ref.length - 1) {
    throw new Error(`Invalid model ref "${ref}" — expected "provider/model-id"`)
  }
  return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) }
}
