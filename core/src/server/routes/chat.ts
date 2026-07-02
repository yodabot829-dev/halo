import { streamText } from 'ai'
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { TASK_CLASSES } from '../../config/schema.js'
import { buildSystemPrompt } from '../../memory/context.js'
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
})

function sse(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
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
    const { messages, model: overrideRef, taskClass: forcedClass } = parsed.data

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
    const system = buildSystemPrompt(ctx.persona ?? null, memoryNotes)

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

    const providerCfg = ctx.config.providers[selection.entry.provider]
    const providerOptions =
      providerCfg?.kind === 'ollama' && providerCfg.numCtx
        ? { ollama: { options: { num_ctx: providerCfg.numCtx } } }
        : undefined

    try {
      const result = streamText({
        model: ctx.registry.resolve(selection.entry.ref),
        system,
        messages,
        abortSignal: abort.signal,
        providerOptions,
        maxOutputTokens: ctx.config.server.maxOutputTokens,
      })
      for await (const text of result.textStream) {
        sse(reply, 'delta', { text })
      }
      const usage = await result.usage
      safeRecord(app, ctx, {
        provider: selection.entry.provider,
        model: selection.entry.modelId,
        taskClass,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        ok: true,
      })
      sse(reply, 'done', {
        usage: { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 },
      })
    } catch (err) {
      safeRecord(app, ctx, {
        provider: selection.entry.provider,
        model: selection.entry.modelId,
        taskClass,
        inputTokens: 0,
        outputTokens: 0,
        ok: false,
        status: abort.signal.aborted ? 'cancelled' : 'error',
      })
      app.log.error(err, 'chat stream failed')
      const aborted = abort.signal.aborted
      sse(reply, 'error', {
        message: aborted ? 'request cancelled' : 'model call failed — see server log',
      })
    } finally {
      reply.raw.end()
    }
  })
}
