import type { FastifyInstance } from 'fastify'
import type { WebSocket, RawData } from 'ws'
import { z } from 'zod'
import { tokenMatches } from '../auth.js'
import type { AppContext } from '../app.js'

const AUTH_TIMEOUT_MS = 3000

// The WS endpoint lives OUTSIDE /api/ on purpose: browsers cannot set an
// Authorization header on a WebSocket, so the global header gate would break
// the upgrade. Auth happens in-band instead — first frame must carry the
// same bearer token whenever one is configured. With no token configured,
// buildApp has already guaranteed a loopback-only bind.
const frameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string() }),
  z.object({ type: z.literal('input'), data: z.string() }),
  z.object({
    type: z.literal('resize'),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
  }),
])
type Frame = z.infer<typeof frameSchema>

function parseFrame(raw: RawData): Frame | null {
  try {
    const parsed = frameSchema.safeParse(JSON.parse(raw.toString()))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function registerTerminalRoutes(app: FastifyInstance, ctx: AppContext): void {
  const terminal = ctx.terminal
  if (!terminal) return
  const { manager } = terminal
  const authTimeoutMs = terminal.authTimeoutMs ?? AUTH_TIMEOUT_MS

  app.get('/api/terminal/sessions', async () => ({ success: true, data: manager.list() }))

  app.delete('/api/terminal/:name', async (req, reply) => {
    const { name } = req.params as { name: string }
    if (!(name in ctx.config.projects)) {
      return reply.code(400).send({ success: false, error: 'unknown project' })
    }
    manager.kill(name)
    return { success: true, data: { killed: name } }
  })

  app.get('/ws/terminal/:name', { websocket: true }, (socket: WebSocket, req) => {
    const { name } = req.params as { name: string }
    if (!(name in ctx.config.projects)) {
      socket.close(1008, 'unknown project')
      return
    }

    if (!ctx.authToken) {
      attach(socket, name)
      return
    }
    const token = ctx.authToken
    const timer = setTimeout(() => socket.close(1008, 'auth timeout'), authTimeoutMs)
    socket.once('message', (raw) => {
      clearTimeout(timer)
      const frame = parseFrame(raw)
      if (frame?.type === 'auth' && tokenMatches(`Bearer ${frame.token}`, token)) {
        attach(socket, name)
      } else {
        socket.close(1008, 'unauthorized')
      }
    })
    socket.once('close', () => clearTimeout(timer))
  })

  function attach(socket: WebSocket, name: string): void {
    const session = manager.attach(name)
    const send = (payload: Record<string, unknown>) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload))
    }

    send({ type: 'ready', replay: session.replay })
    const unsubscribe = session.subscribe((data) => send({ type: 'data', data }))
    const offExit = session.onExit((code) => {
      send({ type: 'exit', code })
      socket.close(1000, 'shell exited')
    })

    socket.on('message', (raw) => {
      const frame = parseFrame(raw)
      if (frame?.type === 'input') manager.write(name, frame.data)
      else if (frame?.type === 'resize') manager.resize(name, frame.cols, frame.rows)
      // Malformed frames are dropped; the shell itself is the error surface.
    })
    socket.on('close', () => {
      // Detach only — the PTY keeps running for the next attach.
      unsubscribe()
      offExit()
    })
  }
}
