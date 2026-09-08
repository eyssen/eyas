// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The drag-and-drop landing-page grid, mounted at `/` (see routes/index.tsx).
//
// react-grid-layout@2.2.4 is a hooks-based rewrite, not the v1 API most docs
// describe: there is no `WidthProvider` HOC (replaced by `useContainerWidth`)
// and no `isDraggable`/`isResizable`/`draggableHandle` props (replaced by
// `dragConfig`/`resizeConfig` objects). `width` is a required prop even on
// the "Responsive" variant.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ResponsiveGridLayout, useContainerWidth, type Layout } from 'react-grid-layout'
// Mandatory: react-grid-layout ships the drag placeholder, the resize handle
// and the drag transform as CSS, not inline styles. jsdom ignores stylesheets
// entirely, so every test here passes with or without these imports — only a
// real browser shows the difference. Imported here (the grid-owning
// component), not in globals.css, so pages without a grid never pay for them.
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
// Overrides the two hardcoded colours in the stylesheets above (drag
// placeholder, resize-handle corner) with project tokens — must be imported
// after them so the cascade (equal specificity, later wins) applies. See
// home-grid.css for exactly which declarations and why.
import './home-grid.css'
import { Pencil, Check, RotateCcw } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { WidgetFrame } from './widget-frame'
import { WidgetBoundary } from './widget-boundary'
import { WidgetDrawer, type CatalogueEntry } from './widget-drawer'
import { WIDGETS } from './widget-registry'
import SetupRecommendationsCard from './setup-recommendations-card'
import { t, tOr } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

type Breakpoint = 'lg' | 'md' | 'sm'

// The server only ever stores/accepts these three breakpoint keys
// (home/layout-schema.ts's breakpointSchema) — the grid must never resolve
// to react-grid-layout's own default 'xs'/'xxs', or a request built from that
// breakpoint would 400. Passing a matching `breakpoints` map below (with
// `sm` as the floor, min-width 0) guarantees `sm` is always the narrowest
// resolvable breakpoint.
const BREAKPOINTS: Record<Breakpoint, number> = { lg: 1200, md: 996, sm: 0 }
const COLS: Record<Breakpoint, number> = { lg: 12, md: 8, sm: 4 }
const FALLBACK_SIZE = { w: 4, h: 5 }
const SAVE_DEBOUNCE_MS = 800

interface HomeLayoutItem {
  i: string
  x: number
  y: number
  w: number
  h: number
  config?: Record<string, unknown>
}

interface HomeLayoutResponse {
  items: HomeLayoutItem[]
  source: 'factory' | 'custom'
  newWidgets: string[]
}

interface WidgetsResponse {
  widgets: CatalogueEntry[]
}

/** Lowest unused `#n` instance suffix for `widgetId` across `existing`. */
function nextInstance(widgetId: string, existing: HomeLayoutItem[]): number {
  const used = new Set(
    existing.filter((it) => it.i.startsWith(`${widgetId}#`)).map((it) => Number(it.i.split('#')[1])),
  )
  let n = 1
  while (used.has(n)) n += 1
  return n
}

/** Where a newly-added tile lands: left-aligned, below everything else. */
function bottomOf(items: HomeLayoutItem[]): number {
  return items.reduce((max, it) => Math.max(max, it.y + it.h), 0)
}

export default function HomePage() {
  const { width, containerRef } = useContainerWidth()
  const [items, setItems] = useState<HomeLayoutItem[]>([])
  const [catalogue, setCatalogue] = useState<CatalogueEntry[]>([])
  const [newWidgets, setNewWidgets] = useState<string[]>([])
  const [editing, setEditing] = useState(false)

  // Kept in a ref alongside state: PUT/DELETE/POST calls read the LATEST
  // breakpoint from callbacks (debounced save, reset, dismiss) that must not
  // re-subscribe every time the breakpoint changes.
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('lg')
  const breakpointRef = useRef<Breakpoint>('lg')

  // Which breakpoint's STORED ROW `items` currently holds — `null` from the
  // moment a row is asked for until its response lands. This is the whole
  // safety property of the page: `items` is a picture of exactly one server
  // row, and every write path (below) refuses to run while that is not true.
  //
  // Without it, react-grid-layout's own behaviour on a width change crossing a
  // breakpoint silently corrupts stored rows. `layouts` only ever carries one
  // key (`{[breakpoint]: items}` below), so the library finds no entry for the
  // new breakpoint and GENERATES one from the old one's items
  // (findOrGenerateResponsiveLayout -> correctBounds to the new column count +
  // compact), then reports it through `onLayoutChange`. Persisting THAT writes
  // an lg-derived row into the md/sm slot: it creates a row for a user who
  // never customised anything there (so future factory widgets stop reaching
  // them — the exact cost the factory-default fallback exists to prevent), it
  // overwrites a genuinely customised row the page never read, and on the way
  // back to lg it flattens the desktop arrangement into the narrow one.
  const loadedBpRef = useRef<Breakpoint | null>(null)
  // Request token. A resize can cross two breakpoints faster than one round
  // trip (lg -> md -> sm), and the abandoned response must never land: only
  // the newest load may apply, everything older is dropped on arrival.
  const loadSeqRef = useRef(0)
  // The FACTORY items exactly as the server handed them over, while `items`
  // still is that array — `null` as soon as anything else touches the layout.
  //
  // It exists for one report: the grid's own first rendering of a factory row
  // at a narrow breakpoint. `DEFAULT_LAYOUT` (default-layout.ts) is a
  // 12-column arrangement served for every breakpoint, so at `md`/`sm` the
  // library re-fits it (correctBounds to 8/4 columns, then compaction) and
  // reports the result through `onLayoutChange` — visibly different (w:12 ->
  // w:4) with no input from anyone. Persisting THAT would CREATE a stored row
  // for someone who never customised anything, and once a row exists at a
  // breakpoint later factory widgets stop being offered there — the exact
  // cost the factory-default fallback exists to prevent.
  //
  // Deliberately narrow, so it can never swallow a real edit:
  //  - only a `source: 'factory'` response arms it (a stored row already
  //    exists, so re-saving its re-fit costs nothing and is left alone);
  //  - only while `items` IS that same array, which stops being true the
  //    moment any handler below replaces it, and also the moment the grid's
  //    own re-fit report replaces it;
  //  - and a drag or resize clears it up front (handleGestureStart), so the
  //    first report of a gesture is never mistaken for a re-fit.
  const adoptedFactoryRef = useRef<HomeLayoutItem[] | null>(null)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  const loadLayout = useCallback((bp: Breakpoint) => {
    const seq = (loadSeqRef.current += 1)
    // Synchronous, before the request is even issued: from here until the
    // response lands, `items` is not this breakpoint's row, and nothing may
    // be written. See handleBreakpointChange for why the ordering matters.
    loadedBpRef.current = null
    void api.get<HomeLayoutResponse>(`/home/layout?breakpoint=${bp}`).then((res) => {
      if (seq !== loadSeqRef.current) return
      adoptedFactoryRef.current = res.source === 'factory' ? res.items : null
      setItems(res.items)
      setNewWidgets(res.newWidgets)
      loadedBpRef.current = bp
    })
  }, [])

  // First load, at whatever breakpoint the container's initial
  // (pre-measurement) width resolves to — `useContainerWidth`'s default
  // (1280px) is above the `lg` floor, so this is 'lg' on first paint. It is
  // very often NOT the breakpoint the page settles at: the moment the
  // container is measured, any grid narrower than 1200px switches, and
  // handleBreakpointChange loads that row instead.
  useEffect(() => {
    loadLayout(breakpointRef.current)
    void api.get<WidgetsResponse>('/home/widgets').then((res) => setCatalogue(res.widgets))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persist = useCallback((nextItems: HomeLayoutItem[], bp: Breakpoint) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const payload = nextItems.map(({ i, x, y, w, h, config }) => ({
        i, x, y, w, h,
        ...(config !== undefined && { config }),
      }))
      void api.put('/home/layout', { breakpoint: bp, items: payload })
    }, SAVE_DEBOUNCE_MS)
  }, [])

  /**
   * The single gate every write goes through. `items` only ever describes the
   * row named by `loadedBpRef`, so a save is only ever legitimate while that
   * row is also the one we would be writing to; at any other moment (a
   * breakpoint switch whose row has not arrived yet) the items on screen came
   * from a different row, and saving them would overwrite the wrong one.
   *
   * This cannot be intermittent, and that is deliberate rather than lucky.
   * The dangerous callback is `onLayoutChange` carrying the library's
   * generated layout, and the library emits it strictly AFTER
   * `onBreakpointChange` (dist/chunk-BMN6M2VL.js:396-431: the width effect
   * calls `onBreakpointChange` inline, while the layouts-changed effect can
   * only run on the following render). `handleBreakpointChange` clears
   * `loadedBpRef` synchronously, with no await between the two statements, so
   * the gate is already shut before control returns to the library — there is
   * no window for the two to interleave, whatever the network does.
   */
  const persistLoaded = useCallback((nextItems: HomeLayoutItem[]) => {
    const bp = loadedBpRef.current
    if (bp === null || bp !== breakpointRef.current) return
    persist(nextItems, bp)
  }, [persist])

  const handleLayoutChange = useCallback((layout: Layout) => {
    setItems((prev) => {
      const prevById = new Map(prev.map((it) => [it.i, it]))
      const next = layout.map((li) => ({
        i: li.i, x: li.x, y: li.y, w: li.w, h: li.h,
        ...(prevById.get(li.i)?.config !== undefined && { config: prevById.get(li.i)!.config }),
      }))
      // react-grid-layout fires onLayoutChange on mount and on every
      // breakpoint switch to hand back its normalised/compacted layout, not
      // only after a real drag or resize. Comparing against the previous
      // state (id, position, size — never `config`, which the grid doesn't
      // know about) keeps that mount-time call from scheduling a save with
      // nothing actually different to persist.
      const unchanged = next.length === prev.length && next.every((it) => {
        const p = prevById.get(it.i)
        return p !== undefined && p.x === it.x && p.y === it.y && p.w === it.w && p.h === it.h
      })
      // A pure read, never a write: StrictMode (main.tsx) invokes state
      // updaters twice in development, so mutating a ref in here would let the
      // throwaway first pass consume it.
      const refittingFactory = prev === adoptedFactoryRef.current
      if (!refittingFactory && !unchanged) persistLoaded(next)
      return next
    })
  }, [persistLoaded])

  /** A person has taken hold of the grid — nothing after this is a re-fit. */
  const handleGestureStart = useCallback(() => {
    adoptedFactoryRef.current = null
  }, [])

  // Runtime breakpoint switches are a real reload, not just a label change:
  // each breakpoint has its OWN stored row, so the page must go and read the
  // one it just moved to. Clearing `loadedBpRef` (inside loadLayout) happens
  // in the same synchronous turn as advancing `breakpointRef`, which is what
  // stops the reload from racing the auto-save it exists to prevent — see
  // persistLoaded.
  const handleBreakpointChange = useCallback((bp: Breakpoint) => {
    if (breakpointRef.current === bp) return
    breakpointRef.current = bp
    setBreakpoint(bp)
    loadLayout(bp)
  }, [loadLayout])

  const handleRemove = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.filter((it) => it.i !== id)
      persistLoaded(next)
      return next
    })
  }, [persistLoaded])

  // A tile's only write path back into its own grid item (WidgetDef.Component's
  // `onConfigChange` — widget-registry.ts). Goes through the exact same
  // `items` state + debounced `persist` every drag/resize already uses — no
  // new endpoint, no new merge behaviour, just a third caller of `setItems`
  // alongside `handleRemove`/`handleLayoutChange` above.
  const handleConfigChange = useCallback((id: string, nextConfig: unknown) => {
    setItems((prev) => {
      const next = prev.map((it) =>
        it.i === id ? { ...it, config: nextConfig as Record<string, unknown> } : it,
      )
      persistLoaded(next)
      return next
    })
  }, [persistLoaded])

  const handleReset = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    void api.delete(`/home/layout?breakpoint=${breakpointRef.current}`).then(() => loadLayout(breakpointRef.current))
  }, [loadLayout])

  const appendWidget = useCallback((widgetId: string) => {
    setItems((prev) => {
      const size = WIDGETS[widgetId]?.layout ?? FALLBACK_SIZE
      const instance = nextInstance(widgetId, prev)
      const next = [...prev, { i: `${widgetId}#${instance}`, x: 0, y: bottomOf(prev), w: size.w, h: size.h }]
      persistLoaded(next)
      return next
    })
  }, [persistLoaded])

  const handleAddOffered = useCallback(() => {
    setItems((prev) => {
      const added: HomeLayoutItem[] = []
      let cursorY = bottomOf(prev)
      for (const widgetId of newWidgets) {
        const size = WIDGETS[widgetId]?.layout ?? FALLBACK_SIZE
        const instance = nextInstance(widgetId, [...prev, ...added])
        added.push({ i: `${widgetId}#${instance}`, x: 0, y: cursorY, w: size.w, h: size.h })
        cursorY += size.h
      }
      const next = [...prev, ...added]
      persistLoaded(next)
      return next
    })
    setNewWidgets([])
  }, [newWidgets, persistLoaded])

  const handleDismissOffer = useCallback(() => {
    void api.post(`/home/layout/ack-version?breakpoint=${breakpointRef.current}`)
    setNewWidgets([])
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold inline-flex items-center gap-1.5">
          {t('home.title')} <ContextualHelp helpId="daily.home" />
        </h1>
        <div className="flex items-center gap-2">
          {editing && (
            <Button size="sm" variant="outline" onClick={handleReset} data-testid="reset-layout">
              <RotateCcw className="h-3.5 w-3.5" />
              {t('home.edit.reset')}
            </Button>
          )}
          <Button
            size="sm"
            variant={editing ? 'default' : 'outline'}
            onClick={() => setEditing((e) => !e)}
            data-testid="edit-toggle"
          >
            {editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
            {editing ? t('home.edit.done') : t('home.edit.start')}
          </Button>
        </div>
      </header>

      {/* Fixed onboarding strip, not a grid tile: it is never removable and
          never appears in the widget catalogue (see setup-recommendations-card.tsx
          for its own "nothing left to do" null-return). */}
      <SetupRecommendationsCard data-testid="setup-strip" />

      {newWidgets.length > 0 && (
        <div data-testid="widget-offer" className="glass-card flex items-center justify-between gap-2 p-3">
          <span className="text-xs">{t('home.offer.title')}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleDismissOffer}>
              {t('home.offer.dismiss')}
            </Button>
            <Button size="sm" onClick={handleAddOffered}>
              {t('home.offer.add')}
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-start gap-4">
        <div ref={containerRef} data-testid="home-grid" className="min-w-0 flex-1">
          <ResponsiveGridLayout
            width={width}
            breakpoints={BREAKPOINTS}
            cols={COLS}
            rowHeight={40}
            layouts={{ [breakpoint]: items }}
            dragConfig={{ enabled: editing, handle: '[data-grid-handle]' }}
            resizeConfig={{ enabled: editing }}
            onLayoutChange={handleLayoutChange}
            onBreakpointChange={handleBreakpointChange}
            onDragStart={handleGestureStart}
            onResizeStart={handleGestureStart}
          >
            {items.map((item) => {
              const widgetId = item.i.split('#')[0]
              const def = WIDGETS[widgetId]
              const catalogueEntry = catalogue.find((c) => c.id === widgetId)
              const titleKey = def?.titleKey ?? catalogueEntry?.titleKey
              const title = titleKey ? tOr(titleKey, widgetId) : widgetId

              return (
                // `overflow-hidden` is load-bearing, not cosmetic. This div IS
                // the `.react-grid-item` — react-grid-layout clones it and
                // writes the cell's absolute position plus a FIXED inline
                // width/height onto it (dist/chunk-QAWP6PEK.js:481-509), and
                // neither the library's stylesheet nor anything below set an
                // overflow. So a tile whose content is taller or wider than
                // its cell used to paint straight over its neighbours: the
                // Pulse stat row spilled past the panel border, and the tile
                // underneath showed the strays. Clipped here, at the one
                // element whose size the grid actually dictates; WidgetFrame
                // then gives the content region its own scroll so clipping is
                // never how a tile loses information.
                <div key={item.i} data-testid={`widget-${item.i}`} className="overflow-hidden">
                  <WidgetFrame
                    title={title}
                    icon={def?.icon}
                    className="h-full"
                    onRemove={editing ? () => handleRemove(item.i) : undefined}
                    removeLabel={t('home.widget.remove')}
                    removeTestId={`remove-${item.i}`}
                  >
                    <WidgetBoundary>
                      {def ? (
                        <def.Component
                          config={item.config}
                          onConfigChange={(next) => handleConfigChange(item.i, next)}
                        />
                      ) : (
                        // Unknown widget id (not declared by any enabled
                        // module, or WIDGETS not filled in yet — see
                        // widget-registry.ts). Chosen behaviour: a stable
                        // placeholder tile, never a crash and never a
                        // silently vanished slot the operator can't remove.
                        <p className="py-2 text-xs text-muted-foreground">{t('home.widget.error')}</p>
                      )}
                    </WidgetBoundary>
                  </WidgetFrame>
                </div>
              )
            })}
          </ResponsiveGridLayout>
        </div>
        {editing && <WidgetDrawer catalogue={catalogue} onAdd={appendWidget} />}
      </div>
    </div>
  )
}
