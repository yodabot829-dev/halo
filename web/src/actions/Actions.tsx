import { useState } from 'react'
import { useActions, type RunSummary } from './useActions'

function ago(iso?: string): string {
  if (!iso) return ''
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return `${Math.floor(mins / 1440)}d ago`
}

function RunCard({ run }: { run: RunSummary }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="run-card" onClick={() => setOpen((o) => !o)}>
      <div className="run-head">
        <span className={`goal-dot status-${run.status === 'done' ? 'done' : run.status === 'running' ? 'running' : 'failed'}`} />
        <span className="run-name">{run.action}</span>
        <span className="detail-sub">
          {run.status} · {ago(run.finishedAt ?? run.startedAt)}
        </span>
      </div>
      <div className={`run-output${open ? ' open' : ''}`}>{run.output}</div>
    </div>
  )
}

export function Actions() {
  const { actions, runs, error, run } = useActions()

  return (
    <div className="actions">
      <h2>Actions</h2>
      <div className="action-grid">
        {actions.map((a) => (
          <button
            key={a.name}
            className={`action-btn${a.running ? ' running' : ''}`}
            disabled={a.running}
            onClick={() => void run(a.name)}
          >
            <span className="action-label">{a.label}</span>
            <span className="action-meta">
              {a.running
                ? 'running…'
                : a.lastRun
                  ? `${a.lastRun.status} · ${ago(a.lastRun.finishedAt)}`
                  : 'never run'}
              {a.schedule ? ` · ⏱ ${a.schedule}` : ''}
            </span>
          </button>
        ))}
        {actions.length === 0 && (
          <p className="detail-sub">No actions configured — add them under `actions:` in halo.config.yaml.</p>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      <h2>Recent runs</h2>
      <div className="runs-feed">
        {runs.map((r) => (
          <RunCard key={r.id} run={r} />
        ))}
        {runs.length === 0 && <p className="detail-sub">Nothing yet — press a button.</p>}
      </div>
    </div>
  )
}
