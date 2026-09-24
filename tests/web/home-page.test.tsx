// @vitest-environment jsdom
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useEffect, type ReactNode } from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import HomePage from '@/pages/home/home-page'
import { api } from '@/lib/api'

// HomePage now renders SetupRecommendationsCard unconditionally (Task 14's
// fixed onboarding strip, above the grid) -- unlike every mocked WIDGETS
// entry below, that's the real component, and it uses <Link>, which throws
// ('router.isServer' on a null router) outside a <RouterProvider>. useNavigate
// (used throughout the real widgets, also unmocked in the sibling
// home-widgets-*.test.tsx files) degrades to a console.warn instead --
// TanStack's useRouter() only warns when its context is missing, so only the
// Link-specific codepath needs a stand-in here. No app screen renders
// HomePage outside a real RouterProvider, so this is test-only scaffolding.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
  }
})

// WIDGETS (widget-registry.ts) is still empty at this point in the plan
// (Tasks 10-13 fill it in) -- mocked here with two entries so the tests below
// can tell apart three real cases the empty registry alone cannot exercise:
// a healthy widget, one whose Component throws, and an id the registry
// doesn't know at all. 'costops.summary' throws from an effect rather than
// during render -- that's the failure mode useWidgetData's fail-loud topic
// guard (assertResolvedTopic) actually produces, and the one a prior review
// confirmed empirically still reaches getDerivedStateFromError.
vi.mock('@/pages/home/widget-registry', () => ({
  WIDGETS: {
    'costops.summary': {
      id: 'costops.summary',
      titleKey: 'home.widget.cost.title',
      layout: { w: 3, h: 2, minW: 1, minH: 1 },
      refresh: {},
      Component: () => {
        useEffect(() => {
          throw new Error('boom')
        }, [])
        return null
      },
    },
    'board.summary': {
      id: 'board.summary',
      titleKey: 'home.widget.board.title',
      layout: { w: 4, h: 5, minW: 1, minH: 1 },
      refresh: {},
      Component: () => <p data-testid="board-summary-ok">ok</p>,
    },
    // Exercises the `onConfigChange` write channel (widget-registry.ts /
    // board-widget.tsx are the real consumer; this stand-in avoids coupling
    // this file to board-widget's own fetch/picker behaviour, already
    // covered by home-widgets-running.test.tsx).
    // 12 columns wide: at 'sm' (4 columns) the grid MUST re-fit it, which is
    // what the last breakpoint test below reads the persisted width for.
    'wide.tile': {
      id: 'wide.tile',
      titleKey: 'home.widget.board.title',
      layout: { w: 12, h: 2, minW: 1, minH: 1 },
      refresh: {},
      Component: () => <p data-testid="wide-tile-ok">wide</p>,
    },
    'test.configurable': {
      id: 'test.configurable',
      titleKey: 'home.widget.board.title',
      layout: { w: 4, h: 5, minW: 1, minH: 1 },
      refresh: {},
      Component: ({ onConfigChange }: { config: unknown; onConfigChange: (next: unknown) => void }) => (
        <button data-testid="set-config" onClick={() => onConfigChange({ projectId: 'proj-9' })}>
          set
        </button>
      ),
    },
  },
}))

beforeEach(() => {
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path.startsWith('/home/layout')) {
      return { items: [{ i: 'costops.summary#1', x: 0, y: 0, w: 3, h: 2 }], source: 'factory', newWidgets: [] } as never
    }
    if (path === '/home/widgets') {
      return { widgets: [{ id: 'costops.summary', titleKey: 'home.widget.cost.title', module: 'costops', available: true }] } as never
    }
    // The onboarding strip (SetupRecommendationsCard) now renders above every
    // grid, so its own probe needs a response too -- "no open recommendations"
    // keeps it a no-op (renders null) for grid tests that aren't about it.
    if (path === '/home/setup-status') {
      return { items: [] } as never
    }
    return {} as never
  })
})

describe('home page grid', () => {
  it('renders the tiles the layout endpoint returns', async () => {
    render(<HomePage />)
    await waitFor(() => expect(screen.getByTestId('widget-costops.summary#1')).toBeInTheDocument())
  })

  it('reveals the drawer in edit mode only', async () => {
    render(<HomePage />)
    await waitFor(() => screen.getByTestId('widget-costops.summary#1'))
    expect(screen.queryByTestId('widget-drawer')).toBeNull()
    fireEvent.click(screen.getByTestId('edit-toggle'))
    expect(screen.getByTestId('widget-drawer')).toBeInTheDocument()
  })

  it('persists the layout after a change', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({ ok: true } as never)
    render(<HomePage />)
    await waitFor(() => screen.getByTestId('widget-costops.summary#1'))
    fireEvent.click(screen.getByTestId('edit-toggle'))
    fireEvent.click(screen.getByTestId('remove-costops.summary#1'))
    await waitFor(() => expect(put).toHaveBeenCalledWith('/home/layout', expect.objectContaining({ items: [] })))
  })

  it('a tile writing its own config persists it on the right item, and only that item', async () => {
    // Two items, not one: a single-item fixture can't tell "the config
    // landed on the item that wrote it" apart from "the config landed on
    // whichever item happened to be in the array" — replacing
    // `home-page.tsx`'s `it.i === id` guard with `true` would still pass a
    // one-item version of this test. The second item ('board.summary#1',
    // already mocked above as a stable non-throwing tile) must come back
    // completely untouched.
    const put = vi.spyOn(api, 'put').mockResolvedValue({ ok: true } as never)
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/home/layout')) {
        return {
          items: [
            { i: 'test.configurable#1', x: 0, y: 0, w: 4, h: 5 },
            { i: 'board.summary#1', x: 4, y: 0, w: 4, h: 5 },
          ],
          source: 'factory',
          newWidgets: [],
        } as never
      }
      if (path === '/home/setup-status') return { items: [] } as never
      return { widgets: [] } as never
    })
    render(<HomePage />)
    await waitFor(() => screen.getByTestId('set-config'))
    fireEvent.click(screen.getByTestId('set-config'))
    // x/y aren't asserted for board.summary#1: react-grid-layout recompacts
    // positions against the resolved breakpoint's column count, which this
    // test doesn't control — irrelevant to what's being proven here.
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/home/layout',
        expect.objectContaining({
          items: [
            expect.objectContaining({ i: 'test.configurable#1', config: { projectId: 'proj-9' } }),
            expect.objectContaining({ i: 'board.summary#1', w: 4, h: 5 }),
          ],
        }),
      ),
    )
    const [, body] = put.mock.calls[put.mock.calls.length - 1] as [string, { items: Array<Record<string, unknown>> }]
    const untouched = body.items.find((it) => it.i === 'board.summary#1')
    expect(untouched).not.toHaveProperty('config')
  })

  it('a failing tile degrades itself, not the page', async () => {
    render(<HomePage />)
    await waitFor(() => screen.getByTestId('widget-costops.summary#1'))
    // The boundary catches the throw and renders the error state in place.
    expect(screen.queryByTestId('home-grid')).toBeInTheDocument()
  })
})

describe('home page grid -- isolation and unknown ids', () => {
  it('a tile whose widget throws in an effect shows the error state while a sibling tile keeps working', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/home/layout')) {
        return {
          items: [
            { i: 'costops.summary#1', x: 0, y: 0, w: 3, h: 2 },
            { i: 'board.summary#1', x: 3, y: 0, w: 4, h: 5 },
          ],
          source: 'factory',
          newWidgets: [],
        } as never
      }
      if (path === '/home/setup-status') return { items: [] } as never
      return { widgets: [] } as never
    })
    render(<HomePage />)

    // The healthy sibling actually rendered its real content...
    await waitFor(() => expect(screen.getByTestId('board-summary-ok')).toBeInTheDocument())
    // ...while the failing tile's wrapper is still present (never unmounted)
    // and shows the boundary's fallback text instead of crashing the page.
    const failedTile = screen.getByTestId('widget-costops.summary#1')
    expect(failedTile).toBeInTheDocument()
    expect(failedTile).toHaveTextContent('Unavailable')
  })

  it('an unknown widget id renders a placeholder instead of crashing', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/home/layout')) {
        return {
          items: [{ i: 'ghost.widget#1', x: 0, y: 0, w: 3, h: 2 }],
          source: 'factory',
          newWidgets: [],
        } as never
      }
      if (path === '/home/setup-status') return { items: [] } as never
      return { widgets: [] } as never
    })
    render(<HomePage />)
    const tile = await waitFor(() => screen.getByTestId('widget-ghost.widget#1'))
    expect(tile).toHaveTextContent('Unavailable')
  })
})

describe('home page grid -- setup strip', () => {
  // task-14-brief.md's Step 1 snippet keys its fixture on 'providers' -- not
  // one of setup-recommendations-card.tsx's real RecId values ('models',
  // 'projects', 'prompts', 'agents', 'channels', 'search', 'memory',
  // 'backup', 'ingress', 'autonomy'). Against the real component that id
  // matches none of the ten rows, so `doneFor` returns null (not found) for
  // all of them -- which happens to still leave the strip open for the first
  // test (null counts as "open", same as done:false), but would NOT hide it
  // for the second test (every row stays null, never true, so it never
  // empties). Using one real id below instead of the brief's placeholder so
  // this test actually exercises the done:false / all-done:true paths it
  // claims to, not an accidental side effect of an unmatched id.
  it('shows the setup strip above the grid while recommendations are open', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/home/setup-status') return { items: [{ id: 'models', done: false }] } as never
      if (path.startsWith('/home/layout')) return { items: [], source: 'factory', newWidgets: [] } as never
      return { widgets: [] } as never
    })
    render(<HomePage />)
    await waitFor(() => expect(screen.getByTestId('setup-strip')).toBeInTheDocument())
  })

  it('hides the setup strip when every recommendation is done', async () => {
    const allDone = ['models', 'projects', 'prompts', 'agents', 'channels', 'search', 'memory', 'backup', 'ingress', 'autonomy']
      .map((id) => ({ id, done: true }))
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/home/setup-status') return { items: allDone } as never
      if (path.startsWith('/home/layout')) return { items: [], source: 'factory', newWidgets: [] } as never
      return { widgets: [] } as never
    })
    render(<HomePage />)
    // Renders with the strip's loading-state list first (isLoading is true
    // on the very first render, before the /home/setup-status fetch
    // resolves) -- waitFor lets that settle before asserting it's gone.
    await waitFor(() => expect(screen.queryByTestId('setup-strip')).toBeNull())
  })
})

// Every case below leans on one property of jsdom rather than on a mocked
// grid: `useContainerWidth` starts at its 1280px default (-> 'lg'), then
// measures the real container, and jsdom reports 0 for an unstyled div ->
// 'sm' (BREAKPOINTS' floor). So mounting HomePage under jsdom reproduces the
// exact production sequence a sub-1200px window produces — first paint at
// 'lg', an immediate switch after measurement — through the real
// react-grid-layout, with nothing about its behaviour stubbed or assumed.
describe('home page grid -- breakpoint switches', () => {
  /** Distinct rows per breakpoint, so "which row did it read" is visible in the DOM. */
  function mockRows(rows: Partial<Record<'lg' | 'md' | 'sm', unknown>>, source: 'factory' | 'custom' = 'custom') {
    return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      const bp = path.startsWith('/home/layout') ? (path.split('breakpoint=')[1] as 'lg' | 'md' | 'sm') : null
      if (bp) return { items: rows[bp] ?? [], source, newWidgets: [] } as never
      if (path === '/home/setup-status') return { items: [] } as never
      return { widgets: [] } as never
    })
  }

  it("reads the new breakpoint's own row, not the one it started at", async () => {
    const get = mockRows({
      lg: [{ i: 'board.summary#1', x: 0, y: 0, w: 12, h: 5 }],
      sm: [{ i: 'test.configurable#1', x: 0, y: 0, w: 4, h: 5 }],
    })
    render(<HomePage />)
    await waitFor(() => expect(get).toHaveBeenCalledWith('/home/layout?breakpoint=sm'))
    // ...and the sm row is what ends up on screen: the lg row's tile is gone.
    await waitFor(() => expect(screen.getByTestId('widget-test.configurable#1')).toBeInTheDocument())
    expect(screen.queryByTestId('widget-board.summary#1')).toBeNull()
  })

  it('never writes a layout derived from the previous breakpoint', async () => {
    // The lg row is 12 wide; at sm (4 columns) react-grid-layout re-fits it to
    // w:4 and reports that through onLayoutChange. Persisting THAT is the
    // defect: it would land in the `sm` row, built from lg items this page
    // never loaded for sm.
    const put = vi.spyOn(api, 'put').mockResolvedValue({ ok: true } as never)
    mockRows({
      lg: [{ i: 'board.summary#1', x: 0, y: 0, w: 12, h: 5 }],
      sm: [{ i: 'test.configurable#1', x: 0, y: 0, w: 4, h: 5 }],
    })
    render(<HomePage />)
    await waitFor(() => expect(screen.getByTestId('widget-test.configurable#1')).toBeInTheDocument())
    // Well past SAVE_DEBOUNCE_MS (800): a scheduled save would have fired.
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(put).not.toHaveBeenCalled()
  })

  it('writes nothing while the new row is still in flight', async () => {
    // The reload alone is not enough. Between asking for a row and receiving
    // it, `items` still holds the PREVIOUS breakpoint's row, and the grid
    // reports its re-fit of THOSE items in that gap — anything written there
    // lands in the new breakpoint's row, built from the old one's items, which
    // is the whole defect. A mock that resolves instantly closes the gap and
    // proves nothing, so this drives the widths by hand and holds the last
    // response open across it.
    //
    // jsdom has no ResizeObserver, so `useContainerWidth` never re-measures on
    // its own; this stand-in is the only way to move the container width after
    // mount, and it is what makes the sequence below (sm -> lg -> sm, the
    // second switch NARROWING, which is the direction that actually re-fits
    // geometry) reachable at all.
    const observers: Array<(width: number) => void> = []
    class StubResizeObserver {
      constructor(cb: (entries: Array<{ contentRect: { width: number } }>) => void) {
        observers.push((width) => cb([{ contentRect: { width } }]))
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    const previousRO = globalThis.ResizeObserver
    globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver

    try {
      const put = vi.spyOn(api, 'put').mockResolvedValue({ ok: true } as never)
      let releaseFinalSm: (() => void) | undefined
      const finalSmArrived = new Promise<void>((resolve) => { releaseFinalSm = resolve })
      let smRequests = 0
      vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
        if (path === '/home/layout?breakpoint=sm') {
          smRequests += 1
          // The SECOND sm request is the one held open.
          if (smRequests > 1) await finalSmArrived
          return { items: [{ i: 'test.configurable#1', x: 0, y: 0, w: 4, h: 5 }], source: 'custom', newWidgets: [] } as never
        }
        if (path.startsWith('/home/layout')) {
          return { items: [{ i: 'board.summary#1', x: 0, y: 0, w: 12, h: 5 }], source: 'custom', newWidgets: [] } as never
        }
        if (path === '/home/setup-status') return { items: [] } as never
        return { widgets: [] } as never
      })

      render(<HomePage />)
      // jsdom measures the unstyled container at 0 -> 'sm'.
      await waitFor(() => expect(screen.getByTestId('widget-test.configurable#1')).toBeInTheDocument())

      // Widen past the 1200px lg floor: the 12-wide lg row lands and is drawn.
      observers.forEach((fire) => fire(1300))
      await waitFor(() => expect(screen.getByTestId('widget-board.summary#1')).toBeInTheDocument())

      // Narrow again, with the sm row held open. `items` now holds the 12-wide
      // lg row, which the grid re-fits to 4 columns and reports.
      observers.forEach((fire) => fire(300))
      await new Promise((resolve) => setTimeout(resolve, 1100))
      expect(put).not.toHaveBeenCalled()

      releaseFinalSm!()
      await waitFor(() => expect(screen.getByTestId('widget-test.configurable#1')).toBeInTheDocument())
      await new Promise((resolve) => setTimeout(resolve, 1100))
      expect(put).not.toHaveBeenCalled()
    } finally {
      globalThis.ResizeObserver = previousRO
    }
  })

  it('ignores a row that arrives after the page has already moved on', async () => {
    // Two switches faster than one round trip (sm -> lg -> sm) with the
    // responses landing in the wrong order. The abandoned `lg` row must not
    // overwrite the `sm` row that superseded it, or the page ends up showing
    // — and, on the next edit, saving — a row for a breakpoint it is not on.
    const observers: Array<(width: number) => void> = []
    class StubResizeObserver {
      constructor(cb: (entries: Array<{ contentRect: { width: number } }>) => void) {
        observers.push((width) => cb([{ contentRect: { width } }]))
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    const previousRO = globalThis.ResizeObserver
    globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver

    try {
      vi.spyOn(api, 'put').mockResolvedValue({ ok: true } as never)
      let releaseLg: (() => void) | undefined
      let releaseSm: (() => void) | undefined
      const lgArrived = new Promise<void>((resolve) => { releaseLg = resolve })
      const smArrived = new Promise<void>((resolve) => { releaseSm = resolve })
      let smRequests = 0
      vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
        if (path === '/home/layout?breakpoint=sm') {
          smRequests += 1
          if (smRequests > 1) await smArrived
          return { items: [{ i: 'test.configurable#1', x: 0, y: 0, w: 4, h: 5 }], source: 'custom', newWidgets: [] } as never
        }
        if (path === '/home/layout?breakpoint=lg') {
          await lgArrived
          return { items: [{ i: 'board.summary#1', x: 0, y: 0, w: 12, h: 5 }], source: 'custom', newWidgets: [] } as never
        }
        if (path.startsWith('/home/layout')) return { items: [], source: 'custom', newWidgets: [] } as never
        if (path === '/home/setup-status') return { items: [] } as never
        return { widgets: [] } as never
      })

      render(<HomePage />)
      await waitFor(() => expect(screen.getByTestId('widget-test.configurable#1')).toBeInTheDocument())
      observers.forEach((fire) => fire(1300))
      observers.forEach((fire) => fire(300))

      // The row the page is actually on lands first...
      releaseSm!()
      await waitFor(() => expect(screen.getByTestId('widget-test.configurable#1')).toBeInTheDocument())
      // ...and the abandoned one, arriving late, changes nothing.
      releaseLg!()
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(screen.getByTestId('widget-test.configurable#1')).toBeInTheDocument()
      expect(screen.queryByTestId('widget-board.summary#1')).toBeNull()
    } finally {
      globalThis.ResizeObserver = previousRO
    }
  })

  it('leaves a user with no stored row at the new breakpoint on the factory layout (D1)', async () => {
    // The server answers every breakpoint with the same 12-column factory
    // default and `source: 'factory'` — no row exists at sm. The grid still
    // has to re-fit those items to 4 columns to draw them, and that re-fit
    // must not be mistaken for a customisation: writing it would CREATE the
    // sm row, and from then on new factory widgets stop being offered there.
    const put = vi.spyOn(api, 'put').mockResolvedValue({ ok: true } as never)
    const factory = [
      { i: 'board.summary#1', x: 0, y: 0, w: 12, h: 2 },
      { i: 'costops.summary#1', x: 0, y: 2, w: 6, h: 5 },
    ]
    mockRows({ lg: factory, md: factory, sm: factory }, 'factory')
    render(<HomePage />)
    await waitFor(() => expect(screen.getByTestId('widget-board.summary#1')).toBeInTheDocument())
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(put).not.toHaveBeenCalled()
  })

  it("saves a real change to the breakpoint the page is actually on", async () => {
    // The mirror of the three above: suppressing the derived write must not
    // suppress genuine ones. A removal after the switch has to reach the
    // server, addressed to `sm` — not `lg`, and not nothing at all.
    const put = vi.spyOn(api, 'put').mockResolvedValue({ ok: true } as never)
    mockRows({
      lg: [{ i: 'board.summary#1', x: 0, y: 0, w: 12, h: 5 }],
      sm: [
        { i: 'test.configurable#1', x: 0, y: 0, w: 4, h: 5 },
        { i: 'board.summary#1', x: 0, y: 5, w: 4, h: 5 },
      ],
    })
    render(<HomePage />)
    await waitFor(() => expect(screen.getByTestId('widget-test.configurable#1')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('edit-toggle'))
    fireEvent.click(screen.getByTestId('remove-test.configurable#1'))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/home/layout',
        expect.objectContaining({
          breakpoint: 'sm',
          items: [expect.objectContaining({ i: 'board.summary#1' })],
        }),
      ),
    )
  })

  it("saves the grid's re-fit of a tile the user just added at a narrow breakpoint", async () => {
    // Discriminates the suppression above from "never persist a reported
    // layout again". 'wide.tile' is declared w:12, so appending it at 'sm'
    // produces two candidate saves: the append's own, carrying the declared
    // w:12, and the one the grid's re-fit reports afterwards, carrying w:4.
    // They share the debounce timer, so exactly one request lands — and it
    // must be the re-fit. If the adoption guard failed to disarm, the w:12
    // one would land instead.
    const put = vi.spyOn(api, 'put').mockResolvedValue({ ok: true } as never)
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/home/layout')) return { items: [], source: 'factory', newWidgets: [] } as never
      if (path === '/home/setup-status') return { items: [] } as never
      return {
        widgets: [{ id: 'wide.tile', titleKey: 'home.widget.board.title', module: 'test', available: true }],
      } as never
    })
    render(<HomePage />)
    await waitFor(() => expect(screen.getByTestId('edit-toggle')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('edit-toggle'))
    await waitFor(() => expect(screen.getByTestId('drawer-widget-wide.tile')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('drawer-widget-wide.tile'))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/home/layout',
        expect.objectContaining({
          breakpoint: 'sm',
          items: [expect.objectContaining({ i: 'wide.tile#1', w: 4 })],
        }),
      ),
    )
  })
})

// jsdom does not do layout: it has no box model, so NOTHING here can tell you
// whether a tile actually overflows its cell. That needs a human with a
// browser. What these two cases do guard is the structure the fix depends on —
// the grid item clips, and the frame's content region is the shrinkable,
// scrollable one — so that removing either is a red test rather than a defect
// somebody has to notice by eye three weeks later.
describe('home page grid -- tile containment (structure only)', () => {
  it('clips the grid item, which is the element the library sizes', async () => {
    render(<HomePage />)
    const item = await waitFor(() => screen.getByTestId('widget-costops.summary#1'))
    expect(item).toHaveClass('overflow-hidden')
  })

  it("scrolls the frame's content region instead of growing it", async () => {
    render(<HomePage />)
    await waitFor(() => screen.getByTestId('widget-costops.summary#1'))
    const content = screen.getAllByTestId('widget-content')[0]
    // `min-h-0` is the one that is easy to drop: without it a flex child keeps
    // `min-height: auto`, refuses to shrink below its content, and the overflow
    // simply moves up to the frame instead of scrolling here.
    expect(content).toHaveClass('min-h-0')
    expect(content).toHaveClass('flex-1')
    expect(content).toHaveClass('overflow-y-auto')
    // And the scroll has to be VISIBLE when it exists: macOS overlay
    // scrollbars stay hidden until a scroll is already under way, so without
    // `widget-scroll` (home-grid.css) a tile that scrolls and a tile that is
    // simply cut off look the same. jsdom applies no stylesheet, so this can
    // only check that the region opts in — the appearance itself needs eyes.
    expect(content).toHaveClass('widget-scroll')
  })
})
