import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape'
import { api } from '@/lib/api'
import { t } from './i18n'
import { Button } from '@/components/ui/button'
import {
  Focus,
  Maximize2,
  Search,
  Link2,
  Tags,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  RefreshCw,
} from 'lucide-react'

interface GraphNode {
  id: string
  label: string
  tier: string
  tags: string[]
  degree?: number
  topic?: string
}
interface GraphEdge {
  source: string
  target: string
  context: string | null
  resolved?: boolean
  kind?: 'wikilink' | 'tag' | 'topic'
  weight?: number
}
interface GraphStats {
  nodeCount: number
  edgeCount: number
  wikilinkCount: number
  tagEdgeCount: number
  topicEdgeCount?: number
  orphanCount: number
}
interface GraphPayload {
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats?: GraphStats
}

const TIER_COLORS: Record<string, string> = {
  semantic: '#3b82f6',
  procedural: '#f59e0b',
  unknown: '#6b7280',
}

interface MemoryGraphViewProps {
  onOpenNote?: (path: string) => void
}

export default function MemoryGraphView({ onOpenNote }: MemoryGraphViewProps = {}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cyRef = useRef<Core | null>(null)
  const selectedRef = useRef<GraphNode | null>(null)
  const [data, setData] = useState<GraphPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [filterTier, setFilterTier] = useState<'all' | 'semantic' | 'procedural'>('all')
  const [filterTag, setFilterTag] = useState('')
  const [query, setQuery] = useState('')
  /** Soft edges = tag + topic co-occurrence */
  const [showSoftEdges, setShowSoftEdges] = useState(true)
  /** Orphans off by default — Obsidian-like focus on the connected web */
  const [showOrphans, setShowOrphans] = useState(false)
  const [localMode, setLocalMode] = useState(false)
  const [localDepth, setLocalDepth] = useState(1)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [outgoing, setOutgoing] = useState<GraphEdge[]>([])
  const [incoming, setIncoming] = useState<GraphEdge[]>([])

  selectedRef.current = selected

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const payload = await api.get<GraphPayload>(
        `/memory/wikilinks/graph?includeTags=${showSoftEdges ? '1' : '0'}`,
      )
      setData(payload)
    } catch (err) {
      console.error('Failed to load graph:', err)
    } finally {
      setLoading(false)
    }
  }, [showSoftEdges])

  useEffect(() => {
    void load()
  }, [load])

  const uniqueTags = useMemo(() => {
    if (!data) return []
    return Array.from(new Set(data.nodes.flatMap((n) => n.tags)))
      .filter((tg) => tg && !/^(imported|source:|import-job:)/i.test(tg))
      .sort()
  }, [data])

  const viewModel = useMemo(() => {
    if (!data) return null

    let nodes = data.nodes
      .filter((n) => filterTier === 'all' || n.tier === filterTier)
      .filter((n) => !filterTag || n.tags.includes(filterTag))

    if (query.trim()) {
      const q = query.trim().toLowerCase()
      nodes = nodes.filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          n.id.toLowerCase().includes(q) ||
          (n.topic ?? '').toLowerCase().includes(q) ||
          n.tags.some((tg) => tg.toLowerCase().includes(q)),
      )
    }

    let edges = data.edges.filter((e) => {
      if (!showSoftEdges && (e.kind === 'tag' || e.kind === 'topic')) return false
      return true
    })

    if (localMode && selected) {
      const keep = new Set<string>([selected.id])
      let frontier = new Set([selected.id])
      for (let d = 0; d < localDepth; d++) {
        const next = new Set<string>()
        for (const e of edges) {
          if (frontier.has(e.source) && data.nodes.some((n) => n.id === e.target)) next.add(e.target)
          if (frontier.has(e.target) && data.nodes.some((n) => n.id === e.source)) next.add(e.source)
        }
        for (const id of next) keep.add(id)
        frontier = next
      }
      nodes = data.nodes.filter((n) => keep.has(n.id))
      const ids = new Set(nodes.map((n) => n.id))
      edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
    } else {
      let ids = new Set(nodes.map((n) => n.id))
      edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target))

      if (!showOrphans) {
        const connected = new Set<string>()
        for (const e of edges) {
          connected.add(e.source)
          connected.add(e.target)
        }
        nodes = nodes.filter((n) => connected.has(n.id))
        ids = new Set(nodes.map((n) => n.id))
        edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
      }
    }

    return { nodes, edges }
  }, [data, filterTier, filterTag, query, showSoftEdges, showOrphans, localMode, selected, localDepth])

  useEffect(() => {
    if (!viewModel || !containerRef.current || !data) return

    const { nodes, edges } = viewModel
    if (nodes.length === 0) {
      if (cyRef.current) {
        cyRef.current.destroy()
        cyRef.current = null
      }
      return
    }

    const maxDeg = Math.max(1, ...nodes.map((n) => n.degree ?? 0))

    const elements: ElementDefinition[] = [
      ...nodes.map((n) => {
        const deg = n.degree ?? 0
        const size = 8 + Math.round(Math.sqrt(deg + 1) * 5)
        return {
          data: {
            id: n.id,
            label: n.label.length > 28 ? `${n.label.slice(0, 26)}…` : n.label,
            fullLabel: n.label,
            tier: n.tier,
            topic: n.topic ?? '',
            degree: deg,
            size: Math.min(36, size),
          },
          group: 'nodes' as const,
        }
      }),
      ...edges.map((e, idx) => ({
        data: {
          id: `e${idx}`,
          source: e.source,
          target: e.target,
          kind: e.kind ?? 'wikilink',
          weight: e.weight ?? 1,
        },
        group: 'edges' as const,
      })),
    ]

    if (cyRef.current) {
      cyRef.current.destroy()
      cyRef.current = null
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      minZoom: 0.2,
      maxZoom: 3.5,
      wheelSensitivity: 0.2,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (ele: any) =>
              TIER_COLORS[ele.data('tier')] ?? TIER_COLORS.unknown,
            // Labels only when zoomed in or highlighted — avoids the wall of garbled text
            label: 'data(label)',
            'text-opacity': 0,
            color: '#e5e7eb',
            'font-size': '10px',
            'font-family': 'ui-sans-serif, system-ui, sans-serif',
            'text-outline-color': '#0f172a',
            'text-outline-width': 2,
            'text-margin-y': -8,
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-max-width': '100px',
            'text-wrap': 'ellipsis',
            width: 'data(size)',
            height: 'data(size)',
            'border-width': 1,
            'border-color': 'rgba(255,255,255,0.15)',
            'overlay-opacity': 0,
          } as any,
        },
        {
          selector: 'node.labeled',
          style: { 'text-opacity': 1 } as any,
        },
        {
          selector: 'node:selected',
          style: {
            'border-color': '#f8fafc',
            'border-width': 3,
            'background-color': '#a78bfa',
            'text-opacity': 1,
            'z-index': 999,
          } as any,
        },
        {
          selector: 'node.faded',
          style: { opacity: 0.08, 'text-opacity': 0 } as any,
        },
        {
          selector: 'node.highlighted',
          style: {
            'border-color': '#e2e8f0',
            'border-width': 2,
            'text-opacity': 1,
            'z-index': 998,
            opacity: 1,
          } as any,
        },
        {
          selector: 'edge',
          style: {
            width: (ele: any) => {
              const k = ele.data('kind')
              if (k === 'wikilink') return 1.8
              if (k === 'tag') return 1.1
              return 0.9
            },
            'line-color': (ele: any) => {
              const k = ele.data('kind')
              if (k === 'wikilink') return '#94a3b8'
              if (k === 'tag') return '#64748b88'
              return '#47556966'
            },
            'curve-style': 'haystack',
            'haystack-radius': 0.5,
            'target-arrow-shape': 'none',
            opacity: 0.85,
          } as any,
        },
        {
          selector: 'edge[kind = "wikilink"]',
          style: {
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': '#94a3b8',
            'arrow-scale': 0.65,
          } as any,
        },
        {
          selector: 'edge.faded',
          style: { opacity: 0.03 } as any,
        },
        {
          selector: 'edge.highlighted',
          style: {
            opacity: 1,
            'line-color': '#c4b5fd',
            'target-arrow-color': '#c4b5fd',
            width: 2.2,
            'z-index': 999,
          } as any,
        },
      ],
      layout: {
        name: 'cose',
        animate: false,
        randomize: true,
        // Stronger clustering for multi-component graphs (topic islands)
        nodeRepulsion: () => 18_000,
        idealEdgeLength: () => 55,
        edgeElasticity: () => 40,
        nestingFactor: 1.2,
        gravity: 0.85,
        numIter: 1200,
        initialTemp: 400,
        coolingFactor: 0.92,
        minTemp: 1.0,
        fit: true,
        padding: 48,
        componentSpacing: 80,
      } as any,
    })

    cyRef.current = cy

    const updateLabelVisibility = () => {
      const z = cy.zoom()
      cy.nodes().forEach((node) => {
        const show =
          z >= 1.15 ||
          node.selected() ||
          node.hasClass('highlighted') ||
          (node.data('degree') as number) >= 8
        node.toggleClass('labeled', show)
      })
    }

    const highlightNeighborhood = (nodeId: string | null) => {
      cy.elements().removeClass('highlighted faded')
      if (!nodeId) {
        updateLabelVisibility()
        return
      }
      const node = cy.getElementById(nodeId)
      if (!node || node.empty()) return
      const neighborhood = node.closedNeighborhood()
      cy.elements().addClass('faded')
      neighborhood.removeClass('faded').addClass('highlighted')
      updateLabelVisibility()
    }

    cy.on('zoom pan', updateLabelVisibility)
    updateLabelVisibility()

    cy.on('tap', 'node', (evt) => {
      const id = evt.target.data('id') as string
      const node = data.nodes.find((n) => n.id === id) ?? null
      setSelected(node)
      setOutgoing(data.edges.filter((e) => e.source === id))
      setIncoming(data.edges.filter((e) => e.target === id))
      highlightNeighborhood(id)
    })

    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        setSelected(null)
        setOutgoing([])
        setIncoming([])
        cy.elements().removeClass('highlighted faded')
        updateLabelVisibility()
      }
    })

    cy.on('dbltap', 'node', (evt) => {
      const id = evt.target.data('id') as string
      if (onOpenNote && String(id).endsWith('.md')) onOpenNote(id)
    })

    cy.on('mouseover', 'node', (evt) => {
      if (selectedRef.current) return
      highlightNeighborhood(evt.target.data('id') as string)
    })
    cy.on('mouseout', 'node', () => {
      if (selectedRef.current) return
      cy.elements().removeClass('highlighted faded')
      updateLabelVisibility()
    })

    if (selected) {
      const el = cy.getElementById(selected.id)
      if (!el.empty()) {
        el.select()
        highlightNeighborhood(selected.id)
      }
    }

    // Second pass fit after layout settles
    requestAnimationFrame(() => {
      try {
        cy.fit(undefined, 40)
        updateLabelVisibility()
      } catch { /* empty graph */ }
    })

    return () => {
      cy.destroy()
      cyRef.current = null
    }
  }, [viewModel, data, onOpenNote])

  const fit = () => cyRef.current?.fit(undefined, 40)
  const zoomIn = () => {
    const cy = cyRef.current
    if (!cy) return
    cy.zoom({
      level: cy.zoom() * 1.3,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    })
  }
  const zoomOut = () => {
    const cy = cyRef.current
    if (!cy) return
    cy.zoom({
      level: cy.zoom() / 1.3,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    })
  }

  const stats = data?.stats
  const visibleNodes = viewModel?.nodes.length ?? 0
  const visibleEdges = viewModel?.edges.length ?? 0

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-[560px] p-4 gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl font-semibold">{t('memory.graph.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('memory.graph.subtitle')}</p>
          {stats && (
            <p className="text-[11px] text-muted-foreground mt-1 font-mono">
              {t('memory.graph.stats', {
                nodes: stats.nodeCount,
                edges: stats.edgeCount,
                wikilinks: stats.wikilinkCount,
                tags: (stats.tagEdgeCount ?? 0) + (stats.topicEdgeCount ?? 0),
                orphans: stats.orphanCount,
              })}
              {viewModel &&
                ` · ${t('memory.graph.visible', {
                  nodes: visibleNodes,
                  edges: visibleEdges,
                })}`}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('memory.graph.searchPlaceholder')}
              className="text-xs pl-7 pr-2 py-1.5 w-44 rounded-md border border-border bg-card"
            />
          </div>
          <select
            value={filterTier}
            onChange={(e) => setFilterTier(e.target.value as any)}
            className="text-xs px-2 py-1.5 rounded-md border border-border bg-card"
          >
            <option value="all">{t('memory.graph.filterTier')}</option>
            <option value="semantic">{t('memory.graph.semantic')}</option>
            <option value="procedural">{t('memory.graph.procedural')}</option>
          </select>
          <select
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-md border border-border bg-card max-w-[140px]"
          >
            <option value="">{t('memory.graph.filterTag')}</option>
            {uniqueTags.map((tg) => (
              <option key={tg} value={tg}>
                #{tg}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => void load()} title="Reload">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
        <Button
          size="sm"
          variant={showSoftEdges ? 'secondary' : 'ghost'}
          className="h-7 text-[11px] gap-1"
          onClick={() => setShowSoftEdges((v) => !v)}
          title={t('memory.graph.tagEdgesHint')}
        >
          <Tags className="h-3 w-3" />
          {t('memory.graph.tagEdges')}
        </Button>
        <Button
          size="sm"
          variant={showOrphans ? 'secondary' : 'ghost'}
          className="h-7 text-[11px] gap-1"
          onClick={() => setShowOrphans((v) => !v)}
        >
          {showOrphans ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          {t('memory.graph.orphans')}
        </Button>
        <Button
          size="sm"
          variant={localMode ? 'secondary' : 'ghost'}
          className="h-7 text-[11px] gap-1"
          disabled={!selected}
          onClick={() => setLocalMode((v) => !v)}
          title={t('memory.graph.localHint')}
        >
          <Focus className="h-3 w-3" />
          {t('memory.graph.local')}
        </Button>
        {localMode && (
          <select
            value={localDepth}
            onChange={(e) => setLocalDepth(Number(e.target.value))}
            className="text-[11px] px-2 py-1 rounded-md border border-border bg-card h-7"
          >
            <option value={1}>{t('memory.graph.depth1')}</option>
            <option value={2}>{t('memory.graph.depth2')}</option>
          </select>
        )}
        <div className="w-px h-5 bg-border mx-1" />
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={zoomOut}>
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={zoomIn}>
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1" onClick={fit}>
          <Maximize2 className="h-3 w-3" />
          {t('memory.graph.fit')}
        </Button>
        <div className="flex-1" />
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: TIER_COLORS.semantic }} />
            {t('memory.graph.semantic')}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: TIER_COLORS.procedural }} />
            {t('memory.graph.procedural')}
          </span>
          <span className="inline-flex items-center gap-1">
            <Link2 className="h-3 w-3" />
            {t('memory.graph.legendWikilink')}
          </span>
          <span className="inline-flex items-center gap-1 opacity-70">
            <Tags className="h-3 w-3" />
            {t('memory.graph.legendTag')}
          </span>
        </div>
      </div>

      {loading && !data && (
        <p className="text-sm text-muted-foreground">{t('memory.graph.loading')}</p>
      )}
      {data && data.nodes.length === 0 && (
        <p className="text-sm text-muted-foreground italic">{t('memory.graph.empty')}</p>
      )}
      {viewModel && viewModel.nodes.length === 0 && data && data.nodes.length > 0 && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          {t('memory.graph.noVisible')}
        </p>
      )}

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-3 min-h-0">
        <div
          ref={containerRef}
          className="lg:col-span-3 rounded-xl border border-border overflow-hidden relative min-h-[400px]"
          style={{
            // Dark canvas like Obsidian graph (works in light UI too)
            backgroundColor: '#0b1220',
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(148,163,184,0.12) 1px, transparent 0)',
            backgroundSize: '20px 20px',
          }}
        />
        <div className="lg:col-span-1 rounded-xl border border-border bg-card p-4 overflow-y-auto min-h-[200px]">
          {!selected ? (
            <div className="space-y-3 text-xs text-muted-foreground">
              <p className="italic">{t('memory.graph.selectNode')}</p>
              <p>{t('memory.graph.help')}</p>
              {stats && stats.wikilinkCount < 20 && (
                <p className="text-amber-600 dark:text-amber-400/90 leading-relaxed">
                  {t('memory.graph.sparseHint')}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="text-sm font-medium mb-1 break-words">{selected.label}</div>
              <div className="text-[10px] text-muted-foreground font-mono mb-1 break-all">
                {selected.id}
              </div>
              {selected.topic && (
                <div className="text-[10px] text-violet-400 font-mono mb-3">{selected.topic}</div>
              )}

              {onOpenNote && selected.id.endsWith('.md') && (
                <button
                  type="button"
                  onClick={() => onOpenNote(selected.id)}
                  className="text-[11px] mb-3 px-3 py-1.5 rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors w-full text-left"
                >
                  {t('memory.graph.openInVault')}
                </button>
              )}

              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                {t('memory.graph.tier')}
              </div>
              <div className="text-xs mb-3 flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: TIER_COLORS[selected.tier] ?? TIER_COLORS.unknown }}
                />
                {selected.tier}
                <span className="text-muted-foreground">
                  · {t('memory.graph.degree', { count: selected.degree ?? 0 })}
                </span>
              </div>

              {selected.tags.filter((tg) => !/^(imported|source:|import-job:)/i.test(tg)).length >
                0 && (
                <>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    {t('memory.graph.tags')}
                  </div>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {selected.tags
                      .filter((tg) => !/^(imported|source:|import-job:)/i.test(tg))
                      .map((tg) => (
                        <button
                          key={tg}
                          type="button"
                          onClick={() => setFilterTag(tg)}
                          className="text-[10px] bg-accent px-2 py-0.5 rounded hover:bg-accent/80"
                        >
                          #{tg}
                        </button>
                      ))}
                  </div>
                </>
              )}

              {outgoing.length > 0 && (
                <>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    {t('memory.graph.outgoing', { count: outgoing.length })}
                  </div>
                  <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
                    {outgoing.slice(0, 40).map((e, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          const node = data?.nodes.find((n) => n.id === e.target)
                          if (node) {
                            setSelected(node)
                            const el = cyRef.current?.getElementById(node.id)
                            if (el && !el.empty()) {
                              el.select()
                              cyRef.current?.animate({ center: { eles: el }, duration: 250 })
                            }
                          }
                        }}
                        className="block w-full text-left text-[10px] font-mono text-blue-400 hover:text-blue-300 truncate"
                      >
                        →{' '}
                        {e.kind === 'wikilink'
                          ? e.target.split('/').pop()
                          : e.context ?? e.target.split('/').pop()}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {incoming.length > 0 && (
                <>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    {t('memory.graph.backlinks', { count: incoming.length })}
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {incoming.slice(0, 40).map((e, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          const node = data?.nodes.find((n) => n.id === e.source)
                          if (node) {
                            setSelected(node)
                            const el = cyRef.current?.getElementById(node.id)
                            if (el && !el.empty()) {
                              el.select()
                              cyRef.current?.animate({ center: { eles: el }, duration: 250 })
                            }
                          }
                        }}
                        className="block w-full text-left text-[10px] font-mono text-muted-foreground hover:text-foreground truncate"
                      >
                        ← {e.source.split('/').pop()}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {outgoing.length === 0 && incoming.length === 0 && (
                <p className="text-[11px] text-muted-foreground italic">
                  {t('memory.graph.noLinks')}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
