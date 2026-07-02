import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
import { MemoryViz } from './MemoryViz'

interface SearchResult {
  path: string
  title: string
  snippet: string
}

interface Stats {
  notes: number
  embedded: number
}

export function Memory({ onOpenProject }: { onOpenProject?: (name: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    apiFetch('/api/memory/stats')
      .then((r) => r.json())
      .then((body: { data: Stats | null }) => setStats(body.data))
      .catch(console.error)
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    const timer = setTimeout(() => {
      setSearching(true)
      apiFetch(`/api/memory/search?q=${encodeURIComponent(q)}&k=12`)
        .then((r) => r.json())
        .then((body: { data: SearchResult[] }) => setResults(body.data))
        .catch(console.error)
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  return (
    <div className="memory">
      <h2>
        Memory{stats ? ` · ${stats.notes.toLocaleString()} notes, ${stats.embedded.toLocaleString()} embedded` : ''}
      </h2>
      <MemoryViz onOpenProject={onOpenProject} />
      <input
        className="memory-search"
        placeholder="Search everything you and HALO remember…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      {searching && <div className="empty">Searching…</div>}
      {results.map((r) => (
        <div key={r.path} className="memory-hit">
          <div className="memory-title">{r.title}</div>
          <div className="memory-snippet">{r.snippet}</div>
          <div className="memory-path">{r.path}</div>
        </div>
      ))}
    </div>
  )
}
