/**
 * TTS worker — runs kokoro-js (Kokoro-82M ONNX) in a separate process so the
 * parent can kill it after idle and the model memory returns to the OS.
 *
 * stdin:  {"id":1,"text":"...","voice":"af_sky","speed":1.1}\n per request
 * stdout: {"ready":true}\n once loaded, then per request
 *         {"id":1,"ok":true,"bytes":N}\n + N bytes of WAV, or
 *         {"id":1,"ok":false,"error":"..."}\n
 */
import { createInterface } from 'node:readline'
import { concatFloat32, encodeWav } from './wav.js'

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const dtype = (process.env['HALO_TTS_DTYPE'] ?? 'q8') as 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16'

const send = (header: Record<string, unknown>, payload?: Buffer): void => {
  process.stdout.write(`${JSON.stringify(header)}\n`)
  if (payload) process.stdout.write(payload)
}

const { KokoroTTS, TextSplitterStream } = await import('kokoro-js')
const tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype, device: 'cpu' })
send({ ready: true, dtype })

interface Request {
  id: number
  text: string
  voice?: string
  speed?: number
}

let chain: Promise<void> = Promise.resolve()

createInterface({ input: process.stdin }).on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  chain = chain.then(async () => {
    let id = -1
    try {
      const req = JSON.parse(trimmed) as Request
      id = req.id
      const chunks: Float32Array[] = []
      let sampleRate = 24_000
      // stream(string) never terminates its generator — push + close an
      // explicit splitter so the for-await completes.
      const splitter = new TextSplitterStream()
      const stream = tts.stream(splitter, {
        voice: (req.voice ?? 'af_sky') as never,
        speed: req.speed ?? 1,
      })
      splitter.push(req.text)
      splitter.close()
      for await (const { audio } of stream) {
        chunks.push(audio.audio as Float32Array)
        sampleRate = audio.sampling_rate
      }
      const wav = encodeWav(concatFloat32(chunks), sampleRate)
      send({ id, ok: true, bytes: wav.length }, wav)
    } catch (err) {
      send({ id, ok: false, error: (err as Error).message })
    }
  })
})

process.stdin.on('end', () => process.exit(0))
