import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expandHome, loadConfig } from './config/load.js'
import { makeOllamaEmbedder } from './memory/embed.js'
import { MemoryService } from './memory/service.js'
import { MemoryStore } from './memory/store.js'
import { Meter } from './meter/meter.js'
import { ModelRegistry } from './providers/registry.js'
import { buildApp } from './server/app.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const configPath = process.env['HALO_CONFIG'] ?? resolve(here, '../../halo.config.yaml')

const config = loadConfig(configPath)
const registry = new ModelRegistry(config)
const meter = new Meter(resolve(config.dataDir, 'meter.sqlite'))

const ollamaBase = config.providers['ollama']?.baseURL ?? 'http://127.0.0.1:11434/api'
const memoryStore = new MemoryStore(resolve(config.dataDir, 'memory.sqlite'))
const memory = new MemoryService({
  vaultPath: config.vault.path,
  indexDirs: [config.vault.memoryDir, ...config.vault.indexDirs],
  store: memoryStore,
  embed: makeOllamaEmbedder(ollamaBase, config.memory.embedModel),
  snippetChars: config.memory.snippetChars,
  log: (msg) => console.warn(msg),
})

const personaPath = config.memory.personaPath ? expandHome(config.memory.personaPath) : undefined
const persona =
  personaPath && existsSync(personaPath) ? readFileSync(personaPath, 'utf8') : null

const app = await buildApp({
  config,
  registry,
  meter,
  memory,
  memoryStats: () => memoryStore.count(),
  persona,
  authToken: process.env['HALO_TOKEN'],
  webDist: resolve(here, '../../web/dist'),
})

const scanResult = memory.scan()
app.log.info(
  { ...scanResult, ...memoryStore.count() },
  'memory index ready — embedding missing notes in background',
)
void memory.embedMissing().then((n) => {
  if (n > 0) app.log.info({ embedded: n }, 'memory embeddings updated')
})
memory.startWatching()

const available = registry.list().filter((m) => m.available)
app.log.info(
  { models: available.map((m) => m.ref), total: registry.list().length },
  `HALO online — ${available.length}/${registry.list().length} models available`,
)

await app.listen({ port: config.server.port, host: config.server.bind })
