import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { WebSocket, RawData } from 'ws'
import { z } from 'zod'
import { originAllowed as sharedOriginAllowed, tokenMatches } from '../auth.js'
import type { AppContext } from '../app.js'

const AUTH_TIMEOUT_MS = 3000

// The WS endpoint lives OUTSIDE /api/ on purpose: browsers cannot set an
// Authorization header on a WebSocket, so the global header gate would break
// the upgrade. Auth happens in-band instead — first frame must carry the
// same bearer token whenever one is configured.
//
// WebSocket is NOT subject to same-origin policy, so a malicious page in the
// user's browser could open ws://127.0.0.1:4720/... even in loopback mode.
// The Origin check below is the only defence in the no-token case and runs
// before anything else. Text-frame length is bounded here and at the
// transport (@fastify/websocket maxPayload) so an unauthenticated peer cannot
// force a giant JSON.parse.
const frameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth'), token: z.string().max(512) }),
  z.object({ type: z.literal('input'), data: z.string().max(1_000_000) }),
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

/** Shared with the other do-something routes — see auth.ts for why. */
function originAllowed(req: FastifyRequest, ctx: AppContext): boolean {
  return sharedOriginAllowed(req.headers, ctx.config.server.corsOrigins)
}

export function registerTerminalRoutes(app: FastifyInstance, ctx: AppContext): void {
  const terminal = ctx.terminal
  if (!terminal) return
  const { manager } = terminal
  const authTimeoutMs = terminal.authTimeoutMs ?? AUTH_TIMEOUT_MS

  // Terminate every PTY when the daemon shuts down, so interactive login
  // shells aren't orphaned across restarts.
  app.addHook('onClose', async () => manager.killAll())

  app.get('/api/terminal/sessions', async () => ({ success: true, data: manager.list() }))

  app.delete('/api/terminal/:name', async (req, reply) => {
    const { name } = req.params as { name: string }
    if (!Object.hasOwn(ctx.config.projects, name)) {
      return reply.code(400).send({ success: false, error: 'unknown project' })
    }
    manager.kill(name)
    return { success: true, data: { killed: name } }
  })

  app.get('/ws/terminal/:name', { websocket: true }, (socket: WebSocket, req) => {
    // A single generic close reason for every pre-attach failure so the
    // socket can't be used to distinguish "unknown project" from "bad token"
    // from "blocked origin".
    const deny = () => socket.close(1008, 'forbidden')
    if (!originAllowed(req, ctx)) return deny()

    const { name } = req.params as { name: string }
    const known = () => Object.hasOwn(ctx.config.projects, name)

    // No token → same-origin (enforced above) loopback UI only; safe to attach.
    if (!ctx.authToken) {
      if (!known()) return deny()
      return attach(socket, name)
    }

    // Token configured → authenticate BEFORE revealing whether the project
    // exists, so an unauthenticated peer learns nothing about the project set.
    const token = ctx.authToken
    const timer = setTimeout(deny, authTimeoutMs)
    socket.once('message', (raw) => {
      clearTimeout(timer)
      const frame = parseFrame(raw)
      const authed = frame?.type === 'auth' && tokenMatches(`Bearer ${frame.token}`, token)
      if (!authed || !known()) return deny()
      attach(socket, name)
    })
    socket.once('close', () => clearTimeout(timer))
  })

  function attach(socket: WebSocket, name: string): void {
    const send = (payload: Record<string, unknown>) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload))
    }

    // The project is already known-registered here, so a throw means a real
    // spawn failure (dir gone, shell missing, EMFILE) — surface it, don't hang.
    let session
    try {
      session = manager.attach(name)
    } catch (err) {
      app.log.error(err, `terminal attach failed: ${name}`)
      send({ type: 'error', message: 'failed to start shell' })
      socket.close(1011, 'attach failed')
      return
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
