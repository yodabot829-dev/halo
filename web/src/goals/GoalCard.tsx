import { useState } from 'react'
import { apiFetch } from '../api'
import { useGoalEvents, type GoalSummary } from './useGoals'

const STATUS_COLOURS: Record<string, string> = {
  pending: 'var(--muted)',
  running: 'var(--accent)',
  done: '#2e9e5b',
  failed: '#d43c3c',
  stopped: 'var(--muted)',
}

export function GoalCard({ goal, onChanged }: { goal: GoalSummary; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const lines = useGoalEvents(open ? goal.id : null)

  const act = async (action: 'run' | 'stop') => {
    await apiFetch(`/api/goals/${goal.id}/${action}`, { method: 'POST' })
    onChanged()
  }

  return (
    <div className="goal-card">
      <div className="goal-row" onClick={() => setOpen((o) => !o)}>
        <span className="goal-dot" style={{ background: STATUS_COLOURS[goal.status] }} />
        <span className="goal-title">{goal.title}</span>
        <span className="goal-meta">
          {goal.project} · {goal.executor} · {goal.status}
          {goal.iterations > 0 ? ` · iter ${goal.iterations}` : ''}
        </span>
        {goal.running ? (
          <button
            className="ghost"
            onClick={(e) => {
              e.stopPropagation()
              void act('stop')
            }}
          >
            Stop
          </button>
        ) : (
          <button
            className="ghost"
            onClick={(e) => {
              e.stopPropagation()
              void act('run')
            }}
          >
            Run
          </button>
        )}
      </div>
      {open && (
        <pre className="goal-log">
          {(lines.length > 0 ? lines : goal.log).slice(-100).join('\n') || 'No log yet.'}
        </pre>
      )}
    </div>
  )
}
