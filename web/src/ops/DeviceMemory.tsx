import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../api'

interface AppUsage {
  app: string
  memoryMb: number
  processes: { pid: number; memoryMb: number; command: string }[]
  quittable: boolean
}

interface MemorySnapshot {
  totalMb: number
  freePercent: number
  swapUsedMb: number
  swapTotalMb: number
  apps: AppUsage[]
}

const REFRESH_MS = 10_000

const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`)

export function DeviceMemory() {
  const [snap, setSnap] = useState<MemorySnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/system/memory')
      const body = (await res.json()) as { success: boolean; data?: MemorySnapshot; error?: string }
      if (!body.success || !body.data) throw new Error(body.error ?? 'snapshot failed')
      setSnap(body.data)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  // Quitting an app can lose unsaved work, so confirm with the app named.
  const onQuit = async (app: AppUsage) => {
    const targets = app.processes.filter((p) => p.pid >= 500)
    if (!window.confirm(`Quit ${app.app} (${targets.length} process(es))? Unsaved work is lost.`)) {
      return
    }
    setPending(targets[0]?.pid ?? null)
    const failures: string[] = []
    for (const p of targets) {
      const res = await apiFetch(`/api/system/quit/${p.pid}`, { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        failures.push(`${p.pid}: ${body.error ?? res.status}`)
      }
    }
    setPending(null)
    setError(failures.length ? `Could not quit — ${failures.join('; ')}` : null)
    await load()
  }

  if (error && !snap) return <div className="error">{error}</div>
  if (!snap) return <div className="empty">Reading device memory…</div>

  const swapPct = snap.swapTotalMb ? (snap.swapUsedMb / snap.swapTotalMb) * 100 : 0

  return (
    <div className="device-memory">
      <h2>Device memory</h2>
      <p className="device-summary">
        {gb(snap.totalMb)} installed · {snap.freePercent}% free · swap {gb(snap.swapUsedMb)} /{' '}
        {gb(snap.swapTotalMb)}
      </p>
      <div className="budget-bar" aria-label={`Swap ${Math.round(swapPct)}% used`}>
        <div className={`budget-fill${swapPct > 90 ? ' hot' : ''}`} style={{ width: `${swapPct}%` }} />
      </div>
      {error ? <div className="error">{error}</div> : null}
      <ul className="device-list">
        {snap.apps.map((a) => (
          <li key={a.app} className="device-row">
            <span className="device-name" title={a.processes[0]?.command}>
              {a.app}
              {a.processes.length > 1 ? (
                <span className="device-count"> ×{a.processes.length}</span>
              ) : null}
            </span>
            <span className="device-mem">{gb(a.memoryMb)}</span>
            {a.quittable ? (
              <button
                type="button"
                className="device-quit"
                onClick={() => void onQuit(a)}
                disabled={pending !== null}
              >
                {pending !== null ? '…' : 'Quit'}
              </button>
            ) : (
              <span className="device-quit-locked" title="System process — not quittable">
                —
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
