import { z } from 'zod'

export const PROVIDER_KINDS = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ollama',
  'claude-code', // chat bridge to the Claude Max subscription via `claude -p`
] as const
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
  // claude-code only: CLI binary + neutral working dir for unscoped chat.
  command: z.string().optional(),
  timeoutMs: z.number().int().min(1000).optional(),
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
  // Declared monthly token allowances per provider. Absent = unmetered
  // (flat subscription or local). Exhausted providers are skipped by
  // auto-routing; explicit user override still works.
  budgets: z
    .record(z.string(), z.object({ monthlyTokens: z.number().int().min(1) }))
    .default({}),
  models: z.array(modelSchema).min(1),
  routing: z
    .object({
      classOrder: z.partialRecord(taskClassEnum, z.array(tierEnum).min(1)).default({}),
    })
    .default({ classOrder: {} }),
  // Registered project directories — executors are confined to these.
  projects: z.record(z.string(), z.string()).default({}),
  executors: z
    .object({
      default: z.string().default('claude-code'),
      claudeCode: z
        .object({
          command: z.string().default('claude'),
          args: z.array(z.string()).default(['--permission-mode', 'acceptEdits']),
        })
        .prefault({}),
      codex: z
        .object({
          command: z.string().default('codex'),
          args: z.array(z.string()).default([]),
        })
        .prefault({}),
    })
    .prefault({}),
  goals: z
    .object({
      dir: z.string().default('OS/Goals'),
      maxIterations: z.number().int().min(1).max(10).default(3),
      stepTimeoutMinutes: z.number().int().min(1).max(240).default(30),
      // Kill an executor step that goes silent for this long (stall watchdog).
      inactivityTimeoutMinutes: z.number().int().min(1).max(240).default(10),
      // Max goals running at once (each one is a full executor session).
      maxConcurrent: z.number().int().min(1).max(10).default(1),
      // 'panel' = three review lenses must unanimously approve (stricter,
      // ~3× judge cost); 'single' = one reviewer.
      judge: z.enum(['single', 'panel']).default('single'),
      // macOS notification when a goal finishes as done/failed.
      notify: z.boolean().default(true),
    })
    .prefault({}),
  // One-click actions (video-style command center): each is a named prompt
  // dispatched to an executor in a registered project. Optional cron makes
  // it an automation; loop=true injects past run logs (self-improvement).
  actions: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z0-9-]+$/, 'kebab-case name'),
        label: z.string().optional(),
        prompt: z.string().min(1).max(8000),
        project: z.string().min(1),
        executor: z.string().optional(),
        schedule: z.string().optional(), // cron expression
        loop: z.boolean().default(true),
        historyRuns: z.number().int().min(0).max(10).default(3),
        // Two-phase: the prompt only DRAFTS (no side effects); the run then
        // waits for human approval, and applyPrompt executes the approved draft.
        approval: z.boolean().default(false),
        applyPrompt: z
          .string()
          .max(4000)
          .default('Execute the approved draft below exactly as written. Do not redesign it.'),
      }),
    )
    .default([]),
  runsDir: z.string().default('OS/Runs'),
  // Fully local voice stack — £0. STT: whisper.cpp server. TTS: 'local'
  // runs Kokoro ONNX in a HALO-managed worker (spawned on demand, killed
  // after idle so the memory returns); 'http' uses an external Kokoro server.
  voice: z
    .object({
      sttUrl: z.url().default('http://127.0.0.1:2022/v1'),
      engine: z.enum(['local', 'http']).default('local'),
      ttsUrl: z.url().default('http://127.0.0.1:8880/v1'),
      ttsVoice: z.string().default('af_sky'),
      ttsSpeed: z.number().min(0.5).max(2).default(1.1),
      ttsDtype: z.enum(['fp32', 'fp16', 'q8', 'q4', 'q4f16']).default('q8'),
      idleUnloadMinutes: z.number().int().min(1).max(240).default(10),
    })
    .prefault({}),
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
