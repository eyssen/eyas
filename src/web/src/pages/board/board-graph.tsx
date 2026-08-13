// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useWebSocket } from '@/hooks/use-websocket'
import { api } from '@/lib/api'
import { createHydrationBuffer } from '@/lib/hydration-buffer'
import { WS_TOPICS } from '@/lib/ws-topics'
import { useBoardStore } from '@/stores/board-store'
import { useRunTreeStore, type OrchestrationEventLike } from '@/stores/run-tree-store'
import { useThemeStore } from '@/stores/theme-store'
import type { BoardViewProps } from './board-view-props'
import { t } from './i18n'
import {
  buildOrchestrationElements,
  buildStageFlowElements,
  cssTripletToColor,
  pickDefaultRun,
  shortRunId,
  topologyKey,
  type GraphMode,
  type OrchestrationRunSummary,
} from './board-graph-utils'

interface BoardGraphProps extends BoardViewProps {
  projectId: string | null
}

// Cytoscape paints to a canvas, so it cannot consume utility classes — these
// hexes mirror the `bg-*-400` classes run-tree.tsx uses for the same statuses.
const STATUS_HEX: Record<string, string> = {
  running: '#60a5fa',
  completed: '#34d399',
  failed: '#f87171',
  cancelled: '#a1a1aa',
  paused: '#fbbf24',
}
const STATUS_FALLBACK_HEX = STATUS_HEX.cancelled

interface ThemeColors {
  foreground: string
  muted: string
  border: string
  card: string
  primary: string
}

function readThemeColors(): ThemeColors {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) =>
    cssTripletToColor(style.getPropertyValue(name), fallback)
  return {
    foreground: read('--foreground', '#fafafa'),
    muted: read('--muted-foreground', '#8b8b96'),
    border: read('--border', '#26262e'),
    card: read('--card', '#101018'),
    primary: read('--primary', '#6366f1'),
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

function applyClasses(element: cytoscape.CollectionReturnValue, classes: ElementDefinition['classes']): void {
  const next = Array.isArray(classes) ? classes.join(' ') : (classes ?? '')
  element.classes(next)
}

/**
 * Two read-only maps of the project: the live agent run tree, and the stage
 * chain. Layout is re-run only when the topology changes (see `topologyKey`);
 * status ticks patch element data in place.
 */
export function BoardGraph({ stages }: BoardGraphProps) {
  const [mode, setMode] = useState<GraphMode>('orchestration')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cyRef = useRef<Core | null>(null)
  const topologyRef = useRef<string | null>(null)
  // Bumped whenever the instance below is re-created. The sync effect depends
  // on it, so a fresh (empty) instance is always re-populated — otherwise a
  // theme switch would leave a blank canvas behind.
  const [cyEpoch, setCyEpoch] = useState(0)

  const navigate = useNavigate()
  const setFilter = useBoardStore((s) => s.setFilter)
  const nodes = useRunTreeStore((s) => s.nodes)
  const rootIds = useRunTreeStore((s) => s.rootIds)
  const childIds = useRunTreeStore((s) => s.childIds)
  const theme = useThemeStore((s) => s.theme)
  const template = useThemeStore((s) => s.template)

  // Orchestration data source: the board is not the conversation page, so the
  // run-tree store is fed here — persisted replay + live WS follow-up.
  const { subscribe } = useWebSocket()
  const [runs, setRuns] = useState<OrchestrationRunSummary[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  // Discover persisted runs whenever the graph enters orchestration mode.
  useEffect(() => {
    if (mode !== 'orchestration') return
    let cancelled = false
    void api
      .get<{ runs: OrchestrationRunSummary[] }>('/orchestration/runs?limit=10')
      .then(({ runs: list }) => {
        if (cancelled) return
        const known = list ?? []
        setRuns(known)
        // Keep a still-listed selection; otherwise fall back to the default
        // (prefer a running run, else the one with the latest activity).
        setSelectedRunId((current) =>
          current && known.some((run) => run.runId === current)
            ? current
            : pickDefaultRun(known)?.runId ?? null,
        )
      })
      .catch(() => {
        /* no persisted runs — the graph keeps its empty state */
      })
    return () => {
      cancelled = true
    }
  }, [mode])

  // Hydrate the selected run through loadRun(), then follow it live on the
  // orchestration WS topic. Cleanup unsubscribes on unmount/mode/run change.
  useEffect(() => {
    if (mode !== 'orchestration' || !selectedRunId) return
    let cancelled = false

    // loadRun() resets the tree, so events arriving during the replay fetch are
    // queued and replayed once hydration finished.
    const buffer = createHydrationBuffer<OrchestrationEventLike>()
    buffer.begin()

    const unsubscribe = subscribe(WS_TOPICS.orchestration(selectedRunId), (msg) => {
      // Guard by event and run id before feeding the reducer — a stale frame
      // from a previous run must not land in the freshly hydrated tree.
      const data = msg?.data as OrchestrationEventLike | undefined
      if (msg?.event === 'orchestration' && data?.runId === selectedRunId) {
        if (buffer.push(data)) return
        useRunTreeStore.getState().handleEvent(data)
      }
    })

    void api
      .get<{ events: OrchestrationEventLike[] }>(`/orchestration/runs/${selectedRunId}/events`)
      .then(({ events }) => {
        if (!cancelled && events && events.length > 0) {
          useRunTreeStore.getState().loadRun(selectedRunId, events)
        }
      })
      .catch(() => {
        /* replay unavailable — live events still stream in */
      })
      .finally(() => {
        if (cancelled) return
        const { handleEvent } = useRunTreeStore.getState()
        for (const event of buffer.flush()) handleEvent(event)
      })

    return () => {
      cancelled = true
      buffer.clear()
      unsubscribe()
    }
  }, [mode, selectedRunId, subscribe])

  const [reduceMotion, setReduceMotion] = useState(prefersReducedMotion)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduceMotion(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const elements = useMemo(
    () =>
      mode === 'orchestration'
        ? buildOrchestrationElements(nodes, rootIds, childIds)
        : buildStageFlowElements(stages),
    [mode, nodes, rootIds, childIds, stages],
  )
  const topology = useMemo(() => topologyKey(elements), [elements])
  const hasRunningNode = useMemo(
    () => Object.values(nodes).some((n) => n.status === 'running'),
    [nodes],
  )
  const isEmpty = elements.length === 0

  // Click targets change with the mode, but re-creating the graph on every
  // render of the parent would throw away pan/zoom — so handlers go through a
  // ref the init effect never depends on.
  const tapHandlerRef = useRef<(data: Record<string, unknown>) => void>(() => {})
  useEffect(() => {
    tapHandlerRef.current = (data) => {
      if (mode === 'orchestration') {
        const conversationId = data.conversationId
        if (typeof conversationId === 'string' && conversationId) {
          navigate({ to: '/conversations/$conversationId', params: { conversationId } })
        }
        return
      }
      const stageId = data.stageId
      if (typeof stageId === 'string' && stageId) setFilter('stageId', stageId)
    }
  }, [mode, navigate, setFilter])

  useEffect(() => {
    if (!containerRef.current || isEmpty) return
    const colors = readThemeColors()

    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      minZoom: 0.2,
      maxZoom: 3,
      wheelSensitivity: 0.2,
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            color: colors.foreground,
            'font-size': '9px',
            'text-valign': 'bottom',
            'text-margin-y': 4,
            'text-wrap': 'wrap',
            'text-max-width': '110px',
            'border-width': 1,
            'border-color': colors.border,
          } as cytoscape.Css.Node,
        },
        {
          selector: 'edge',
          style: {
            width: 1,
            'line-color': colors.border,
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': colors.border,
            'arrow-scale': 0.6,
          } as cytoscape.Css.Edge,
        },
        {
          selector: 'node:selected',
          style: { 'border-width': 2, 'border-color': colors.primary } as cytoscape.Css.Node,
        },
        // Orchestration
        {
          selector: 'node[status]',
          style: {
            width: 16,
            height: 16,
            shape: 'ellipse',
            'background-color': (ele: cytoscape.NodeSingular) =>
              STATUS_HEX[String(ele.data('status'))] ?? STATUS_FALLBACK_HEX,
            label: (ele: cytoscape.NodeSingular) => {
              const tool = ele.data('currentTool')
              return typeof tool === 'string' && tool
                ? `${String(ele.data('label'))}\n${tool}…`
                : String(ele.data('label'))
            },
          } as unknown as cytoscape.Css.Node,
        },
        {
          selector: 'node[status][?isRoot]',
          style: { shape: 'round-rectangle', width: 20, height: 20 } as cytoscape.Css.Node,
        },
        {
          selector: 'node[status].active-path',
          style: { 'border-width': 2, 'border-color': colors.primary } as cytoscape.Css.Node,
        },
        {
          selector: 'edge.active-path',
          style: {
            width: 2,
            'line-color': colors.primary,
            'target-arrow-color': colors.primary,
            'line-style': reduceMotion ? 'solid' : 'dashed',
            'line-dash-pattern': [6, 4],
          } as unknown as cytoscape.Css.Edge,
        },
        // Stage flow
        {
          selector: 'node[stageId]',
          style: {
            width: 'data(size)',
            height: 'data(size)',
            shape: 'ellipse',
            'background-color': (ele: cytoscape.NodeSingular) =>
              (ele.data('color') as string | null) ?? colors.muted,
            'background-opacity': 0.85,
            label: (ele: cytoscape.NodeSingular) =>
              `${String(ele.data('label'))}\n${String(ele.data('count'))}`,
            'font-size': '10px',
          } as unknown as cytoscape.Css.Node,
        },
        {
          selector: 'node.stage-closed',
          style: { 'background-opacity': 0.4, 'border-style': 'dashed' } as cytoscape.Css.Node,
        },
      ],
    })

    cyRef.current = cy
    topologyRef.current = null

    cy.on('tap', 'node', (event) => {
      tapHandlerRef.current(event.target.data() as Record<string, unknown>)
    })
    cy.on('mouseover', 'node', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'pointer'
    })
    cy.on('mouseout', 'node', () => {
      if (containerRef.current) containerRef.current.style.cursor = ''
    })

    // The container is flex-sized: it can still be 0×0 on the first frame, and
    // cytoscape only watches the window. Re-fitting is limited to the moment
    // the container first gains a real size, so a later resize keeps whatever
    // the user has panned/zoomed to.
    let hadSize = false
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      const sized = Boolean(box && box.width > 0 && box.height > 0)
      cy.resize()
      if (sized && !hadSize) cy.fit(undefined, 24)
      hadSize = sized
    })
    observer.observe(containerRef.current)

    setCyEpoch((epoch) => epoch + 1)

    return () => {
      observer.disconnect()
      cy.destroy()
      cyRef.current = null
      topologyRef.current = null
    }
  }, [mode, isEmpty, theme, template, reduceMotion])

  // Element sync. Adding/removing elements (and only then re-running layout)
  // is split from data patching so a status tick never moves a node.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    if (topologyRef.current === topology) {
      cy.batch(() => {
        for (const definition of elements) {
          const id = String(definition.data.id ?? '')
          const element = cy.getElementById(id)
          if (element.empty()) continue
          element.data(definition.data)
          applyClasses(element, definition.classes)
        }
      })
      return
    }

    topologyRef.current = topology
    cy.batch(() => {
      cy.elements().remove()
      cy.add(elements)
    })

    const roots = cy.nodes().filter((n) => Boolean(n.data('isRoot')))
    const layout = cy.layout(
      mode === 'orchestration'
        ? {
            name: 'breadthfirst',
            directed: true,
            padding: 24,
            spacingFactor: 1.1,
            animate: !reduceMotion,
            animationDuration: 250,
            ...(roots.length > 0 ? { roots } : {}),
          }
        : {
            name: 'grid',
            rows: 1,
            padding: 24,
            avoidOverlap: true,
            avoidOverlapPadding: 24,
            condense: false,
            animate: !reduceMotion,
            animationDuration: 250,
          },
    )
    layout.run()
    cy.fit(undefined, 24)
  }, [elements, topology, mode, reduceMotion, cyEpoch])

  // Marching dashes on the live path — pure decoration, so it is skipped
  // entirely under reduced motion and whenever nothing is running.
  useEffect(() => {
    if (reduceMotion || mode !== 'orchestration' || !hasRunningNode) return
    const timer = setInterval(() => {
      const cy = cyRef.current
      if (!cy) return
      const active = cy.edges('.active-path')
      if (active.empty()) return
      const current = Number(active.first().style('line-dash-offset')) || 0
      active.style('line-dash-offset', (current - 2) % 20)
    }, 90)
    return () => clearInterval(timer)
  }, [reduceMotion, mode, hasRunningNode])

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-2">
      <div className="flex items-center gap-2">
        <Tabs value={mode} onValueChange={(value) => setMode(value as GraphMode)}>
          <TabsList className="h-6 self-start">
            <TabsTrigger value="orchestration" className="text-[10px] px-2 py-0.5">
              {t('board.graph.mode.orchestration')}
            </TabsTrigger>
            <TabsTrigger value="stageFlow" className="text-[10px] px-2 py-0.5">
              {t('board.graph.mode.stageFlow')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === 'orchestration' && runs.length > 1 && (
          <select
            value={selectedRunId ?? ''}
            onChange={(e) => setSelectedRunId(e.target.value || null)}
            aria-label={t('board.graph.run.selectorLabel')}
            title={t('board.graph.run.selectorLabel')}
            className="h-6 px-1.5 text-[10px] bg-transparent border border-border/40 rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {runs.map((run) => (
              <option key={run.runId} value={run.runId}>
                {`#${shortRunId(run.runId)} · ${t(`board.graph.run.status.${run.status}`)}`}
              </option>
            ))}
          </select>
        )}
      </div>

      {isEmpty ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-[11px]">
          {mode === 'orchestration' ? t('board.empty.graph') : t('board.empty.dashboard')}
        </div>
      ) : (
        <div
          ref={containerRef}
          className="flex-1 min-h-0 rounded-lg border border-border bg-card/40"
        />
      )}
    </div>
  )
}
