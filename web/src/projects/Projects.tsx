import { useEffect, useState } from 'react'
import { apiFetch } from '../api'

interface ProjectInfo {
  name: string
  exists: boolean
  lastCommitAt: string | null
  lastCommitMessage: string | null
  weeklyCommits: number[]
  next: string | null
}

function ago(iso: string | null): string {
  if (!iso) return 'no commits'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function Spark({ counts }: { counts: number[] }) {
  const max = Math.max(...counts, 1)
  const w = 8
  return (
    <svg width={counts.length * w} height="26" className="spark">
      {counts.map((c, i) => {
        const h = c === 0 ? 2 : Math.max(3, (c / max) * 24)
        return (
          <rect
            key={i}
            x={i * w + 1}
            y={26 - h}
            width={w - 2}
            height={h}
            rx="1.5"
            className={c === 0 ? 'spark-bar empty' : 'spark-bar'}
          />
        )
      })}
    </svg>
  )
}

export function Projects() {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/api/projects')
      .then((r) => r.json())
      .then((body: { data: ProjectInfo[] }) => setProjects(body.data))
      .catch((err: Error) => setError(err.message))
  }, [])

  if (error) return <div className="error">{error}</div>
  if (projects.length === 0) return <div className="empty">Loading projects…</div>

  const active = projects.filter((p) => p.exists)

  return (
    <div className="projects">
      <h2>
        Portfolio · {active.length} projects ·{' '}
        {active.reduce((n, p) => n + p.weeklyCommits.reduce((a, b) => a + b, 0), 0)} commits / 12
        weeks
      </h2>
      <div className="project-grid">
        {active.map((p) => (
          <div key={p.name} className="project-card">
            <div className="project-head">
              <span className="project-name">{p.name}</span>
              <span className="project-when">{ago(p.lastCommitAt)}</span>
            </div>
            <Spark counts={p.weeklyCommits} />
            {p.lastCommitMessage && <div className="project-commit">{p.lastCommitMessage}</div>}
            {p.next && <div className="project-next">Next: {p.next}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
