import { useEffect, useRef } from 'react'
import { AMBIENT_ALPHA, buildForceGraph, type GraphNode } from './useForceGraph'
import type { MemoryOverview } from './useMemoryStats'

/** Live force-directed memory graph — hubs and note-nodes on springs,
 * continuously breathing. Hover a cluster to light it up; drag anything;
 * click a hub to drill into the project. */
export function Constellation({
  overview,
  onOpenProject,
}: {
  overview: MemoryOverview
  onOpenProject?: (name: string) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

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

    const { nodes, links, simulation } = buildForceGraph(overview, w, h)
    const styles = getComputedStyle(canvas)
    const resolve = (c: string) =>
      c.startsWith('var(') ? styles.getPropertyValue(c.slice(4, -1)).trim() || '#888' : c
    const colors = new Map(nodes.map((n) => [n.project, resolve(n.color)]))
    const lineColor = styles.getPropertyValue('--line').trim()
    const mutedColor = styles.getPropertyValue('--muted').trim()
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      simulation.alphaTarget(0).stop()
      simulation.tick(220) // settle instantly, draw static
    }

    let hoverProject: string | null = null
    let dragNode: GraphNode | null = null

    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      // links first
      for (const link of links) {
        const s = link.source as GraphNode
        const t = link.target as GraphNode
        if (typeof s === 'string' || typeof t === 'string') continue
        const active = hoverProject !== null && !link.hubLink && s.project === hoverProject
        ctx.globalAlpha = link.hubLink ? 0.07 : active ? 0.5 : hoverProject ? 0.05 : 0.16
        ctx.strokeStyle = active ? (colors.get(s.project) ?? lineColor) : lineColor
        ctx.lineWidth = active ? 1 : 0.7
        ctx.beginPath()
        ctx.moveTo(s.x!, s.y!)
        ctx.lineTo(t.x!, t.y!)
        ctx.stroke()
      }
      // nodes
      for (const node of nodes) {
        const dimmed = hoverProject !== null && node.project !== hoverProject
        ctx.globalAlpha = dimmed ? 0.16 : node.hub ? 1 : 0.85
        ctx.beginPath()
        ctx.arc(node.x!, node.y!, node.r, 0, 7)
        ctx.fillStyle = colors.get(node.project) ?? '#888'
        ctx.fill()
      }
      // labels on hubs
      ctx.globalAlpha = 1
      ctx.textAlign = 'center'
      for (const node of nodes) {
        if (!node.hub) continue
        const hovered = node.project === hoverProject
        if (hoverProject && !hovered) continue
        ctx.fillStyle = hovered ? (colors.get(node.project) ?? mutedColor) : mutedColor
        ctx.font = `${hovered ? 600 : 400} 11px "Helvetica Neue", Helvetica, sans-serif`
        ctx.fillText(
          hovered ? `${node.project} · ${node.count?.toLocaleString()}` : node.project,
          node.x!,
          node.y! + node.r + 14,
        )
      }
    }

    simulation.on('tick', draw)
    if (reduceMotion) draw()

    const nodeAt = (e: MouseEvent): GraphNode | null => {
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      let best: GraphNode | null = null
      let bestDist = 22
      for (const node of nodes) {
        const d = Math.hypot(x - node.x!, y - node.y!) - node.r
        if (d < bestDist) {
          bestDist = d
          best = node
        }
      }
      return best
    }

    const onMove = (e: MouseEvent) => {
      if (dragNode) {
        const rect = canvas.getBoundingClientRect()
        dragNode.fx = e.clientX - rect.left
        dragNode.fy = e.clientY - rect.top
        simulation.alphaTarget(0.3).restart()
        return
      }
      const node = nodeAt(e)
      hoverProject = node?.project ?? null
      canvas.style.cursor = node ? (node.hub ? 'pointer' : 'grab') : 'default'
      if (reduceMotion) draw()
    }
    const onDown = (e: MouseEvent) => {
      dragNode = nodeAt(e)
      if (dragNode) canvas.style.cursor = 'grabbing'
    }
    const onUp = (e: MouseEvent) => {
      if (dragNode) {
        const moved = Math.hypot((dragNode.fx ?? 0) - (dragNode.x ?? 0), 0) > 2
        if (dragNode.hub && !moved) onOpenProject?.(dragNode.project)
        dragNode.fx = null
        dragNode.fy = null
        dragNode = null
        simulation.alphaTarget(reduceMotion ? 0 : AMBIENT_ALPHA)
      } else {
        const node = nodeAt(e)
        if (node?.hub) onOpenProject?.(node.project)
      }
    }

    canvas.addEventListener('mousemove', onMove)
    canvas.addEventListener('mousedown', onDown)
    window.addEventListener('mouseup', onUp)
    return () => {
      simulation.stop()
      canvas.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mouseup', onUp)
    }
  }, [overview, onOpenProject])

  return <canvas ref={canvasRef} className="constellation" aria-label="Memory constellation" />
}
