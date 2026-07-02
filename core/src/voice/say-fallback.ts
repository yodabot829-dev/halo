import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Last-resort TTS: macOS built-in `say`. Zero extra memory, always
 * available — quality is basic but the OS never kills it. */
export async function sayFallback(text: string): Promise<Buffer> {
  const base = join(tmpdir(), `halo-say-${process.pid}-${Date.now()}`)
  const aiff = `${base}.aiff`
  const wav = `${base}.wav`
  try {
    await run('say', ['-o', aiff, text])
    await run('ffmpeg', ['-y', '-i', aiff, '-ar', '24000', '-ac', '1', wav], {
      timeout: 30_000,
    })
    return await readFile(wav)
  } finally {
    await rm(aiff, { force: true })
    await rm(wav, { force: true })
  }
}
