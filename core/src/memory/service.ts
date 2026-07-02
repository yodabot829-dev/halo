import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  watch,
  writeFileSync,
  mkdirSync,
  type FSWatcher,
} from 'node:fs'
import { join, relative } from 'node:path'
import { cosine, type EmbedFn } from './embed.js'
import { parseNote, serializeNote, slugify, type MemoryNote } from './note.js'
import type { MemoryStore } from './store.js'

export interface SearchResult {
  path: string
  title: string
  snippet: string
  score: number
}

export interface MemoryServiceDeps {
  /** Vault root (absolute). */
  vaultPath: string
  /** Dirs to index, relative to vault root; first one is the write target. */
  indexDirs: string[]
  store: MemoryStore
  embed: EmbedFn
  /** Truncation for embedding input and injected snippets. */
  snippetChars: number
  log?: (msg: string) => void
}

const EMBED_BATCH = 16
const RRF_K = 60

/** Vault-first memory: markdown files are canon, SQLite is a rebuildable
 * index, retrieval returns plain text any model can consume. */
export class MemoryService {
  private readonly deps: MemoryServiceDeps
  private watchers: FSWatcher[] = []
  private scanTimer: NodeJS.Timeout | undefined

  constructor(deps: MemoryServiceDeps) {
    this.deps = deps
  }

  private absDirs(): string[] {
    return this.deps.indexDirs.map((d) => join(this.deps.vaultPath, d))
  }

  /** Incremental scan: parse new/changed files, drop deleted ones. */
  scan(): { indexed: number; removed: number } {
    const { store, vaultPath } = this.deps
    const known = store.mtimes()
    const seen = new Set<string>()
    let indexed = 0

    for (const dir of this.absDirs()) {
      if (!existsSync(dir)) continue
      for (const abs of walkMarkdown(dir)) {
        const rel = relative(vaultPath, abs)
        seen.add(rel)
        const mtime = statSync(abs).mtimeMs
        if (known.get(rel) === mtime) continue
        try {
          store.upsert(parseNote(rel, readFileSync(abs, 'utf8')), mtime)
          indexed++
        } catch (err) {
          this.deps.log?.(`memory: failed to index ${rel}: ${(err as Error).message}`)
        }
      }
    }

    let removed = 0
    for (const path of known.keys()) {
      if (!seen.has(path)) {
        store.remove(path)
        removed++
      }
    }
    return { indexed, removed }
  }

  /** Embed notes that don't have vectors yet. Batched; stops on failure. */
  async embedMissing(): Promise<number> {
    const { store, embed, snippetChars } = this.deps
    let total = 0
    for (;;) {
      const paths = store.pathsWithoutEmbedding(EMBED_BATCH)
      if (paths.length === 0) return total
      const notes = paths.map((p) => store.get(p)).filter((n) => n !== undefined)
      const texts = notes.map((n) => `${n.title}\n${n.description}\n${n.content}`.slice(0, snippetChars * 2))
      const vectors = await embed(texts)
      if (!vectors) return total // Ollama down or model missing — FTS still works
      notes.forEach((n, i) => {
        const v = vectors[i]
        if (v) store.setEmbedding(n.path, v)
      })
      total += notes.length
    }
  }

  /** Hybrid retrieval: FTS5 + embedding cosine, fused with reciprocal rank. */
  async search(query: string, k: number): Promise<SearchResult[]> {
    const { store, embed } = this.deps
    const scores = new Map<string, number>()

    const ftsHits = store.ftsSearch(query, k * 3)
    for (const hit of ftsHits) {
      scores.set(hit.path, (scores.get(hit.path) ?? 0) + 1 / (RRF_K + hit.rank))
    }

    const queryVec = (await embed([query]))?.[0]
    if (queryVec) {
      const ranked = store
        .allEmbeddings()
        .map((e) => ({ path: e.path, sim: cosine(queryVec, e.vector) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, k * 3)
      ranked.forEach((r, rank) => {
        scores.set(r.path, (scores.get(r.path) ?? 0) + 1 / (RRF_K + rank))
      })
    }

    const snippets = new Map(ftsHits.map((h) => [h.path, h.snippet]))
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .map(([path, score]) => {
        const note = store.get(path)
        return {
          path,
          title: note?.title ?? path,
          snippet: snippets.get(path) ?? note?.content.slice(0, 200) ?? '',
          score,
        }
      })
  }

  /** Full note bodies for context injection, truncated per note. */
  contextFor(results: SearchResult[]): { title: string; content: string }[] {
    return results.flatMap((r) => {
      const note = this.deps.store.get(r.path)
      if (!note) return []
      return [{ title: note.title, content: note.content.slice(0, this.deps.snippetChars) }]
    })
  }

  /** Write a new note into the canon (first index dir) and index it. */
  writeNote(input: Omit<MemoryNote, 'path'>): string {
    const writeRoot = this.deps.indexDirs[0]
    if (!writeRoot) throw new Error('memory: no index dirs configured')
    const dir = join(this.deps.vaultPath, writeRoot, 'facts')
    mkdirSync(dir, { recursive: true })
    let name = slugify(input.title)
    let abs = join(dir, `${name}.md`)
    for (let i = 2; existsSync(abs); i++) {
      name = `${slugify(input.title)}-${i}`
      abs = join(dir, `${name}.md`)
    }
    writeFileSync(abs, serializeNote(input), 'utf8')
    const rel = relative(this.deps.vaultPath, abs)
    this.deps.store.upsert(parseNote(rel, readFileSync(abs, 'utf8')), statSync(abs).mtimeMs)
    return rel
  }

  /** Watch index dirs (native recursive FSEvents — one fd per root, not
   * one per file); debounce rescans + re-embeds. */
  startWatching(onRescan?: () => void): void {
    const trigger = () => {
      clearTimeout(this.scanTimer)
      this.scanTimer = setTimeout(() => {
        this.scan()
        void this.embedMissing().then(() => onRescan?.())
      }, 1500)
    }
    for (const dir of this.absDirs().filter((d) => existsSync(d))) {
      const watcher = watch(dir, { recursive: true }, trigger)
      watcher.on('error', (err) => this.deps.log?.(`memory watcher error: ${err.message}`))
      this.watchers.push(watcher)
    }
  }

  async close(): Promise<void> {
    clearTimeout(this.scanTimer)
    for (const watcher of this.watchers) watcher.close()
    this.watchers = []
  }
}

function* walkMarkdown(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) yield* walkMarkdown(abs)
    else if (entry.isFile() && entry.name.endsWith('.md')) yield abs
  }
}
