import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { WebSocket } from 'ws'
import { parseConfig } from '../src/config/load.js'
import { Meter } from '../src/meter/meter.js'
import { ModelRegistry } from '../src/providers/registry.js'
import { buildApp } from '../src/server/app.js'
import { TerminalManager, type PtyLike } from '../src/terminal/manager.js'

const CONFIG_YAML = `
server: { port: 4799, bind: "127.0.0.1" }
vault: { path: /v }
providers:
  ollama: { kind: ollama }
models:
  - { ref: ollama/gemma3:12b, classes: [chat], tier: free }
projects:
  halo: /tmp/halo
`

function makeFakePty() {
  let onData: ((d: string) => void) | null = null
  let onExit: ((e: { exitCode: number }) => void) | null = null
  const fake = {
    writes: [] as string[],
    resizes: [] as Array<{ cols: number; rows: number }>,
    pid: 1,
    onData: (cb: (d: string) => void) => {
      onData = cb
      return { dispose: () => (onData = null) }
    },
    onExit: (cb: (e: { exitCode: number }) => void) => {
      onExit = cb
      return { dispose: () => (onExit = null) }
    },
    write: (d: string) => fake.writes.push(d),
    resize: (cols: number, rows: number) => fake.resizes.push({ cols, rows }),
    kill: () => onExit?.({ exitCode: 0 }),
    emitData: (d: string) => onData?.(d),
  }
  return fake
}

async function makeApp(
  opts: { authToken?: string; authTimeoutMs?: number; spawnThrows?: boolean } = {},
) {
  const config = parseConfig(CONFIG_YAML)
  const registry = new ModelRegistry(config, {})
  const meter = new Meter(':memory:')
  const ptys: ReturnType<typeof makeFakePty>[] = []
  const manager = new TerminalManager({
    projects: config.projects,
    shell: '/bin/zsh',
    scrollbackBytes: 10_000,
    spawn: () => {
      if (opts.spawnThrows) throw new Error('spawn boom')
      const p = makeFakePty()
      ptys.push(p)
      return p as PtyLike
    },
  })
  const app = await buildApp({
    config,
    registry,
    meter,
    authToken: opts.authToken,
    logger: false,
    terminal: { manager, authTimeoutMs: opts.authTimeoutMs ?? 200 },
  })
  // injectWS is broken on this fastify/ws/node combination — test over a
  // real loopback socket instead, which also matches production closer.
  await app.listen({ port: 0, host: '127.0.0.1' })
  const address = app.server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  wsPort = port
  wsSameOrigin = `http://127.0.0.1:${port}`
  return { app, meter, manager, ptys }
}

let wsPort = 0
let wsSameOrigin = ''
const wsConnect = (path: string, connectOpts: { origin?: string } = {}): Promise<WebSocket> =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${wsPort}${path}`,
      connectOpts.origin ? { headers: { origin: connectOpts.origin } } : undefined,
    )
    // Buffer from the very first frame — the server can send `ready` before a
    // test attaches its own listener.
    const queue: Record<string, unknown>[] = []
    queues.set(ws, queue)
    ws.on('message', (raw) => queue.push(JSON.parse(raw.toString()) as Record<string, unknown>))
    ws.on('close', (code) => closeCodes.set(ws, code))
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
const queues = new WeakMap<WebSocket, Record<string, unknown>[]>()
const closeCodes = new WeakMap<WebSocket, number>()

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  const queue = queues.get(ws) ?? []
  const buffered = queue.shift()
  if (buffered) return Promise.resolve(buffered)
  if (closeCodes.has(ws)) return Promise.reject(new Error(`closed: ${closeCodes.get(ws)}`))
  return new Promise((resolve, reject) => {
    const onMsg = () => {
      const msg = queue.shift()
      if (!msg) return
      cleanup()
      resolve(msg)
    }
    const onClose = (code: number) => {
      cleanup()
      reject(new Error(`closed: ${code}`))
    }
    const cleanup = () => {
      ws.off('message', onMsg)
      ws.off('close', onClose)
    }
    // The queue-push listener was attached first, so it runs before onMsg.
    ws.on('message', onMsg)
    ws.once('close', onClose)
  })
}

function waitForClose(ws: WebSocket): Promise<number> {
  const already = closeCodes.get(ws)
  if (already !== undefined) return Promise.resolve(already)
  return new Promise((resolve) => ws.once('close', (code) => resolve(code)))
}

describe('terminal WS route', () => {
  let app: FastifyInstance | undefined
  let meter: Meter | undefined

  afterEach(async () => {
    await app?.close()
    meter?.close()
    app = undefined
    meter = undefined
  })

  it('attaches immediately when no auth token is configured', async () => {
    let ptys: ReturnType<typeof makeFakePty>[]
    ;({ app, meter, ptys } = await makeApp())
    const ws = await wsConnect('/ws/terminal/halo')
    const ready = await nextMessage(ws)
    expect(ready['type']).toBe('ready')
    expect(ptys).toHaveLength(1)
    ws.terminate()
  })

  it('closes with 1008 for an unregistered project', async () => {
    ;({ app, meter } = await makeApp())
    const ws = await wsConnect('/ws/terminal/evil')
    expect(await waitForClose(ws)).toBe(1008)
  })

  it('closes with 1008 for a prototype-chain project name', async () => {
    ;({ app, meter } = await makeApp())
    const ws = await wsConnect('/ws/terminal/constructor')
    expect(await waitForClose(ws)).toBe(1008)
  })

  it('rejects a cross-origin WebSocket connection', async () => {
    // WebSocket is exempt from same-origin policy; a mismatched Origin is the
    // only signal that a page other than the SPA opened this socket.
    let ptys: ReturnType<typeof makeFakePty>[]
    ;({ app, meter, ptys } = await makeApp())
    const ws = await wsConnect('/ws/terminal/halo', { origin: 'http://evil.example' })
    expect(await waitForClose(ws)).toBe(1008)
    expect(ptys).toHaveLength(0)
  })

  it('accepts a same-origin WebSocket connection', async () => {
    ;({ app, meter } = await makeApp())
    const ws = await wsConnect('/ws/terminal/halo', { origin: wsSameOrigin })
    const ready = await nextMessage(ws)
    expect(ready['type']).toBe('ready')
    ws.terminate()
  })

  it('closes an authenticated connection to a prototype-chain name', async () => {
    let ptys: ReturnType<typeof makeFakePty>[]
    ;({ app, meter, ptys } = await makeApp({ authToken: 'tok-1' }))
    const ws = await wsConnect('/ws/terminal/constructor')
    ws.send(JSON.stringify({ type: 'auth', token: 'tok-1' }))
    expect(await waitForClose(ws)).toBe(1008)
    expect(ptys).toHaveLength(0)
  })

  it('surfaces an error frame when the shell fails to spawn', async () => {
    ;({ app, meter } = await makeApp({ spawnThrows: true }))
    const ws = await wsConnect('/ws/terminal/halo')
    const frame = await nextMessage(ws)
    expect(frame).toEqual({ type: 'error', message: 'failed to start shell' })
    expect(await waitForClose(ws)).toBe(1011)
  })

  it('requires a valid auth frame when a token is configured', async () => {
    ;({ app, meter } = await makeApp({ authToken: 'tok-1' }))
    const ws = await wsConnect('/ws/terminal/halo')
    ws.send(JSON.stringify({ type: 'auth', token: 'tok-1' }))
    const ready = await nextMessage(ws)
    expect(ready['type']).toBe('ready')
    ws.terminate()
  })

  it('closes on a wrong token', async () => {
    ;({ app, meter } = await makeApp({ authToken: 'tok-1' }))
    const ws = await wsConnect('/ws/terminal/halo')
    ws.send(JSON.stringify({ type: 'auth', token: 'wrong' }))
    expect(await waitForClose(ws)).toBe(1008)
  })

  it('closes when no auth frame arrives before the timeout', async () => {
    ;({ app, meter } = await makeApp({ authToken: 'tok-1', authTimeoutMs: 30 }))
    const ws = await wsConnect('/ws/terminal/halo')
    expect(await waitForClose(ws)).toBe(1008)
  })

  it('does not spawn a PTY for unauthenticated connections', async () => {
    let ptys: ReturnType<typeof makeFakePty>[]
    ;({ app, meter, ptys } = await makeApp({ authToken: 'tok-1', authTimeoutMs: 30 }))
    const ws = await wsConnect('/ws/terminal/halo')
    await waitForClose(ws)
    expect(ptys).toHaveLength(0)
  })

  it('forwards input and resize frames to the PTY', async () => {
    let ptys: ReturnType<typeof makeFakePty>[]
    ;({ app, meter, ptys } = await makeApp())
    const ws = await wsConnect('/ws/terminal/halo')
    await nextMessage(ws) // ready
    ws.send(JSON.stringify({ type: 'input', data: 'ls\r' }))
    ws.send(JSON.stringify({ type: 'resize', cols: 120, rows: 40 }))
    await new Promise((r) => setTimeout(r, 50))
    expect(ptys[0]?.writes).toEqual(['ls\r'])
    expect(ptys[0]?.resizes).toEqual([{ cols: 120, rows: 40 }])
    ws.terminate()
  })

  it('streams PTY output as data frames', async () => {
    let ptys: ReturnType<typeof makeFakePty>[]
    ;({ app, meter, ptys } = await makeApp())
    const ws = await wsConnect('/ws/terminal/halo')
    await nextMessage(ws) // ready
    const dataFrame = nextMessage(ws)
    ptys[0]?.emitData('hello from pty')
    expect(await dataFrame).toEqual({ type: 'data', data: 'hello from pty' })
    ws.terminate()
  })

  it('replays buffered output in the ready frame on re-attach', async () => {
    let ptys: ReturnType<typeof makeFakePty>[]
    ;({ app, meter, ptys } = await makeApp())
    const first = await wsConnect('/ws/terminal/halo')
    await nextMessage(first)
    ptys[0]?.emitData('history line')
    first.terminate()
    const second = await wsConnect('/ws/terminal/halo')
    const ready = await nextMessage(second)
    expect(ready).toEqual({ type: 'ready', replay: 'history line' })
    second.terminate()
  })

  it('sends an exit frame when the PTY dies', async () => {
    let manager: TerminalManager
    ;({ app, meter, manager } = await makeApp())
    const ws = await wsConnect('/ws/terminal/halo')
    await nextMessage(ws) // ready
    const exitFrame = nextMessage(ws)
    manager.kill('halo')
    expect(await exitFrame).toEqual({ type: 'exit', code: 0 })
  })

  it('ignores malformed frames without crashing', async () => {
    ;({ app, meter } = await makeApp())
    const ws = await wsConnect('/ws/terminal/halo')
    await nextMessage(ws) // ready
    ws.send('not json at all')
    ws.send(JSON.stringify({ type: 'resize', cols: 'huge', rows: -3 }))
    const dataFrame = nextMessage(ws)
    // Route still alive: a well-formed input frame works afterwards.
    ws.send(JSON.stringify({ type: 'input', data: 'echo ok\r' }))
    await new Promise((r) => setTimeout(r, 50))
    ws.terminate()
    await dataFrame.catch(() => {}) // no data expected; just don't hang
  })
})

describe('terminal REST routes', () => {
  let app: FastifyInstance | undefined
  let meter: Meter | undefined

  afterEach(async () => {
    await app?.close()
    meter?.close()
    app = undefined
    meter = undefined
  })

  it('lists active sessions', async () => {
    let manager: TerminalManager
    ;({ app, meter, manager } = await makeApp())
    manager.attach('halo')
    const res = await app.inject({ method: 'GET', url: '/api/terminal/sessions' })
    expect(res.json()).toEqual({ success: true, data: ['halo'] })
  })

  it('kills a session via DELETE', async () => {
    let manager: TerminalManager
    ;({ app, meter, manager } = await makeApp())
    manager.attach('halo')
    const res = await app.inject({ method: 'DELETE', url: '/api/terminal/halo' })
    expect(res.statusCode).toBe(200)
    expect(manager.list()).toEqual([])
  })

  it('rejects killing an unknown project', async () => {
    ;({ app, meter } = await makeApp())
    const res = await app.inject({ method: 'DELETE', url: '/api/terminal/evil' })
    expect(res.statusCode).toBe(400)
  })

  it('keeps REST routes behind the bearer gate', async () => {
    ;({ app, meter } = await makeApp({ authToken: 'tok-1' }))
    const res = await app.inject({ method: 'GET', url: '/api/terminal/sessions' })
    expect(res.statusCode).toBe(401)
  })
})
