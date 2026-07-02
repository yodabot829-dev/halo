import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RunLog } from './actions/run-log.js'
import { ActionRunner } from './actions/runner.js'
import { ActionScheduler } from './actions/scheduler.js'
import { expandHome, loadConfig } from './config/load.js'
import { ClaudeCodeExecutor } from './executor/claude-code.js'
import { CodexExecutor } from './executor/codex.js'
import type { Executor } from './executor/types.js'
import { GoalEngine } from './goals/engine.js'
import { GoalStore } from './goals/goal-file.js'
import { makeLlmJudge } from './goals/judge.js'
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

const executors = new Map<string, Executor>([
  ['claude-code', new ClaudeCodeExecutor(config.executors.claudeCode.command, config.executors.claudeCode.args)],
  ['codex', new CodexExecutor(config.executors.codex.command, config.executors.codex.args)],
])
const goalStore = new GoalStore(resolve(config.vault.path, config.goals.dir))
const goalEngine = new GoalEngine({
  store: goalStore,
  executors,
  projects: config.projects,
  judge: makeLlmJudge(registry, config, meter),
  maxIterations: config.goals.maxIterations,
  stepTimeoutMs: config.goals.stepTimeoutMinutes * 60_000,
})

const runLog = new RunLog(resolve(config.vault.path, config.runsDir))
const actionRunner = new ActionRunner({
  actions: config.actions,
  executors,
  defaultExecutor: config.executors.default,
  projects: config.projects,
  runLog,
  stepTimeoutMs: config.goals.stepTimeoutMinutes * 60_000,
  log: (msg) => console.info(msg),
})
const scheduler = new ActionScheduler(actionRunner, (msg) => console.warn(msg))

const app = await buildApp({
  config,
  registry,
  meter,
  memory,
  memoryStats: () => memoryStore.count(),
  persona,
  goals: { store: goalStore, engine: goalEngine },
  actions: { runner: actionRunner, runLog, scheduler },
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

const cronResult = scheduler.start(
  config.actions.flatMap((a) => (a.schedule ? [{ name: a.name, schedule: a.schedule }] : [])),
)
if (cronResult.scheduled.length > 0) app.log.info({ routines: cronResult.scheduled }, 'routines scheduled')
for (const bad of cronResult.invalid) app.log.warn(`routine skipped: ${bad}`)

const available = registry.list().filter((m) => m.available)
app.log.info(
  { models: available.map((m) => m.ref), total: registry.list().length },
  `HALO online — ${available.length}/${registry.list().length} models available`,
)

await app.listen({ port: config.server.port, host: config.server.bind })
