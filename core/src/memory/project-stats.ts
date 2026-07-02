export interface ProjectMemoryStats {
  project: string
  total: number
  types: Record<string, number>
  /** 'YYYY-MM' → note count. */
  months: Record<string, number>
}

const ALIASES: Record<string, string> = {
  aiprojects: 'propertyinvestiq',
  'propertyinvestor-ai': 'propertyinvestiq',
  'jfstudiotemplates-etsy-store': 'etsy-store',
}

function normalize(segment: string): string {
  let name = segment
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  // Imported claude-project dirs look like "openclaw-workspace-yodaclaude-aiprojects".
  const marker = name.lastIndexOf('yodaclaude-')
  if (marker !== -1) name = name.slice(marker + 'yodaclaude-'.length)
  return ALIASES[name] ?? name
}

/** Which project a vault note belongs to, derived from its path. */
export function deriveProject(path: string): string {
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/^OS\/Memory\/sessions\/([^/]+)\//, (m) => normalize(m[1]!)],
    [/^OS\/Memory\/facts\/imported\/([^/]+)\//, (m) => normalize(m[1]!)],
    [/^OS\/Memory\//, () => 'halo'],
    [/^Claude Memory\/([^/]+)\//, (m) => normalize(m[1]!)],
    [/^Projects\/([^/]+)\//, (m) => normalize(m[1]!)],
  ]
  for (const [re, pick] of rules) {
    const match = path.match(re)
    if (match) return pick(match)
  }
  return 'other'
}

/** Month a note belongs to: date in the path wins, file mtime is fallback. */
export function monthOf(path: string, mtime: number): string {
  const fromPath = path.match(/\b(20\d{2}-(?:0[1-9]|1[0-2]))\b/)?.[1]
  if (fromPath) return fromPath
  const d = new Date(mtime)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function aggregateProjectStats(
  notes: readonly { path: string; type: string; mtime: number }[],
): ProjectMemoryStats[] {
  const byProject = new Map<string, ProjectMemoryStats>()
  for (const note of notes) {
    const project = deriveProject(note.path)
    const stats =
      byProject.get(project) ?? { project, total: 0, types: {}, months: {} }
    const month = monthOf(note.path, note.mtime)
    byProject.set(project, {
      ...stats,
      total: stats.total + 1,
      types: { ...stats.types, [note.type]: (stats.types[note.type] ?? 0) + 1 },
      months: { ...stats.months, [month]: (stats.months[month] ?? 0) + 1 },
    })
  }
  return [...byProject.values()].sort((a, b) => b.total - a.total)
}
