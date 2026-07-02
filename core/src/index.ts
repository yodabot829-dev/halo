import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config/load.js'
import { Meter } from './meter/meter.js'
import { ModelRegistry } from './providers/registry.js'
import { buildApp } from './server/app.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const configPath = process.env['HALO_CONFIG'] ?? resolve(here, '../../halo.config.yaml')

const config = loadConfig(configPath)
const registry = new ModelRegistry(config)
const meter = new Meter(resolve(config.dataDir, 'meter.sqlite'))

const app = await buildApp({
  config,
  registry,
  meter,
  authToken: process.env['HALO_TOKEN'],
  webDist: resolve(here, '../../web/dist'),
})

const available = registry.list().filter((m) => m.available)
app.log.info(
  { models: available.map((m) => m.ref), total: registry.list().length },
  `HALO online — ${available.length}/${registry.list().length} models available`,
)

await app.listen({ port: config.server.port, host: config.server.bind })
