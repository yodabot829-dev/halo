import { useState } from 'react'
import type { MemorySeries } from './useMemoryStats'

const W = 720
const H = 200
const PAD = { top: 8, right: 28, bottom: 22, left: 28 }

interface Props {
  months: string[]
  series: MemorySeries[]
}

/** Stacked area of memory growth. 2px surface strokes separate bands
 * (CVD secondary encoding); crosshair + tooltip on hover. */
export function StackedArea({ months, series }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  if (months.length < 2) return null

  const totals = months.map((_, i) => series.reduce((s, sr) => s + (sr.values[i] ?? 0), 0))
  const yMax = Math.max(...totals, 1)
  const x = (i: number) => PAD.left + (i / (months.length - 1)) * (W - PAD.left - PAD.right)
  const y = (v: number) => PAD.top + (1 - v / yMax) * (H - PAD.top - PAD.bottom)

  // Cumulative baselines, bottom band first.
  const cumulative = months.map(() => 0)
  const bands = series.map((sr) => {
    const base = [...cumulative]
    sr.values.forEach((v, i) => (cumulative[i] = (cumulative[i] ?? 0) + v))
    const top = [...cumulative]
    const forward = months.map((_, i) => `${x(i)},${y(top[i] ?? 0)}`).join(' ')
    const back = months
      .map((_, i) => i)
      .reverse()
      .map((i) => `${x(i)},${y(base[i] ?? 0)}`)
      .join(' ')
    return { name: sr.name, color: sr.color, points: `${forward} ${back}` }
  })

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (months.length - 1))
    setHover(Math.max(0, Math.min(months.length - 1, i)))
  }

  const tickEvery = Math.max(1, Math.floor(months.length / 6))

  return (
    <div className="area-wrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="area"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {bands.map((b) => (
          <polygon key={b.name} points={b.points} fill={b.color} className="band" />
        ))}
        <line x1={PAD.left} y1={y(0)} x2={W - PAD.right} y2={y(0)} className="axis-line" />
        {months.map((m, i) =>
          i % tickEvery === 0 || i === months.length - 1 ? (
            <text
              key={m}
              x={x(i)}
              y={H - 6}
              className="axis-text"
              textAnchor={i === 0 ? 'start' : i === months.length - 1 ? 'end' : 'middle'}
            >
              {m}
            </text>
          ) : null,
        )}
        {hover !== null && (
          <line x1={x(hover)} y1={PAD.top} x2={x(hover)} y2={y(0)} className="crosshair" />
        )}
      </svg>
      {hover !== null && (
        <div className="area-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <div className="tip-title">{months[hover]}</div>
          {[...series]
            .map((sr) => ({ name: sr.name, color: sr.color, v: sr.values[hover] ?? 0 }))
            .filter((r) => r.v > 0)
            .sort((a, b) => b.v - a.v)
            .map((r) => (
              <div key={r.name} className="tip-row">
                <span className="dot" style={{ background: r.color }} />
                {r.name} <b>{r.v}</b>
              </div>
            ))}
          <div className="tip-row total">total {totals[hover]}</div>
        </div>
      )}
    </div>
  )
}
