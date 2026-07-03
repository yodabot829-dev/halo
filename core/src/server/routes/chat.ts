import { streamText } from 'ai'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { TASK_CLASSES } from '../../config/schema.js'
import { buildSystemPrompt } from '../../memory/context.js'
import { buildProjectContext } from '../../memory/project-context.js'
import { streamClaudeCodeChat } from '../../providers/claude-code-chat.js'
import { providerCallOptions } from '../../providers/options.js'
import { budgetStatus, exhaustedProviders } from '../../router/budget.js'
import { classify, type ChatMessage } from '../../router/classify.js'
import { selectModel } from '../../router/select.js'
import type { AppContext } from '../app.js'

// System prompts are owned by the server (persona + memory injection),
// never accepted from the wire.
const chatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(64_000),
      }),
    )
    .min(1)
    .max(200),
  model: z.string().max(200).optional(),
  taskClass: z.enum(TASK_CLASSES).optional(),
  project: z.string().max(100).optional(),
})

function sse(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

/** Rough ~4 chars/token, used only when a provider returns no usage. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

/** Metering must never break the response stream — log and continue. */
function safeRecord(app: FastifyInstance, ctx: AppContext, rec: Parameters<AppContext['meter']['record']>[0]): void {
  try {
    ctx.meter.record(rec)
  } catch (err) {
    app.log.error(err, 'meter record failed')
  }
}

export function registerChatRoute(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/chat', async (req, reply) => {
    const parsed = chatBodySchema.safeParse(req.body)
    if (!parsed.success) {
      app.log.warn({ issues: parsed.error.issues }, 'invalid chat body')
      return reply.code(400).send({ success: false, error: 'invalid request body' })
    }
    const { messages, model: overrideRef, taskClass: forcedClass, project } = parsed.data

    const taskClass = forcedClass ?? classify(messages as ChatMessage[])
    const exhausted = exhaustedProviders(budgetStatus(ctx.config, ctx.meter, new Date()))
    let selection
    try {
      selection = selectModel(taskClass, ctx.registry.list(), ctx.config, overrideRef, exhausted)
    } catch (err) {
      return reply.code(503).send({ success: false, error: (err as Error).message })
    }

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    // Retrieval before streaming: plain-markdown notes into the system
    // prompt, so any model — including weak local ones — can use memory.
    let memoryNotes: { title: string; content: string }[] = []
    const topK = ctx.config.memory.injectTopK
    if (ctx.memory && topK > 0) {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user')
      if (lastUser) {
        try {
          const results = await ctx.memory.search(lastUser.content.slice(0, 1000), topK)
          memoryNotes = ctx.memory.contextFor(results)
        } catch (err) {
          app.log.error(err, 'memory search failed — continuing without')
        }
      }
    }
    let system = buildSystemPrompt(ctx.persona ?? null, memoryNotes)
    if (project && project in ctx.config.projects) {
      const scoped = buildProjectContext(project, ctx.config.projects[project], ctx.memory)
      if (scoped) system = system ? `${system}\n\n${scoped}` : scoped
    }

    sse(reply, 'meta', {
      model: selection.entry.ref,
      label: selection.entry.label,
      taskClass,
      reason: selection.reason,
      memoryCount: memoryNotes.length,
    })

    const abort = new AbortController()
    // Response 'close' fires on client disconnect; if we already finished
    // writing, writableEnded is true and there is nothing to abort.
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) abort.abort()
    })

    let streamedChars = 0
    const promptChars = () => (system?.length ?? 0) + JSON.stringify(messages).length

    const onDelta = (text: string) => {
      streamedChars += text.length
      sse(reply, 'delta', { text })
    }

    const streamApi = async (entry: typeof selection.entry) => {
      const result = streamText({
        model: ctx.registry.resolve(entry.ref),
        system,
        messages,
        abortSignal: abort.signal,
        providerOptions: providerCallOptions(ctx.config, entry.provider),
        maxOutputTokens: ctx.config.server.maxOutputTokens,
      })
      for await (const text of result.textStream) onDelta(text)
      const usage = await result.usage
      return {
        inputTokens: usage.inputTokens || estimateTokens(promptChars()),
        outputTokens: usage.outputTokens || estimateTokens(streamedChars),
      }
    }

    const streamBridge = async (entry: typeof selection.entry) => {
      const cfg = ctx.config.providers[entry.provider]!
      // Scoped chat runs in that project's repo (Claude Code gets real context);
      // unscoped runs in a neutral tmp dir so it doesn't pick up a random repo.
      const cwd = (project && ctx.config.projects[project]) || tmpdir()
      const usage = await streamClaudeCodeChat(
        { command: cfg.command ?? 'claude', cwd, timeoutMs: cfg.timeoutMs ?? 120_000 },
        messages,
        system,
        abort.signal,
        onDelta,
      )
      return {
        inputTokens: usage.inputTokens || estimateTokens(promptChars()),
        outputTokens: usage.outputTokens || estimateTokens(streamedChars),
      }
    }

    const isBridge = ctx.config.providers[selection.entry.provider]?.kind === 'claude-code'
    const finishOk = (entry: typeof selection.entry, u: { inputTokens: number; outputTokens: number }) => {
      safeRecord(app, ctx, {
        provider: entry.provider,
        model: entry.modelId,
        taskClass,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        ok: true,
      })
      sse(reply, 'done', { usage: u })
    }

    try {
      const usage = isBridge ? await streamBridge(selection.entry) : await streamApi(selection.entry)
      finishOk(selection.entry, usage)
    } catch (err) {
      // Primary was the Max subscription and it failed before streaming a
      // single token (e.g. 5h session limit) → fall back to the secondary
      // (Synthetic), the whole point of "Claude Code primary, Synthetic second".
      if (isBridge && streamedChars === 0) {
        try {
          const claudeCodeProviders = Object.entries(ctx.config.providers)
            .filter(([, p]) => p.kind === 'claude-code')
            .map(([n]) => n)
          const fallback = selectModel(
            taskClass,
            ctx.registry.list(),
            ctx.config,
            undefined,
            new Set([...exhausted, ...claudeCodeProviders]),
          )
          app.log.warn({ err }, 'claude-code chat unavailable — falling back to secondary')
          sse(reply, 'meta', {
            model: fallback.entry.ref,
            label: fallback.entry.label,
            taskClass,
            reason: `claude-code unavailable → ${fallback.reason}`,
            memoryCount: memoryNotes.length,
            fallback: true,
          })
          finishOk(fallback.entry, await streamApi(fallback.entry))
          return
        } catch (fallbackErr) {
          app.log.error(fallbackErr, 'fallback after claude-code also failed')
        }
      }
      const aborted = abort.signal.aborted
      safeRecord(app, ctx, {
        provider: selection.entry.provider,
        model: selection.entry.modelId,
        taskClass,
        inputTokens: aborted ? estimateTokens(JSON.stringify(messages).length) : 0,
        outputTokens: aborted ? estimateTokens(streamedChars) : 0,
        ok: false,
        status: aborted ? 'cancelled' : 'error',
      })
      app.log.error(err, 'chat stream failed')
      sse(reply, 'error', {
        message: aborted ? 'request cancelled' : 'model call failed — see server log',
      })
    } finally {
      reply.raw.end()
    }
  })
}
