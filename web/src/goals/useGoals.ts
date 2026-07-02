import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, readSse } from '../api'

export interface GoalSummary {
  id: string
  title: string
  status: string
  project: string
  executor: string
  iterations: number
  log: string[]
  running: boolean
}

export function useGoals() {
  const [goals, setGoals] = useState<GoalSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/api/goals')
      const body = (await res.json()) as { data: GoalSummary[] }
      setGoals(body.data)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 8000)
    return () => clearInterval(timer)
  }, [refresh])

  return { goals, error, refresh }
}

/** Live log lines for one goal via SSE. */
export function useGoalEvents(goalId: string | null) {
  const [lines, setLines] = useState<string[]>([])
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setLines([])
    abortRef.current?.abort()
    if (!goalId) return
    const abort = new AbortController()
    abortRef.current = abort

    void (async () => {
      try {
        const res = await apiFetch(`/api/goals/${goalId}/events`, { signal: abort.signal })
        if (!res.body) return
        for await (const { event, data } of readSse(res.body)) {
          if (event === 'snapshot') {
            setLines((data['log'] as string[]) ?? [])
          } else if (event === 'goal') {
            setLines((prev) => [...prev, `${data['kind']}: ${data['text'] as string}`])
          }
        }
      } catch {
        // disconnects are normal — the poll in useGoals keeps state fresh
      }
    })()

    return () => abort.abort()
  }, [goalId])

  return lines
}
