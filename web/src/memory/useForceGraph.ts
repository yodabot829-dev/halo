import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from 'd3-force'
import type { MemoryOverview } from './useMemoryStats'

export interface GraphNode extends SimulationNodeDatum {
  id: string
  project: string
  color: string
  r: number
  hub: boolean
  count?: number
}

export interface GraphLink {
  source: GraphNode | string
  target: GraphNode | string
  hubLink: boolean
}

export interface ForceGraph {
  nodes: GraphNode[]
  links: GraphLink[]
  simulation: Simulation<GraphNode, GraphLink>
}

const MAX_DOTS_PER_CLUSTER = 46
const MIN_DOTS_PER_CLUSTER = 7

/** Obsidian-style force graph: each project is a hub with satellite notes,
 * springs hold clusters together, repulsion keeps everything breathing. */
export function buildForceGraph(overview: MemoryOverview, w: number, h: number): ForceGraph {
  const projects = overview.projects.slice(0, 10)
  const maxTotal = Math.max(...projects.map((p) => p.total), 1)
  const nodes: GraphNode[] = []
  const links: GraphLink[] = []

  projects.forEach((p, i) => {
    const angle = i * 2.39996
    const dist = 0.18 + 0.3 * Math.sqrt((i + 0.6) / projects.length)
    const anchorX = w / 2 + Math.cos(angle) * dist * w * 0.8
    const anchorY = h / 2 + Math.sin(angle) * dist * h * 0.76
    const color = overview.colorFor.get(p.project) ?? 'var(--sother)'

    const hub: GraphNode = {
      id: `hub:${p.project}`,
      project: p.project,
      color,
      r: 5 + 7 * Math.sqrt(p.total / maxTotal),
      hub: true,
      count: p.total,
      x: anchorX,
      y: anchorY,
      // fx/fy left free — hubs drift too; anchored softly by forceX/Y below
    }
    nodes.push(hub)

    const dotCount = Math.max(
      MIN_DOTS_PER_CLUSTER,
      Math.min(MAX_DOTS_PER_CLUSTER, Math.round((p.total / maxTotal) * MAX_DOTS_PER_CLUSTER)),
    )
    for (let d = 0; d < dotCount; d++) {
      const node: GraphNode = {
        id: `${p.project}:${d}`,
        project: p.project,
        color,
        r: 1.2 + ((d * 7919) % 100) / 55,
        hub: false,
        x: anchorX + Math.cos(d) * 8,
        y: anchorY + Math.sin(d * 1.7) * 8,
      }
      nodes.push(node)
      links.push({ source: node.id, target: hub.id, hubLink: false })
      // occasional peer link for the organic web look
      if (d > 1 && d % 4 === 0) {
        links.push({ source: node.id, target: `${p.project}:${d - 2}`, hubLink: false })
      }
    }

    // faint hub-to-hub thread to the previous hub — one connected brain
    if (i > 0) {
      links.push({ source: hub.id, target: `hub:${projects[i - 1]!.project}`, hubLink: true })
    }
  })

  const anchors = new Map(
    projects.map((p, i) => {
      const angle = i * 2.39996
      const dist = 0.18 + 0.3 * Math.sqrt((i + 0.6) / projects.length)
      return [
        p.project,
        {
          x: w / 2 + Math.cos(angle) * dist * w * 0.8,
          y: h / 2 + Math.sin(angle) * dist * h * 0.76,
        },
      ]
    }),
  )

  const simulation = forceSimulation<GraphNode>(nodes)
    .force(
      'link',
      forceLink<GraphNode, GraphLink>(links)
        .id((n) => n.id)
        .distance((l) => (l.hubLink ? 190 : 26 + Math.random() * 22))
        .strength((l) => (l.hubLink ? 0.02 : 0.35)),
    )
    .force('charge', forceManyBody<GraphNode>().strength((n) => (n.hub ? -90 : -7)))
    .force('collide', forceCollide<GraphNode>((n) => n.r + 1.6).strength(0.6))
    .force('x', forceX<GraphNode>((n) => anchors.get(n.project)?.x ?? w / 2).strength((n) => (n.hub ? 0.08 : 0.012)))
    .force('y', forceY<GraphNode>((n) => anchors.get(n.project)?.y ?? h / 2).strength((n) => (n.hub ? 0.08 : 0.012)))
    .alpha(1)
    .alphaDecay(0.015)
    // never fully sleeps — the graph keeps breathing like Obsidian's
    .alphaTarget(0.012)

  return { nodes, links, simulation }
}
