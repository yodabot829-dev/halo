import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { synthesize, toWav16k, transcribe } from '../../voice/client.js'
import { LocalTts } from '../../voice/kokoro-local.js'
import { sayFallback } from '../../voice/say-fallback.js'
import type { AppContext } from '../app.js'

const ttsSchema = z.object({
  text: z.string().min(1).max(4000),
  // Optional per-call voice (e.g. the terminal's Jarvis voice). Restricted to
  // a safe id charset — never interpolated, but keep the surface tight.
  voice: z
    .string()
    .regex(/^[a-z]{2}_[a-z]+$/)
    .optional(),
})
const MAX_AUDIO_BYTES = 15 * 1024 * 1024

export function registerVoiceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const localTts =
    ctx.config.voice.engine === 'local'
      ? new LocalTts({
          voice: ctx.config.voice.ttsVoice,
          speed: ctx.config.voice.ttsSpeed,
          dtype: ctx.config.voice.ttsDtype,
          idleUnloadMs: ctx.config.voice.idleUnloadMinutes * 60_000,
          log: (msg) => app.log.info(msg),
        })
      : null
  if (localTts) {
    app.addHook('onClose', async () => localTts.kill())
  }
  app.addContentTypeParser(
    ['audio/webm', 'audio/wav', 'audio/mp4', 'application/octet-stream'],
    { parseAs: 'buffer', bodyLimit: MAX_AUDIO_BYTES },
    (_req, body, done) => done(null, body),
  )

  app.post('/api/voice/stt', async (req, reply) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return reply.code(400).send({ success: false, error: 'expected raw audio body' })
    }
    try {
      const wav = await toWav16k(req.body)
      const text = await transcribe(ctx.config.voice, wav)
      return { success: true, data: { text } }
    } catch (err) {
      app.log.error(err, 'stt failed')
      return reply
        .code(503)
        .send({ success: false, error: 'transcription unavailable — is whisper-server running?' })
    }
  })

  app.post('/api/voice/tts', async (req, reply) => {
    const parsed = ttsSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'invalid request body' })
    }
    try {
      if (localTts) {
        const wav = await localTts.synthesize(parsed.data.text, parsed.data.voice)
        return reply.header('content-type', 'audio/wav').send(wav)
      }
      const audio = await synthesize(ctx.config.voice, parsed.data.text, parsed.data.voice)
      return reply.header('content-type', 'audio/mpeg').send(audio)
    } catch (err) {
      app.log.error(err, 'tts failed — trying macOS say fallback')
      try {
        const wav = await sayFallback(parsed.data.text)
        return reply.header('content-type', 'audio/wav').send(wav)
      } catch (fallbackErr) {
        app.log.error(fallbackErr, 'say fallback failed too')
        return reply
          .code(503)
          .send({ success: false, error: 'speech unavailable — see server log' })
      }
    }
  })
}
