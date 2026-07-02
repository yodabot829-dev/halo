import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { synthesize, toWav16k, transcribe } from '../../voice/client.js'
import type { AppContext } from '../app.js'

const ttsSchema = z.object({ text: z.string().min(1).max(4000) })
const MAX_AUDIO_BYTES = 15 * 1024 * 1024

export function registerVoiceRoutes(app: FastifyInstance, ctx: AppContext): void {
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
      const audio = await synthesize(ctx.config.voice, parsed.data.text)
      return reply.header('content-type', 'audio/mpeg').send(audio)
    } catch (err) {
      app.log.error(err, 'tts failed')
      return reply
        .code(503)
        .send({ success: false, error: 'speech unavailable — is kokoro running?' })
    }
  })
}
