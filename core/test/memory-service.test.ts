import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EmbedFn } from '../src/memory/embed.js'
import { MemoryService } from '../src/memory/service.js'
import { MemoryStore } from '../src/memory/store.js'

const noEmbed: EmbedFn = async () => null

describe('MemoryService', () => {
  let vault: string
  let store: MemoryStore
  let service: MemoryService

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'halo-vault-'))
    mkdirSync(join(vault, 'OS/Memory/facts'), { recursive: true })
    writeFileSync(
      join(vault, 'OS/Memory/facts/trading-bot.md'),
      `---\ntitle: Trading bot restarts\ntype: project\n---\nThe trading bot runs via launchd, no manual start needed.`,
    )
    writeFileSync(
      join(vault, 'OS/Memory/facts/render-deploy.md'),
      `---\ntitle: Render auto-deploy\ntype: project\n---\nPush to main auto-deploys the backend in about five minutes.`,
    )
    store = new MemoryStore(':memory:')
    service = new MemoryService({
      vaultPath: vault,
      indexDirs: ['OS/Memory'],
      store,
      embed: noEmbed,
      snippetChars: 500,
    })
  })

  afterEach(async () => {
    await service.close()
    store.close()
    rmSync(vault, { recursive: true, force: true })
  })

  it('indexes markdown files and finds them via FTS', async () => {
    const result = service.scan()
    expect(result.indexed).toBe(2)

    const hits = await service.search('trading bot launchd', 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.title).toBe('Trading bot restarts')
  })

  it('is incremental — unchanged files are not reindexed', () => {
    service.scan()
    expect(service.scan().indexed).toBe(0)
  })

  it('removes deleted files from the index', async () => {
    service.scan()
    rmSync(join(vault, 'OS/Memory/facts/render-deploy.md'))
    const result = service.scan()
    expect(result.removed).toBe(1)
    const hits = await service.search('render deploy', 5)
    expect(hits.find((h) => h.title === 'Render auto-deploy')).toBeUndefined()
  })

  it('writeNote persists a searchable markdown file in the canon', async () => {
    service.scan()
    const path = service.writeNote({
      title: 'Ollama context cap',
      type: 'fact',
      description: '',
      tags: ['ollama'],
      source: 'test',
      content: 'Cap num_ctx at 8192 on the 16GB machine or generation stalls.',
    })
    expect(path).toContain('OS/Memory/facts/ollama-context-cap.md')
    const hits = await service.search('num_ctx stall', 3)
    expect(hits[0]?.title).toBe('Ollama context cap')
  })

  it('degrades gracefully without embeddings and blends them in when present', async () => {
    service.scan()
    // FTS-only path already covered above; now verify the hybrid path.
    const fakeEmbed: EmbedFn = async (texts) =>
      texts.map((t) => Float32Array.from([t.includes('trading') ? 1 : 0, 1]))
    const hybrid = new MemoryService({
      vaultPath: vault,
      indexDirs: ['OS/Memory'],
      store,
      embed: fakeEmbed,
      snippetChars: 500,
    })
    await hybrid.embedMissing()
    const hits = await hybrid.search('trading', 2)
    expect(hits[0]?.title).toBe('Trading bot restarts')
    await hybrid.close()
  })

  it('contextFor returns full note bodies truncated to snippetChars', async () => {
    service.scan()
    const hits = await service.search('trading bot', 1)
    const context = service.contextFor(hits)
    expect(context[0]?.content).toContain('launchd')
  })
})
