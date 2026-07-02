import { useEffect, useRef } from 'react'
import type { MemoryOverview } from './useMemoryStats'

interface Dot {
  x: number
  y: number
  r: number
  phase: number
  speed: number
}

interface Cluster {
  project: string
  color: string
  cx: number
  cy: number
  radius: number
  count: number
  dots: Dot[]
}

/** Deterministic PRNG so the constellation is stable across renders. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)

function buildClusters(overview: MemoryOverview, w: number, h: number): Cluster[] {
  const projects = overview.projects.slice(0, 10)
  const maxTotal = Math.max(...projects.map((p) => p.total), 1)
  // Golden-angle spiral keeps clusters spread without overlap for ~10 items.
  return projects.map((p, i) => {
    const angle = i * 2.39996
    const dist = 0.16 + 0.34 * Math.sqrt((i + 0.6) / projects.length)
    const cx = w / 2 + Math.cos(angle) * dist * w * 0.82
    const cy = h / 2 + Math.sin(angle) * dist * h * 0.78
    const radius = 22 + 52 * Math.sqrt(p.total / maxTotal)
    const rand = mulberry32(hash(p.project))
    const count = Math.max(10, Math.min(110, Math.round(p.total / 24)))
    const dots: Dot[] = Array.from({ length: count }, () => {
      const a = rand() * Math.PI * 2
      const d = radius * Math.sqrt(rand())
      return {
        x: Math.cos(a) * d,
        y: Math.sin(a) * d * 0.72,
        r: 0.8 + rand() * 1.6,
        phase: rand() * Math.PI * 2,
        speed: 0.2 + rand() * 0.5,
      }
    })
    return {
      project: p.project,
      color: overview.colorFor.get(p.project) ?? 'var(--sother)',
      cx,
      cy,
      radius,
      count: p.total,
      dots,
    }
  })
}

export function Constellation({
  overview,
  onOpenProject,
}: {
  overview: MemoryOverview
  onOpenProject?: (name: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hoverRef = useRef<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    const clusters = buildClusters(overview, w, h)
    const styles = getComputedStyle(canvas)
    const colorOf = (c: Cluster) =>
      c.color.startsWith('var(')
        ? styles.getPropertyValue(c.color.slice(4, -1)).trim() || '#888'
        : c.color
    const muted = styles.getPropertyValue('--muted').trim()
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let raf = 0
    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h)
      for (const cluster of clusters) {
        const color = colorOf(cluster)
        const hovered = hoverRef.current === cluster.project
        ctx.globalAlpha = hovered ? 1 : 0.75
        for (const dot of cluster.dots) {
          const wobble = reduceMotion ? 0 : Math.sin(t / 1600 * dot.speed + dot.phase) * 2.2
          ctx.beginPath()
          ctx.arc(cluster.cx + dot.x + wobble, cluster.cy + dot.y + wobble * 0.6, dot.r, 0, 7)
          ctx.fillStyle = color
          ctx.fill()
        }
        ctx.globalAlpha = hovered ? 1 : 0.85
        ctx.fillStyle = hovered ? color : muted
        ctx.font = `${hovered ? 600 : 400} 11px "Helvetica Neue", Helvetica, sans-serif`
        ctx.textAlign = 'center'
        ctx.fillText(
          `${cluster.project}${hovered ? ` · ${cluster.count.toLocaleString()}` : ''}`,
          cluster.cx,
          cluster.cy + cluster.radius * 0.75 + 16,
        )
      }
      ctx.globalAlpha = 1
      if (!reduceMotion) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    const clusterAt = (e: MouseEvent): Cluster | null => {
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      return (
        clusters.find((c) => Math.hypot(x - c.cx, (y - c.cy) / 0.75) < c.radius + 14) ?? null
      )
    }
    const onMove = (e: MouseEvent) => {
      const cluster = clusterAt(e)
      hoverRef.current = cluster?.project ?? null
      canvas.style.cursor = cluster ? 'pointer' : 'default'
      if (reduceMotion) draw(0)
    }
    const onClick = (e: MouseEvent) => {
      const cluster = clusterAt(e)
      if (cluster) onOpenProject?.(cluster.project)
    }
    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('click', onClick)
    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('click', onClick)
    }
  }, [overview, onOpenProject])

  return <canvas ref={canvasRef} className="constellation" aria-label="Memory constellation" />
}
