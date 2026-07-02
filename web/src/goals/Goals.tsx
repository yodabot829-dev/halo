import { useState } from 'react'
import { apiFetch } from '../api'
import { GoalCard } from './GoalCard'
import { useGoals } from './useGoals'

export function Goals() {
  const { goals, error, refresh } = useGoals()
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [project, setProject] = useState('')
  const [objective, setObjective] = useState('')
  const [criteria, setCriteria] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const create = async () => {
    setFormError(null)
    const res = await apiFetch('/api/goals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(),
        project: project.trim(),
        objective: objective.trim(),
        criteria: criteria.split('\n').map((c) => c.trim()).filter(Boolean),
      }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setFormError(body?.error ?? `failed: ${res.status}`)
      return
    }
    setTitle('')
    setObjective('')
    setCriteria('')
    setShowForm(false)
    void refresh()
  }

  return (
    <div className="goals">
      <div className="goals-head">
        <h2>Goals</h2>
        <button className="ghost" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : 'New goal'}
        </button>
      </div>

      {showForm && (
        <div className="goal-form">
          <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input
            placeholder="Project (registered name, e.g. trading-bot)"
            value={project}
            onChange={(e) => setProject(e.target.value)}
          />
          <textarea
            placeholder="Objective — what should be true when this is done?"
            rows={3}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />
          <textarea
            placeholder={'Success criteria, one per line'}
            rows={3}
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
          />
          {formError && <div className="error">{formError}</div>}
          <button onClick={() => void create()} disabled={!title.trim() || !project.trim() || !objective.trim()}>
            Create
          </button>
        </div>
      )}

      {error && <div className="error">{error}</div>}
      {goals.length === 0 && !showForm && (
        <div className="empty">
          <p>No goals yet. Create one and HALO will dispatch an executor to get it done.</p>
        </div>
      )}
      {goals.map((g) => (
        <GoalCard key={g.id} goal={g} onChanged={refresh} />
      ))}
    </div>
  )
}
