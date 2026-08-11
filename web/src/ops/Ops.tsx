import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
import { DeviceMemory } from './DeviceMemory'

interface ProviderTotals {
  provider: string
  calls: number
  inputTokens: number
  outputTokens: number
}

interface BudgetStatus {
  provider: string
  monthlyTokens: number | null
  usedTokens: number
  remainingTokens: number | null
}

interface Usage {
  totals: ProviderTotals[]
  budgets: BudgetStatus[]
}

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : `${n}`

export function Ops() {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/api/usage')
      .then((r) => r.json())
      .then((body: { data: Usage }) => setUsage(body.data))
      .catch((err: Error) => setError(err.message))
  }, [])

  // Device memory stands alone — a failed usage fetch must not hide it.
  const spend = error ? (
    <div className="error">{error}</div>
  ) : !usage ? (
    <div className="empty">Loading usage…</div>
  ) : (
    renderSpend(usage)
  )

  return (
    <div className="ops">
      {spend}
      <DeviceMemory />
    </div>
  )
}

function renderSpend(usage: Usage) {
  const totalsByProvider = new Map(usage.totals.map((t) => [t.provider, t]))

  return (
    <>
      <h2>This month</h2>
      {usage.budgets.map((b) => {
        const t = totalsByProvider.get(b.provider)
        const pct =
          b.monthlyTokens !== null ? Math.min(100, (b.usedTokens / b.monthlyTokens) * 100) : null
        return (
          <div key={b.provider} className="budget-row">
            <div className="budget-head">
              <span className="budget-name">{b.provider}</span>
              <span className="budget-figures">
                {b.monthlyTokens !== null
                  ? `${fmt(b.usedTokens)} / ${fmt(b.monthlyTokens)} tokens`
                  : `${fmt(b.usedTokens)} tokens · unmetered`}
                {t ? ` · ${t.calls} calls` : ''}
              </span>
            </div>
            <div className="budget-bar">
              <div
                className={`budget-fill${pct !== null && pct > 90 ? ' hot' : ''}`}
                style={{ width: pct !== null ? `${pct}%` : '0%' }}
              />
            </div>
          </div>
        )
      })}
    </>
  )
}
