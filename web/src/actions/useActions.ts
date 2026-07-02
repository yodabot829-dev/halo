import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../api'

export interface ActionSummary {
  name: string
  label: string
  project: string
  schedule: string | null
  running: boolean
  lastRun: { id: string; status: string; finishedAt?: string } | null
}

export interface RunSummary {
  id: string
  action: string
  status: string
  startedAt: string
  finishedAt?: string
  output: string
}

export function useActions() {
  const [actions, setActions] = useState<ActionSummary[]>([])
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [actionsRes, runsRes] = await Promise.all([
        apiFetch('/api/actions').then((r) => r.json() as Promise<{ data: ActionSummary[] }>),
        apiFetch('/api/runs?limit=15').then((r) => r.json() as Promise<{ data: RunSummary[] }>),
      ])
      setActions(actionsRes.data)
      setRuns(runsRes.data)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => clearInterval(timer)
  }, [refresh])

  const run = useCallback(
    async (name: string) => {
      const res = await apiFetch(`/api/actions/${name}/run`, { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setError(body?.error ?? `failed to queue ${name}`)
      }
      await refresh()
    },
    [refresh],
  )

  return { actions, runs, error, run }
}
