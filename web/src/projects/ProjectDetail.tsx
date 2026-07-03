import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
import type { GoalSummary } from '../goals/useGoals'
import { useMemoryStats } from '../memory/useMemoryStats'
import { ProjectAsk } from './ProjectAsk'
import { Spark } from './Spark'

interface ProjectInfo {
  name: string
  lastCommitAt: string | null
  lastCommitMessage: string | null
  weeklyCommits: number[]
  next: string | null
  graphed: boolean
}

interface NoteRow {
  path: string
  title: string
  type: string
  mtime: number
}

export function ProjectDetail({
  name,
  onBack,
  onChat,
  onTerminal,
}: {
  name: string
  onBack: () => void
  onChat?: (name: string) => void
  onTerminal?: (name: string) => void
}) {
  const { overview } = useMemoryStats()
  const [info, setInfo] = useState<ProjectInfo | null>(null)
  const [goals, setGoals] = useState<GoalSummary[]>([])
  const [notes, setNotes] = useState<NoteRow[]>([])

  useEffect(() => {
    apiFetch('/api/projects')
      .then((r) => r.json())
      .then((b: { data: ProjectInfo[] }) => setInfo(b.data.find((p) => p.name === name) ?? null))
      .catch(console.error)
    apiFetch('/api/goals')
      .then((r) => r.json())
      .then((b: { data: GoalSummary[] }) => setGoals(b.data.filter((g) => g.project === name)))
      .catch(console.error)
    apiFetch(`/api/memory/notes?project=${encodeURIComponent(name)}&limit=8`)
      .then((r) => r.json())
      .then((b: { data: NoteRow[] }) => setNotes(b.data))
      .catch(console.error)
  }, [name])

  const mem = overview?.projects.find((p) => p.project === name)
  const memMonths = overview?.months ?? []
  const memCounts = memMonths.map((m) => mem?.months[m] ?? 0)

  return (
    <div className="detail">
      <div className="detail-topbar">
        <button className="ghost" onClick={onBack}>
          ← Projects
        </button>
        {onChat && (
          <button className="primary" onClick={() => onChat(name)}>
            💬 Chat about this project
          </button>
        )}
        {onTerminal && (
          <button className="primary" onClick={() => onTerminal(name)}>
            🖥 Terminal
          </button>
        )}
      </div>
      <div className="detail-head">
        <h1>{name}</h1>
        {info?.lastCommitAt && (
          <span className="detail-sub">
            last commit {new Date(info.lastCommitAt).toLocaleDateString()} —{' '}
            {info.lastCommitMessage}
          </span>
        )}
      </div>

      <ProjectAsk name={name} graphed={info?.graphed ?? false} />

      <div className="detail-grid">
        {info && (
          <section className="detail-card">
            <h2>Commit activity · 12 weeks</h2>
            <Spark counts={info.weeklyCommits} width={16} />
            {info.next && <div className="project-next">Next: {info.next}</div>}
          </section>
        )}

        <section className="detail-card">
          <h2>Memory · {mem ? mem.total.toLocaleString() : 0} notes</h2>
          {mem ? (
            <>
              <Spark counts={memCounts} width={16} />
              <div className="type-chips">
                {Object.entries(mem.types)
                  .sort((a, b) => b[1] - a[1])
                  .map(([t, n]) => (
                    <span key={t} className="chip">
                      {t} <b>{n}</b>
                    </span>
                  ))}
              </div>
            </>
          ) : (
            <p className="detail-sub">No memory recorded for this project yet.</p>
          )}
        </section>

        <section className="detail-card">
          <h2>Goals · {goals.length}</h2>
          {goals.length === 0 && <p className="detail-sub">None yet.</p>}
          {goals.map((g) => (
            <div key={g.id} className="detail-row">
              <span className={`goal-dot status-${g.status}`} />
              {g.title} <span className="detail-sub">{g.status}</span>
            </div>
          ))}
        </section>

        <section className="detail-card">
          <h2>Recent memory</h2>
          {notes.map((n) => (
            <div key={n.path} className="detail-row">
              <span className="detail-note-title">{n.title}</span>
              <span className="detail-sub">
                {n.type} · {new Date(n.mtime).toLocaleDateString()}
              </span>
            </div>
          ))}
          {notes.length === 0 && <p className="detail-sub">Nothing indexed yet.</p>}
        </section>
      </div>
    </div>
  )
}
