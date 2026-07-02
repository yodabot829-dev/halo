import { spawn } from 'node:child_process'

/** Browser audio (webm/opus) → 16kHz mono WAV for whisper.cpp. */
export function toWav16k(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      'ffmpeg',
      ['-i', 'pipe:0', '-ar', '16000', '-ac', '1', '-f', 'wav', 'pipe:1'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
    const chunks: Buffer[] = []
    let stderr = ''
    ffmpeg.stdout.on('data', (c: Buffer) => chunks.push(c))
    ffmpeg.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    ffmpeg.on('error', reject)
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`))
    })
    ffmpeg.stdin.end(input)
  })
}

export interface VoiceEndpoints {
  sttUrl: string
  ttsUrl: string
  ttsVoice: string
  ttsSpeed: number
}

/** whisper.cpp server, OpenAI-compatible transcription endpoint. */
export async function transcribe(endpoints: VoiceEndpoints, wav: Buffer): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav')
  form.append('model', 'whisper-1')
  const res = await fetch(`${endpoints.sttUrl}/audio/transcriptions`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(`whisper returned ${res.status}`)
  const body = (await res.json()) as { text?: string }
  return (body.text ?? '').trim()
}

/** Kokoro (OpenAI-compatible) speech synthesis → mp3 bytes. */
export async function synthesize(endpoints: VoiceEndpoints, text: string): Promise<Buffer> {
  const res = await fetch(`${endpoints.ttsUrl}/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'kokoro',
      voice: endpoints.ttsVoice,
      speed: endpoints.ttsSpeed,
      input: text,
      response_format: 'mp3',
    }),
  })
  if (!res.ok) throw new Error(`kokoro returned ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}
