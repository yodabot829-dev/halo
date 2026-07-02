import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { MemoryNote } from './note.js'

export interface IndexedNote extends MemoryNote {
  mtime: number
}

export interface FtsHit {
  path: string
  title: string
  snippet: string
  rank: number
}

/** SQLite index over the markdown canon. The vault is the source of truth —
 * this table can be rebuilt from files at any time. */
export class MemoryStore {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        path TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        mtime INTEGER NOT NULL,
        content TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        path UNINDEXED, title, description, tags, content, tokenize='porter'
      );
      CREATE TABLE IF NOT EXISTS embeddings (
        path TEXT PRIMARY KEY,
        dim INTEGER NOT NULL,
        vector BLOB NOT NULL
      );
    `)
  }

  upsert(note: MemoryNote, mtime: number): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM notes WHERE path = ?').run(note.path)
      this.db.prepare('DELETE FROM notes_fts WHERE path = ?').run(note.path)
      this.db
        .prepare(
          `INSERT INTO notes (path, title, type, description, tags, source, mtime, content)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          note.path,
          note.title,
          note.type,
          note.description,
          note.tags.join(','),
          note.source,
          mtime,
          note.content,
        )
      this.db
        .prepare('INSERT INTO notes_fts (path, title, description, tags, content) VALUES (?, ?, ?, ?, ?)')
        .run(note.path, note.title, note.description, note.tags.join(','), note.content)
    })
    tx()
  }

  remove(path: string): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM notes WHERE path = ?').run(path)
      this.db.prepare('DELETE FROM notes_fts WHERE path = ?').run(path)
      this.db.prepare('DELETE FROM embeddings WHERE path = ?').run(path)
    })
    tx()
  }

  get(path: string): IndexedNote | undefined {
    const row = this.db.prepare('SELECT * FROM notes WHERE path = ?').get(path) as
      | Record<string, unknown>
      | undefined
    return row ? rowToNote(row) : undefined
  }

  /** path → mtime for change detection. */
  mtimes(): Map<string, number> {
    const rows = this.db.prepare('SELECT path, mtime FROM notes').all() as {
      path: string
      mtime: number
    }[]
    return new Map(rows.map((r) => [r.path, r.mtime]))
  }

  count(): { notes: number; embedded: number } {
    const notes = (this.db.prepare('SELECT COUNT(*) c FROM notes').get() as { c: number }).c
    const embedded = (this.db.prepare('SELECT COUNT(*) c FROM embeddings').get() as { c: number }).c
    return { notes, embedded }
  }

  ftsSearch(query: string, limit: number): FtsHit[] {
    const terms = query
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 1)
      .map((t) => `"${t}"`)
    if (terms.length === 0) return []
    const match = terms.join(' OR ')
    const rows = this.db
      .prepare(
        `SELECT path, title, snippet(notes_fts, 4, '', '', '…', 24) AS snip
         FROM notes_fts WHERE notes_fts MATCH ? ORDER BY bm25(notes_fts) LIMIT ?`,
      )
      .all(match, limit) as { path: string; title: string; snip: string }[]
    return rows.map((r, i) => ({ path: r.path, title: r.title, snippet: r.snip, rank: i }))
  }

  setEmbedding(path: string, vector: Float32Array): void {
    this.db
      .prepare('INSERT OR REPLACE INTO embeddings (path, dim, vector) VALUES (?, ?, ?)')
      .run(path, vector.length, Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength))
  }

  pathsWithoutEmbedding(limit: number): string[] {
    return (
      this.db
        .prepare(
          `SELECT n.path FROM notes n LEFT JOIN embeddings e ON e.path = n.path
           WHERE e.path IS NULL LIMIT ?`,
        )
        .all(limit) as { path: string }[]
    ).map((r) => r.path)
  }

  allEmbeddings(): { path: string; vector: Float32Array }[] {
    const rows = this.db.prepare('SELECT path, vector FROM embeddings').all() as {
      path: string
      vector: Buffer
    }[]
    return rows.map((r) => ({
      path: r.path,
      vector: new Float32Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength / 4),
    }))
  }

  close(): void {
    this.db.close()
  }
}

function rowToNote(row: Record<string, unknown>): IndexedNote {
  return {
    path: row['path'] as string,
    title: row['title'] as string,
    type: row['type'] as string,
    description: row['description'] as string,
    tags: (row['tags'] as string).split(',').filter(Boolean),
    source: row['source'] as string,
    mtime: row['mtime'] as number,
    content: row['content'] as string,
  }
}
