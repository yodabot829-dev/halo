import { useEffect, useState } from 'react'
import { apiFetch } from '../api'

export interface ProjectMemoryStats {
  project: string
  total: number
  types: Record<string, number>
  months: Record<string, number>
}

export interface MemorySeries {
  name: string
  color: string
  values: number[]
}

export interface MemoryOverview {
  projects: ProjectMemoryStats[]
  months: string[]
  series: MemorySeries[]
  colorFor: Map<string, string>
}

export const SERIES_COLORS = [
  'var(--s1)',
  'var(--s2)',
  'var(--s3)',
  'var(--s4)',
  'var(--s5)',
  'var(--s6)',
]
export const OTHER_COLOR = 'var(--sother)'
const WINDOW = 18 // months
const TOP_N = SERIES_COLORS.length

export function shapeOverview(projects: ProjectMemoryStats[]): MemoryOverview {
  const allMonths = [...new Set(projects.flatMap((p) => Object.keys(p.months)))].sort()
  const months = allMonths.slice(-WINDOW)

  const top = projects.slice(0, TOP_N)
  const rest = projects.slice(TOP_N)
  const colorFor = new Map<string, string>(top.map((p, i) => [p.project, SERIES_COLORS[i]!]))
  rest.forEach((p) => colorFor.set(p.project, OTHER_COLOR))

  const series: MemorySeries[] = top.map((p, i) => ({
    name: p.project,
    color: SERIES_COLORS[i]!,
    values: months.map((m) => p.months[m] ?? 0),
  }))
  if (rest.length > 0) {
    series.push({
      name: 'other',
      color: OTHER_COLOR,
      values: months.map((m) => rest.reduce((sum, p) => sum + (p.months[m] ?? 0), 0)),
    })
  }
  return { projects, months, series, colorFor }
}

export function useMemoryStats() {
  const [overview, setOverview] = useState<MemoryOverview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/api/memory/projects')
      .then((r) => r.json())
      .then((body: { data: ProjectMemoryStats[] }) => setOverview(shapeOverview(body.data)))
      .catch((err: Error) => setError(err.message))
  }, [])

  return { overview, error }
}
