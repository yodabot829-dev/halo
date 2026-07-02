import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
import type { RunSummary } from '../actions/useActions'

const PRESETS = [
  'What does this project do?',
  'Summarise the architecture and key modules.',
  'What is the blast radius of the most recently changed files?',
]

/** Graphify-powered project Q&A: graph button, preset questions, answers feed. */
export function ProjectAsk({ name, graphed }: { name: string; graphed: boolean }) {
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await apiFetch('/api/runs?limit=30')
        const body = (await res.json()) as { data: RunSummary[] }
        const mine = body.data.filter(
          (r) => r.action === `ask-${name}` || r.action === `graphify-${name}`,
        )
        setRuns(mine.slice(0, 5))
        if (busy && mine.some((r) => r.id.endsWith(busy) === false)) {
          // clear busy once no matching action is running
        }
        if (!mine.some((r) => r.status === 'running')) setBusy(null)
      } catch {
        // transient poll failures are fine
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 5000)
    return () => clearInterval(timer)
  }, [name, busy])

  const fire = async (path: string, body?: unknown) => {
    setError(null)
    const res = await apiFetch(path, {
      method: 'POST',
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })
    if (!res.ok) {
      const parsed = (await res.json().catch(() => null)) as { error?: string } | null
      setError(parsed?.error ?? `request failed: ${res.status}`)
      return false
    }
    return true
  }

  const ask = async (q: string) => {
    if (await fire(`/api/projects/${name}/ask`, { question: q })) {
      setBusy('ask')
      setQuestion('')
    }
  }

  return (
    <section className="detail-card">
      <h2>Ask this project {graphed ? '· graphed ✓' : ''}</h2>
      <div className="ask-buttons">
        <button
          className="ghost"
          onClick={() => void fire(`/api/projects/${name}/graph`).then((ok) => ok && setBusy('graph'))}
        >
          {graphed ? 'Update graph' : 'Build knowledge graph'}
        </button>
        {PRESETS.map((p) => (
          <button key={p} className="ghost" onClick={() => void ask(p)}>
            {p}
          </button>
        ))}
      </div>
      <div className="ask-free">
        <input
          placeholder="Ask anything about this codebase…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && question.trim().length > 2) void ask(question.trim())
          }}
        />
      </div>
      {busy && <div className="detail-sub">⏳ {busy === 'graph' ? 'graphing…' : 'thinking…'}</div>}
      {error && <div className="error">{error}</div>}
      {runs.map((r) => (
        <div key={r.id} className="ask-answer">
          <div className="detail-sub">
            {r.action.startsWith('graphify') ? 'graph build' : 'answer'} · {r.status}
          </div>
          <div className="ask-answer-text">{r.output.slice(0, 2000)}</div>
        </div>
      ))}
    </section>
  )
}
