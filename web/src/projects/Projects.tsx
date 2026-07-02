import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
import { Spark } from './Spark'

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

export function Projects({ onOpen }: { onOpen?: (name: string) => void }) {
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
          <div
            key={p.name}
            className="project-card clickable"
            onClick={() => onOpen?.(p.name)}
          >
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
