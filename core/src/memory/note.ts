import matter from 'gray-matter'

export interface MemoryNote {
  /** Path relative to the vault root. */
  path: string
  title: string
  type: string
  description: string
  tags: string[]
  source: string
  content: string
}

const asString = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback

const asTags = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((t) => asString(t)).filter(Boolean) : []

export function parseNote(relPath: string, raw: string): MemoryNote {
  let data: Record<string, unknown>
  let content: string
  try {
    ;({ data, content } = matter(raw))
  } catch {
    // Malformed frontmatter — index the whole file as plain content
    // rather than losing the note.
    data = {}
    content = raw
  }
  const meta = data
  const nested = (meta['metadata'] ?? {}) as Record<string, unknown>
  const fallbackTitle = relPath.split('/').pop()?.replace(/\.md$/, '') ?? relPath
  return {
    path: relPath,
    title: asString(meta['title'] ?? meta['name'], fallbackTitle),
    type: asString(meta['type'] ?? nested['type'], 'fact'),
    description: asString(meta['description']),
    tags: asTags(meta['tags']),
    source: asString(meta['source']),
    content: content.trim(),
  }
}

export function serializeNote(note: Omit<MemoryNote, 'path'>): string {
  const fm: Record<string, unknown> = { title: note.title, type: note.type }
  if (note.description) fm['description'] = note.description
  if (note.tags.length > 0) fm['tags'] = note.tags
  if (note.source) fm['source'] = note.source
  return matter.stringify(`${note.content}\n`, fm)
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'note'
  )
}
