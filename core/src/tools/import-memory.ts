/**
 * One-off importer: unify legacy memory sources into the vault canon.
 *
 *   1. File-based Claude memories  ~/.claude/projects/<proj>/memory/*.md
 *        → <vault>/OS/Memory/facts/imported/<proj>/
 *   2. claude-mem session summaries (~/.claude-mem/claude-mem.db, READ-ONLY)
 *        → <vault>/OS/Memory/sessions/<project>/
 *
 * Idempotent: existing target files are skipped. Sources are never modified.
 *
 * Usage: tsx core/src/tools/import-memory.ts [--dry-run]
 */
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expandHome, loadConfig } from '../config/load.js'
import { serializeNote, slugify } from '../memory/note.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const config = loadConfig(process.env['HALO_CONFIG'] ?? resolve(here, '../../../halo.config.yaml'))
const dryRun = process.argv.includes('--dry-run')
const memoryRoot = join(config.vault.path, config.vault.memoryDir)

let written = 0
let skipped = 0

function writeTarget(dir: string, name: string, body: string): void {
  const abs = join(dir, `${name}.md`)
  if (existsSync(abs)) {
    skipped++
    return
  }
  if (!dryRun) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(abs, body, 'utf8')
  }
  written++
}

// --- 1. file-based Claude memories ---------------------------------------
const projectsDir = expandHome('~/.claude/projects')
if (existsSync(projectsDir)) {
  for (const proj of readdirSync(projectsDir)) {
    const memDir = join(projectsDir, proj, 'memory')
    if (!existsSync(memDir)) continue
    const projSlug = slugify(proj.replace(/^-Users-[a-z]+-?/i, '') || 'root')
    for (const file of readdirSync(memDir)) {
      if (!file.endsWith('.md') || file === 'MEMORY.md') continue
      const raw = readFileSync(join(memDir, file), 'utf8')
      // Already frontmattered — keep verbatim, note provenance in the name.
      writeTarget(join(memoryRoot, 'facts', 'imported', projSlug), file.replace(/\.md$/, ''), raw)
    }
  }
}
console.log(`file memories: ${written} written, ${skipped} skipped`)

// --- 2. claude-mem session summaries --------------------------------------
const dbPath = join(homedir(), '.claude-mem', 'claude-mem.db')
const before = written
if (existsSync(dbPath)) {
  const db = new Database(dbPath, { readonly: true })
  interface SummaryRow {
    id: number
    project: string
    request: string | null
    investigated: string | null
    learned: string | null
    completed: string | null
    next_steps: string | null
    notes: string | null
    created_at: string
  }
  const rows = db
    .prepare(
      `SELECT id, project, request, investigated, learned, completed, next_steps, notes, created_at
       FROM session_summaries ORDER BY id`,
    )
    .all() as SummaryRow[]
  db.close()

  for (const row of rows) {
    const date = row.created_at.slice(0, 10)
    const title = (row.request ?? 'Session').slice(0, 120)
    const sections: string[] = []
    const add = (heading: string, value: string | null) => {
      if (value?.trim()) sections.push(`## ${heading}\n${value.trim()}`)
    }
    add('Request', row.request)
    add('Investigated', row.investigated)
    add('Learned', row.learned)
    add('Completed', row.completed)
    add('Next steps', row.next_steps)
    add('Notes', row.notes)
    if (sections.length === 0) {
      skipped++
      continue
    }
    const body = serializeNote({
      title,
      type: 'session',
      description: `claude-mem session summary (${row.project}, ${date})`,
      tags: [row.project],
      source: `claude-mem#${row.id}`,
      content: sections.join('\n\n'),
    })
    writeTarget(
      join(memoryRoot, 'sessions', slugify(row.project)),
      `${date}-s${row.id}-${slugify(title).slice(0, 40)}`,
      body,
    )
  }
}
console.log(`claude-mem sessions: ${written - before} written (total skipped ${skipped})`)
console.log(dryRun ? 'DRY RUN — nothing written' : `done → ${memoryRoot}`)
