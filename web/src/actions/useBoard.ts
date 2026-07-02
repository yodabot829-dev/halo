import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../api'
import type { RunSummary } from './useActions'

export interface BoardData {
  awaiting: RunSummary[]
  runningActions: string[]
  runningGoals: { id: string; title: string; project: string }[]
  goals: { id: string; title: string; status: string; project: string }[]
  routines: { name: string; schedule: string; nextRun: string | null }[]
  recent: RunSummary[]
}

export function useBoard() {
  const [board, setBoard] = useState<BoardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch('/api/board')
      const body = (await res.json()) as { data: BoardData }
      setBoard(body.data)
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

  const approve = useCallback(
    async (action: string, id: string) => {
      await apiFetch(`/api/actions/${action}/runs/${id}/approve`, { method: 'POST' })
      await refresh()
    },
    [refresh],
  )

  const reject = useCallback(
    async (action: string, id: string, feedback: string) => {
      await apiFetch(`/api/actions/${action}/runs/${id}/reject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feedback }),
      })
      await refresh()
    },
    [refresh],
  )

  return { board, error, refresh, approve, reject }
}
