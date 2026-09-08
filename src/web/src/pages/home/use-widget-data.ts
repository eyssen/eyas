// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Fetch/refresh hook shared by every home-page dashboard tile. Three
// properties keep a tile from silently drifting from reality (the failure
// mode this whole feature exists to avoid), plus one dedupe:
//
// 1. Reconnect refetch -- use-websocket.ts documents the gap itself: frames
//    broadcast while the socket was down are gone, so a topic ping alone
//    can't fill it. A tile whose only trigger is a missed ping looks
//    healthy while showing stale data. Refetch on every false->true
//    `connected` transition (never on first connect -- the mount-time load
//    already covers that).
// 2. Stale-while-revalidate -- useApi (hooks/use-api.ts) nulls `data` on
//    every refetch, which is right for switching conversations but would
//    make nine polling/ws tiles flicker empty on every refresh. `data` here
//    is only ever replaced by a successful response, never cleared first.
// 3. Gated polling -- a `pollMs` tile ticks only while the tab is visible
//    and, once a tile element is attached via `tileRef`, only while that
//    element is on screen (IntersectionObserver). A forgotten background
//    tab must not burn rate limit.
//
// Plus in-flight dedupe: the same path requested by two tiles (or the same
// widget placed twice) within one tick shares a single REST response.
//
// `refresh.topics` entries are always resolved WS_TOPICS values, never
// catalogue keys (see assertResolvedTopic below) -- for a config-dependent
// topic (Board), `refresh.topics` is a function of the tile's config, so the
// optional third `config` argument is what it's invoked with.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { useWebSocket } from '@/hooks/use-websocket'
import { WS_TOPICS } from '@/lib/ws-topics'
import type { WidgetDef } from './widget-registry'

const inflight = new Map<string, Promise<unknown>>()

/** Test-only: clears the shared in-flight map between test cases. */
export function __resetInflight() {
  inflight.clear()
}

function sharedGet<T>(path: string): Promise<T> {
  const existing = inflight.get(path)
  if (existing) return existing as Promise<T>
  const p = api.get<T>(path).finally(() => inflight.delete(path))
  inflight.set(path, p)
  return p
}

/**
 * The catalogue's static string values -- 'mission-control', 'system', etc.
 *
 * `Object.values(WS_TOPICS)` on an `as const` object infers each element's
 * literal type (e.g. `"system"`), not the widened `string` -- so the filter
 * callback's inferred parameter type is a union of those literals and the
 * dynamic-topic function types, never plain `string`. A `(v): v is string`
 * predicate is only legal when `string` is assignable to that parameter
 * type, which a union of narrower literals never satisfies (TS2677). Casting
 * to `unknown[]` first widens the callback's parameter before the predicate
 * narrows it back down, which is what the runtime check actually does.
 */
const STATIC_TOPIC_VALUES = new Set(
  (Object.values(WS_TOPICS) as unknown[]).filter((v): v is string => typeof v === 'string'),
)

/**
 * Fix round 1: `refresh.topics` must carry resolved topic NAMES
 * (`WS_TOPICS.autonomy`, `WS_TOPICS.board(id)`), never catalogue KEYS
 * (`'autonomy'`, `'board'`). For four of the nine keys the two differ
 * (`missionControl` -> `'mission-control'`), so a key silently subscribes to
 * a topic nothing ever publishes to -- the tile just never refreshes, with
 * no error anywhere. This used to be rescued at runtime by looking the entry
 * up in `WS_TOPICS`; that hid the bug instead of catching it, so it's gone.
 *
 * Fail loud instead: every resolved *dynamic* topic contains a `:`
 * (`board:<id>`, `chat:<id>`, ...); every resolved *static* topic is one of
 * the catalogue's known string values. Anything else -- a bare key, a typo,
 * a hand-written literal -- throws rather than being silently dropped.
 */
function assertResolvedTopic(topic: string): void {
  if (STATIC_TOPIC_VALUES.has(topic) || topic.includes(':')) return
  throw new Error(
    `useWidgetData: "${topic}" is not a resolved WS_TOPICS value (did you pass a WS_TOPICS ` +
      `key instead of calling it, e.g. WS_TOPICS.missionControl or WS_TOPICS.board(id)?)`,
  )
}

interface UseWidgetDataResult<T> {
  data: T | null
  error: ApiError | null
  isLoading: boolean
  refetch: () => void
  /**
   * Attach to the tile's root element to add the IntersectionObserver gate
   * to polling, on top of the tab-visibility gate that always applies.
   * Optional: until attached (or without IntersectionObserver support),
   * only the tab-visibility gate is enforced.
   */
  tileRef: (node: Element | null) => void
}

export function useWidgetData<T>(
  path: string,
  refresh: WidgetDef['refresh'],
  config?: unknown,
): UseWidgetDataResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [tileEl, setTileEl] = useState<Element | null>(null)
  const { subscribe, connected } = useWebSocket()
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  const tileRef = useCallback((node: Element | null) => setTileEl(node), [])

  const load = useCallback(() => {
    sharedGet<T>(path)
      .then((d) => {
        if (mountedRef.current) {
          setData(d)
          setError(null)
        }
      })
      .catch((e) => {
        if (mountedRef.current) setError(e instanceof ApiError ? e : new ApiError(0, String(e)))
      })
      .finally(() => {
        if (mountedRef.current) setIsLoading(false)
      })
  }, [path])

  useEffect(() => {
    load()
  }, [load])

  // Property 1: reconnect refetch.
  const wasConnected = useRef(connected)
  useEffect(() => {
    if (connected && !wasConnected.current) load()
    wasConnected.current = connected
  }, [connected, load])

  // WS pings are thin (ids only, "something changed") -- data always
  // crosses REST, never read out of the frame. `topics` may be a plain list
  // of resolved names or a function of the tile's config (e.g. Board needs
  // `WS_TOPICS.board(cfg.projectId)`, unknown until config is).
  const topicsSpec = refresh.topics
  const resolvedTopics = typeof topicsSpec === 'function' ? topicsSpec(config) : (topicsSpec ?? [])
  const topicsKey = resolvedTopics.join(',')
  useEffect(() => {
    if (resolvedTopics.length === 0) return
    const unsubs = resolvedTopics.map((topic) => {
      assertResolvedTopic(topic)
      return subscribe(topic, () => load())
    })
    return () => {
      unsubs.forEach((unsub) => unsub())
    }
    // topicsKey is the stable proxy for resolvedTopics' contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicsKey, subscribe, load])

  // Property 3: gated polling.
  useEffect(() => {
    const pollMs = refresh.pollMs
    if (!pollMs) return

    const tabVisible = { current: document.visibilityState === 'visible' }
    const onScreen = { current: true }

    const onVisibility = () => {
      tabVisible.current = document.visibilityState === 'visible'
    }
    document.addEventListener('visibilitychange', onVisibility)

    let observer: IntersectionObserver | undefined
    if (typeof IntersectionObserver !== 'undefined' && tileEl) {
      observer = new IntersectionObserver(([entry]) => {
        onScreen.current = entry.isIntersecting
      })
      observer.observe(tileEl)
    }

    const id = setInterval(() => {
      if (tabVisible.current && onScreen.current) load()
    }, pollMs)

    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
      observer?.disconnect()
    }
  }, [refresh.pollMs, load, tileEl])

  return { data, error, isLoading, refetch: load, tileRef }
}
