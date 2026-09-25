// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ElementDefinition } from 'cytoscape'
import type { BoardStage } from '@/stores/board-store'
import type { RunNode } from '@/stores/run-tree-store'

export type GraphMode = 'orchestration' | 'stageFlow'

/** Row shape of GET /api/v1/orchestration/runs (timestamps are epoch ms). */
export interface OrchestrationRunSummary {
  runId: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  updatedAt: number
  eventCount: number
}

/**
 * Default run for the orchestration graph: the freshest still-running run,
 * else the run with the latest activity. Order-independent so the caller does
 * not have to trust the API's sort.
 */
export function pickDefaultRun(runs: OrchestrationRunSummary[]): OrchestrationRunSummary | null {
  let best: OrchestrationRunSummary | null = null
  for (const run of runs) {
    if (best === null) {
      best = run
      continue
    }
    const runIsRunning = run.status === 'running'
    const bestIsRunning = best.status === 'running'
    if (runIsRunning !== bestIsRunning) {
      if (runIsRunning) best = run
      continue
    }
    if (run.updatedAt > best.updatedAt) best = run
  }
  return best
}

/** Compact run id for the selector label — run ids are conversation/session ids. */
export function shortRunId(runId: string): string {
  return runId.length > 8 ? runId.slice(0, 8) : runId
}

export const STAGE_NODE_MIN_PX = 28
export const STAGE_NODE_MAX_PX = 88
/** Conversation count at which a stage node reaches STAGE_NODE_MAX_PX. */
export const STAGE_NODE_REF_COUNT = 12

/**
 * Conversation count → node diameter. Square-root scaling so the node *area*
 * (what the eye compares) stays roughly proportional to the count instead of
 * exploding on busy stages.
 */
export function stageNodeSize(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return STAGE_NODE_MIN_PX
  const ratio = Math.min(1, Math.sqrt(count) / Math.sqrt(STAGE_NODE_REF_COUNT))
  return Math.round(STAGE_NODE_MIN_PX + (STAGE_NODE_MAX_PX - STAGE_NODE_MIN_PX) * ratio)
}

export function stageElementId(stageId: string): string {
  return `stage:${stageId}`
}

export function edgeElementId(source: string, target: string): string {
  return `${source}->${target}`
}

/**
 * Render order: depth-first from the declared roots, then any node the roots
 * never reach (a subagent whose parent event was missed) so a broken tree still
 * shows every run. The `seen` set doubles as the cycle guard.
 */
function orderedNodeIds(
  nodes: Record<string, RunNode>,
  rootIds: string[],
  childIds: Record<string, string[]>,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const visit = (id: string): void => {
    if (seen.has(id) || !nodes[id]) return
    seen.add(id)
    out.push(id)
    for (const childId of childIds[id] ?? []) visit(childId)
  }

  for (const id of rootIds) visit(id)
  for (const id of Object.keys(nodes)) visit(id)
  return out
}

/**
 * Every node from a running node up to its root. Walking ancestors via
 * `parentId` (rather than down through `childIds`) keeps this consistent with
 * the edges, which are derived from `parentId` too.
 */
export function activePathIds(nodes: Record<string, RunNode>): Set<string> {
  const active = new Set<string>()

  for (const node of Object.values(nodes)) {
    if (node.status !== 'running') continue
    let current: RunNode | undefined = node
    const guard = new Set<string>()
    while (current && !guard.has(current.nodeId)) {
      guard.add(current.nodeId)
      active.add(current.nodeId)
      current = current.parentId ? nodes[current.parentId] : undefined
    }
  }
  return active
}

/**
 * Run tree → cytoscape elements. A node whose `parentId` is unknown to `nodes`
 * is emitted as a root rather than dangling off a non-existent edge.
 */
export function buildOrchestrationElements(
  nodes: Record<string, RunNode>,
  rootIds: string[],
  childIds: Record<string, string[]>,
): ElementDefinition[] {
  const ids = orderedNodeIds(nodes, rootIds, childIds)
  const active = activePathIds(nodes)
  const elements: ElementDefinition[] = []

  for (const id of ids) {
    const node = nodes[id]
    const onActivePath = active.has(id)
    elements.push({
      group: 'nodes',
      data: {
        id,
        label: node.label,
        kind: node.kind,
        status: node.status,
        turn: node.turn,
        tokens: node.tokens,
        currentTool: node.currentTool,
        conversationId: node.conversationId,
        isRoot: node.parentId == null || !nodes[node.parentId],
        onActivePath,
      },
      classes: onActivePath ? 'active-path' : '',
    })
  }

  for (const id of ids) {
    const parentId = nodes[id].parentId
    if (!parentId || !nodes[parentId]) continue
    // An ancestor of a running node is always on the active path itself, so the
    // child's flag decides the edge.
    const onActivePath = active.has(id)
    elements.push({
      group: 'edges',
      data: { id: edgeElementId(parentId, id), source: parentId, target: id, onActivePath },
      classes: onActivePath ? 'active-path' : '',
    })
  }

  return elements
}

/** Project stages → a left-to-right chain, node size driven by task count. */
export function buildStageFlowElements(stages: BoardStage[]): ElementDefinition[] {
  const ordered = [...stages].sort((a, b) => a.sortOrder - b.sortOrder)
  const elements: ElementDefinition[] = []

  ordered.forEach((stage, index) => {
    const count = stage.conversations.length
    elements.push({
      group: 'nodes',
      data: {
        id: stageElementId(stage.id),
        stageId: stage.id,
        label: stage.name,
        count,
        size: stageNodeSize(count),
        color: stage.color,
        isClosed: stage.isClosed,
      },
      classes: stage.isClosed ? 'stage-closed' : '',
    })

    const previous = ordered[index - 1]
    if (previous) {
      const source = stageElementId(previous.id)
      const target = stageElementId(stage.id)
      elements.push({ group: 'edges', data: { id: edgeElementId(source, target), source, target } })
    }
  })

  return elements
}

/**
 * Stable fingerprint of the element *id set*. Layout only re-runs when this
 * changes, so live status/token ticks (data-only updates) never re-position the
 * graph under the user's cursor.
 */
export function topologyKey(elements: ElementDefinition[]): string {
  return elements
    .map((element) => {
      const id = String(element.data?.id ?? '')
      const isEdge =
        element.group === 'edges' ||
        (element.data?.source != null && element.data?.target != null)
      return `${isEdge ? 'e' : 'n'}:${id}`
    })
    .sort()
    .join('|')
}

/**
 * The theme publishes colors as bare HSL triplets (`--foreground: 0 0% 98%`),
 * but cytoscape paints to canvas and needs a literal color string — and its
 * parser only accepts the comma form of `hsl()`, not the modern space form.
 */
export function cssTripletToColor(raw: string, fallback: string): string {
  const value = raw.trim()
  if (!value) return fallback
  if (/^(#|rgba?\(|hsla?\()/i.test(value)) return value

  // Split on whitespace and the `/` that precedes an alpha channel, which
  // cytoscape's parser cannot read — dropping it is the intended behaviour.
  const parts = value.split(/[\s/]+/).filter(Boolean)
  if (parts.length < 3) return fallback
  return `hsl(${parts[0]}, ${parts[1]}, ${parts[2]})`
}
