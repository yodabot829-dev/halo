import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { FrameReader } from './protocol.js'

interface PendingRequest {
  resolve: (wav: Buffer) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

export interface LocalTtsOptions {
  voice: string
  speed: number
  dtype: string
  idleUnloadMs: number
  log?: (msg: string) => void
}

const READY_TIMEOUT_MS = 300_000 // first run downloads the ~92MB model
const REQUEST_TIMEOUT_MS = 120_000

/** In-process-managed Kokoro: worker child spawns on first request and is
 * killed after idle, so TTS costs zero memory while unused. */
export class LocalTts {
  private readonly opts: LocalTtsOptions
  private child: ChildProcess | null = null
  private ready: Promise<void> | null = null
  private readonly pending = new Map<number, PendingRequest>()
  private nextId = 1
  private idleTimer: NodeJS.Timeout | undefined

  constructor(opts: LocalTtsOptions) {
    this.opts = opts
  }

  isRunning(): boolean {
    return this.child !== null
  }

  private workerSpec(): { command: string; args: string[] } {
    const here = fileURLToPath(import.meta.url)
    const isTs = here.endsWith('.ts')
    const worker = resolve(here, `../kokoro-worker.${isTs ? 'ts' : 'js'}`)
    if (isTs) {
      const tsx = resolve(here, '../../../../node_modules/.bin/tsx')
      if (existsSync(tsx)) return { command: tsx, args: [worker] }
    }
    return { command: process.execPath, args: [worker] }
  }

  private ensureWorker(): Promise<void> {
    if (this.child && this.ready) return this.ready
    const { command, args } = this.workerSpec()
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HALO_TTS_DTYPE: this.opts.dtype },
    })
    this.child = child
    this.opts.log?.('tts worker starting')

    const reader = new FrameReader()
    this.ready = new Promise<void>((resolveReady, rejectReady) => {
      const readyTimer = setTimeout(() => {
        rejectReady(new Error('tts worker did not become ready'))
        this.kill()
      }, READY_TIMEOUT_MS)

      child.stdout!.on('data', (chunk: Buffer) => {
        for (const frame of reader.feed(chunk)) {
          if (frame.header['ready']) {
            clearTimeout(readyTimer)
            this.opts.log?.(`tts worker ready (dtype=${String(frame.header['dtype'])})`)
            resolveReady()
            continue
          }
          const id = frame.header['id'] as number
          const req = this.pending.get(id)
          if (!req) continue
          this.pending.delete(id)
          clearTimeout(req.timer)
          if (frame.header['ok']) req.resolve(frame.payload)
          else req.reject(new Error(String(frame.header['error'] ?? 'tts failed')))
        }
      })
      child.stderr!.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim()
        if (text && !text.includes('%')) this.opts.log?.(`tts worker: ${text.slice(0, 300)}`)
      })
      child.on('error', (err) => {
        clearTimeout(readyTimer)
        rejectReady(err)
        this.failAll(err)
      })
      child.on('close', (code) => {
        clearTimeout(readyTimer)
        this.child = null
        this.ready = null
        this.failAll(new Error(`tts worker exited (${code})`))
        this.opts.log?.('tts worker stopped')
      })
    })
    return this.ready
  }

  private failAll(err: Error): void {
    for (const [id, req] of this.pending) {
      this.pending.delete(id)
      clearTimeout(req.timer)
      req.reject(err)
    }
  }

  private touchIdle(): void {
    clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      this.opts.log?.('tts worker idle — unloading to free memory')
      this.kill()
    }, this.opts.idleUnloadMs)
  }

  async synthesize(text: string, voice?: string): Promise<Buffer> {
    await this.ensureWorker()
    const id = this.nextId++
    const wav = await new Promise<Buffer>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        rejectPromise(new Error('tts request timed out'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer })
      this.child!.stdin!.write(
        `${JSON.stringify({ id, text, voice: voice ?? this.opts.voice, speed: this.opts.speed })}\n`,
      )
    })
    this.touchIdle()
    return wav
  }

  kill(): void {
    clearTimeout(this.idleTimer)
    this.child?.kill('SIGTERM')
    this.child = null
    this.ready = null
  }
}
