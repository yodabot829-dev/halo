import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { parseConfig } from '../src/config/load.js'
import { Meter } from '../src/meter/meter.js'
import type { ModelSource } from '../src/providers/registry.js'
import { buildApp } from '../src/server/app.js'

// Voice endpoints pointed at closed ports — tests the failure contract.
const config = parseConfig(`
vault: { path: /v }
providers:
  ollama: { kind: ollama }
models:
  - { ref: ollama/mock, classes: [chat], tier: free }
voice:
  sttUrl: http://127.0.0.1:1/v1
  ttsUrl: http://127.0.0.1:1/v1
`)

const emptySource: ModelSource = { list: () => [], resolve: () => 'none' }

describe('voice routes', () => {
  let app: FastifyInstance | undefined
  let meter: Meter | undefined

  afterEach(async () => {
    await app?.close()
    meter?.close()
  })

  async function makeApp() {
    meter = new Meter(':memory:')
    app = await buildApp({ config, registry: emptySource, meter, logger: false })
    return app
  }

  it('rejects empty audio bodies', async () => {
    const res = await (await makeApp()).inject({
      method: 'POST',
      url: '/api/voice/stt',
      headers: { 'content-type': 'application/octet-stream' },
      payload: '',
    })
    expect(res.statusCode).toBe(400)
  })

  it('rejects invalid tts bodies', async () => {
    const res = await (await makeApp()).inject({
      method: 'POST',
      url: '/api/voice/tts',
      payload: { text: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 503 with a helpful message when tts backend is down', async () => {
    const res = await (await makeApp()).inject({
      method: 'POST',
      url: '/api/voice/tts',
      payload: { text: 'hello' },
    })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toContain('kokoro')
  })
})
