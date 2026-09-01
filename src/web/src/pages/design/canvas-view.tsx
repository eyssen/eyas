import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Minus, Plus, Maximize2, X, Expand } from 'lucide-react'
import { ArtboardFrame } from './artboard-frame'
import type { Design, DcSelection } from './types'
import { t } from './i18n'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 2
/** Fallback grid when canvas.json places nothing. */
const FALLBACK_W = 800
const FALLBACK_H = 600
const FALLBACK_GAP = 120
/** The title strip sits above each frame and has to be inside the fit box. */
const TITLE_STRIP = 22
const FIT_PADDING = 48
/** A drag longer than this is a pan, not a click. */
const CLICK_SLOP = 4

interface View {
  zoom: number
  x: number
  y: number
}

interface Placed {
  file: string
  title: string
  page: string | null
  interactive: boolean
  expand: 'fit' | 'fill'
  x: number
  y: number
  w: number
  h: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * The pan/zoom canvas. Hand-built: react-grid-layout is a 12-column grid, not
 * free-form artboards, and the Cytoscape instances in this app are graph-only.
 *
 * Two notes on the input handling.
 *
 * The wheel listener is attached natively with `passive: false`. React routes
 * `onWheel` through a passive root listener, where `preventDefault()` is
 * ignored — and without it Ctrl+wheel zooms the browser instead of the canvas.
 *
 * Wheel and drag only reach us OUTSIDE the frames: an artboard is a sandboxed
 * iframe and swallows both. That is why nothing covers the frames — an overlay
 * would make the whole surface pannable but would also silence every
 * `is_interactive` prototype until you clicked into it. Panning by dragging the
 * gaps works, so the trade is not worth making. Opening an artboard is a
 * deliberate control on its title row instead of a gesture over the frame.
 */
export function CanvasView({
  design,
  version,
  selectedFile,
  onSelectFile,
  page,
  editing = false,
  onSelectElement,
  onSource,
  onFrameReady,
}: {
  design: Design
  version: number
  selectedFile: string | null
  onSelectFile: (file: string) => void
  page: string | null
  /** Only the selected artboard enters edit mode; the rest stay interactive. */
  editing?: boolean
  onSelectElement?: (selection: DcSelection | null) => void
  onSource?: (body: string) => void
  onFrameReady?: (send: ((message: unknown) => void) | null) => void
}) {
  const [view, setView] = useState<View>({ zoom: 0.6, x: 40, y: 40 })
  const [focused, setFocused] = useState<string | null>(null)
  const [fillSize, setFillSize] = useState<{ w: number; h: number } | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null)
  const restoreRef = useRef<View | null>(null)

  const placed = useMemo<Placed[]>(() => {
    const entries = design.manifest.artboards ?? []
    return design.artboards.map((file, index) => {
      const entry = entries.find((a) => a.file === file)
      return {
        file,
        title: entry?.title ?? file,
        page: entry?.page ?? null,
        // An artboard marked interactive keeps its own click handlers once you
        // are inside it — the point of the flag is that the prototype works.
        interactive: entry?.is_interactive === true,
        expand: entry?.expand === 'fill' ? 'fill' : 'fit',
        x: entry?.x ?? index * (FALLBACK_W + FALLBACK_GAP),
        y: entry?.y ?? 0,
        w: entry?.w ?? FALLBACK_W,
        h: entry?.h ?? FALLBACK_H,
      }
    }).filter((a) => !page || a.page === page || (a.page === null && page === (design.manifest.pages?.[0]?.id ?? null)))
  }, [design, page])

  const annotations = useMemo(
    () => (design.manifest.annotations ?? []).filter((n) => !page || (n.page ?? design.manifest.pages?.[0]?.id ?? null) === page),
    [design, page],
  )

  /** Everything on this page, in canvas coordinates. */
  const bounds = useMemo(() => {
    const boxes = [
      ...placed.map((a) => ({ x: a.x, y: a.y - TITLE_STRIP, w: a.w, h: a.h + TITLE_STRIP })),
      ...annotations.map((n) => ({ x: n.x, y: n.y, w: n.w, h: 120 })),
    ]
    if (boxes.length === 0) return null
    return {
      minX: Math.min(...boxes.map((b) => b.x)),
      minY: Math.min(...boxes.map((b) => b.y)),
      maxX: Math.max(...boxes.map((b) => b.x + b.w)),
      maxY: Math.max(...boxes.map((b) => b.y + b.h)),
    }
  }, [placed, annotations])

  const viewFitting = useCallback((box: { minX: number; minY: number; maxX: number; maxY: number }): View => {
    const el = viewportRef.current
    const vw = (el?.clientWidth ?? 900) - FIT_PADDING * 2
    const vh = (el?.clientHeight ?? 600) - FIT_PADDING * 2
    const zoom = clamp(Math.min(vw / (box.maxX - box.minX), vh / (box.maxY - box.minY)), MIN_ZOOM, MAX_ZOOM)
    return {
      zoom,
      x: FIT_PADDING - box.minX * zoom + Math.max(0, (vw - (box.maxX - box.minX) * zoom) / 2),
      y: FIT_PADDING - box.minY * zoom + Math.max(0, (vh - (box.maxY - box.minY) * zoom) / 2),
    }
  }, [])

  const fitAll = useCallback(() => {
    if (bounds) setView(viewFitting(bounds))
    else setView({ zoom: 0.6, x: 40, y: 40 })
  }, [bounds, viewFitting])

  const exitFocus = useCallback(() => {
    if (restoreRef.current) setView(restoreRef.current)
    restoreRef.current = null
    setFocused(null)
    setFillSize(null)
  }, [])

  /**
   * Open one artboard on its own. `expand: 'fit'` shrinks the whole thing to
   * the viewport; `expand: 'fill'` widens the frame to the viewport at natural
   * scale and lets it scroll, which is what a fluid-width design wants.
   */
  const focusOn = useCallback((a: Placed) => {
    if (!restoreRef.current) restoreRef.current = view
    if (a.expand === 'fill') {
      const el = viewportRef.current
      const w = Math.max(320, (el?.clientWidth ?? 900) - FIT_PADDING * 2)
      const h = Math.max(a.h, (el?.clientHeight ?? 600) - FIT_PADDING * 2)
      setFillSize({ w, h })
      setView({ zoom: 1, x: FIT_PADDING - a.x, y: FIT_PADDING - a.y })
    } else {
      setFillSize(null)
      setView(viewFitting({ minX: a.x, minY: a.y - TITLE_STRIP, maxX: a.x + a.w, maxY: a.y + a.h }))
    }
    setFocused(a.file)
    onSelectFile(a.file)
  }, [view, viewFitting, onSelectFile])

  // Non-passive, because React's own onWheel cannot preventDefault.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      setView((v) => {
        if (e.ctrlKey || e.metaKey) {
          // Anchor the zoom on the pointer, so the thing under the cursor stays
          // under the cursor. Zooming around the origin makes a large canvas
          // impossible to navigate.
          const rect = el.getBoundingClientRect()
          const cx = e.clientX - rect.left
          const cy = e.clientY - rect.top
          const zoom = clamp(v.zoom * Math.exp(-e.deltaY * 0.0025), MIN_ZOOM, MAX_ZOOM)
          const k = zoom / v.zoom
          return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }
        }
        // Shift turns a vertical-only wheel into horizontal panning.
        const dx = e.shiftKey ? e.deltaY : e.deltaX
        const dy = e.shiftKey ? 0 : e.deltaY
        return { ...v, x: v.x - dx, y: v.y - dy }
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  useEffect(() => {
    if (!focused) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exitFocus() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused, exitFocus])

  const startPan = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragRef.current = { x: e.clientX, y: e.clientY, panX: view.x, panY: view.y, moved: false }
  }
  const movePan = (e: React.MouseEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > CLICK_SLOP) d.moved = true
    if (d.moved) setView((v) => ({ ...v, x: d.panX + dx, y: d.panY + dy }))
  }
  const endPan = () => { dragRef.current = null }
  /** A drag that moved is a pan; the click it ends with must not also select. */
  const dragged = () => dragRef.current?.moved === true

  return (
    <div className="relative h-full w-full overflow-hidden bg-muted/30">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 glass-card px-2 py-1">
        {focused && (
          <Button size="sm" variant="ghost" onClick={exitFocus} className="gap-1">
            <X className="h-3.5 w-3.5" />
            <span className="text-xs">{t('design.canvas.exitFocus')}</span>
          </Button>
        )}
        <Button size="sm" variant="ghost" aria-label={t('design.canvas.zoomOut')} onClick={() => setView((v) => ({ ...v, zoom: Math.max(MIN_ZOOM, v.zoom - 0.1) }))}>
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs tabular-nums w-10 text-center">{Math.round(view.zoom * 100)}%</span>
        <Button size="sm" variant="ghost" aria-label={t('design.canvas.zoomIn')} onClick={() => setView((v) => ({ ...v, zoom: Math.min(MAX_ZOOM, v.zoom + 0.1) }))}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" aria-label={t('design.canvas.fit')} onClick={() => { restoreRef.current = null; setFocused(null); setFillSize(null); fitAll() }}>
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {!focused && placed.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-md bg-[hsl(var(--muted))]/80 px-2 py-1 text-[11px] text-muted-foreground">
          {t('design.canvas.navHint')}
        </div>
      )}

      <div
        ref={viewportRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        onMouseDown={startPan}
        onMouseMove={movePan}
        onMouseUp={endPan}
        onMouseLeave={endPan}
      >
        <div style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: '0 0' }}>
          {annotations.map((note) => (
            <div
              key={note.id}
              className="absolute rounded-md bg-[hsl(var(--muted))] p-3 text-xs whitespace-pre-line shadow-sm"
              style={{ left: note.x, top: note.y, width: note.w }}
            >
              {note.text}
            </div>
          ))}

          {placed.map((a) => {
            // `fill` only widens the frame while that artboard is the focused one.
            const opened = focused === a.file && fillSize !== null
            const w = opened ? fillSize!.w : a.w
            const h = opened ? fillSize!.h : a.h
            return (
              <div key={a.file} data-artboard className="absolute" style={{ left: a.x, top: a.y }}>
                <div className="mb-1.5 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => { if (!dragged()) onSelectFile(a.file) }}
                    onDoubleClick={() => focusOn(a)}
                    className={`text-xs ${selectedFile === a.file ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {a.title}
                    {a.interactive && <span className="ml-1 opacity-60">{t('design.canvas.interactive')}</span>}
                  </button>
                  {/* A visible control, not just a double-click: a gesture on a
                      title strip is not something anyone finds by accident. */}
                  <button
                    type="button"
                    aria-label={t('design.canvas.openArtboard')}
                    title={t('design.canvas.openArtboard')}
                    onClick={() => focusOn(a)}
                    className="rounded p-0.5 text-muted-foreground opacity-60 hover:opacity-100 hover:text-foreground"
                  >
                    <Expand className="h-3 w-3" />
                  </button>
                </div>
                <div className={`relative ${selectedFile === a.file ? 'ring-2 ring-[hsl(var(--primary))]' : ''}`}>
                  <ArtboardFrame
                    designId={design.id}
                    file={a.file}
                    width={w}
                    height={h}
                    version={version}
                    mode={editing && selectedFile === a.file && !a.interactive ? 'edit' : 'interact'}
                    {...(selectedFile === a.file
                      ? { onSelect: onSelectElement, onSource, onReady: onFrameReady }
                      : {})}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {placed.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {t('design.canvas.empty')}
        </div>
      )}
    </div>
  )
}
