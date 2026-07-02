import { StackedArea } from './StackedArea'
import { useMemoryStats } from './useMemoryStats'

/** Cross-project memory overview: growth over time + per-project share.
 * The rows double as the table view (relief for low-contrast series). */
export function MemoryViz({ onOpenProject }: { onOpenProject?: (name: string) => void }) {
  const { overview, error } = useMemoryStats()
  if (error) return <div className="error">{error}</div>
  if (!overview) return null

  const { months, series, projects, colorFor } = overview
  const maxTotal = Math.max(...projects.map((p) => p.total), 1)

  return (
    <div className="memviz">
      <StackedArea months={months} series={series} />
      <div className="legend">
        {series.map((s) => (
          <span key={s.name} className="legend-item">
            <span className="dot" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>

      <div className="mem-rows">
        {projects.slice(0, 12).map((p) => (
          <button
            key={p.project}
            className="mem-row"
            onClick={() => onOpenProject?.(p.project)}
            title={Object.entries(p.types)
              .map(([t, n]) => `${t}: ${n}`)
              .join(' · ')}
          >
            <span className="dot" style={{ background: colorFor.get(p.project) }} />
            <span className="mem-name">{p.project}</span>
            <span className="mem-bar-track">
              <span
                className="mem-bar"
                style={{
                  width: `${(p.total / maxTotal) * 100}%`,
                  background: colorFor.get(p.project),
                }}
              />
            </span>
            <span className="mem-count">{p.total.toLocaleString()}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
