import { afterEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { parseConfig } from '../src/config/load.js'
import { Meter } from '../src/meter/meter.js'
import { ModelRegistry } from '../src/providers/registry.js'
import { buildApp } from '../src/server/app.js'

const CONFIG_YAML = (bind: string) => `
server: { port: 4799, bind: "${bind}" }
vault: { path: /v }
providers:
  ollama: { kind: ollama }
models:
  - { ref: ollama/gemma3:12b, classes: [chat], tier: free }
`

async function makeApp(opts: { bind?: string; authToken?: string } = {}) {
  const config = parseConfig(CONFIG_YAML(opts.bind ?? '127.0.0.1'))
  const registry = new ModelRegistry(config, {})
  const meter = new Meter(':memory:')
  const app = await buildApp({ config, registry, meter, authToken: opts.authToken, logger: false })
  return { app, meter }
}

describe('buildApp auth', () => {
  let app: FastifyInstance | undefined
  let meter: Meter | undefined

  afterEach(async () => {
    await app?.close()
    meter?.close()
    app = undefined
    meter = undefined
  })

  it('serves /api/health without auth when no token is set (loopback)', async () => {
    ;({ app, meter } = await makeApp())
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
  })

  it('rejects /api requests without the bearer token when auth is on', async () => {
    ;({ app, meter } = await makeApp({ authToken: 'tok-1' }))
    const res = await app.inject({ method: 'GET', url: '/api/models' })
    expect(res.statusCode).toBe(401)
  })

  it('accepts /api requests with the correct bearer token', async () => {
    ;({ app, meter } = await makeApp({ authToken: 'tok-1' }))
    const res = await app.inject({
      method: 'GET',
      url: '/api/models',
      headers: { authorization: 'Bearer tok-1' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('refuses to build with a non-loopback bind and no auth token', async () => {
    await expect(makeApp({ bind: '100.64.1.2' })).rejects.toThrow(/Refusing to bind/)
  })

  it('allows a non-loopback bind when a token is set', async () => {
    ;({ app, meter } = await makeApp({ bind: '100.64.1.2', authToken: 'tok-1' }))
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { authorization: 'Bearer tok-1' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('rejects oversized chat bodies with a generic error', async () => {
    ;({ app, meter } = await makeApp())
    const res = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { messages: [] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ success: false, error: 'invalid request body' })
  })
})
