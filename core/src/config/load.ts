import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import { configSchema, parseModelRef, type HaloConfig } from './schema.js'

export function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2))
  return p
}

export function parseConfig(yamlText: string): HaloConfig {
  const raw: unknown = parse(yamlText)
  const config = configSchema.parse(raw)

  for (const model of config.models) {
    const { provider } = parseModelRef(model.ref)
    if (!(provider in config.providers)) {
      throw new Error(`Model "${model.ref}" references unknown provider "${provider}"`)
    }
  }

  return {
    ...config,
    dataDir: expandHome(config.dataDir),
    vault: { ...config.vault, path: expandHome(config.vault.path) },
    projects: Object.fromEntries(
      Object.entries(config.projects).map(([name, p]) => [name, expandHome(p)]),
    ),
  }
}

export function loadConfig(path: string): HaloConfig {
  return parseConfig(readFileSync(expandHome(path), 'utf8'))
}
