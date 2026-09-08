// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A scan of a whole home directory lists tens of thousands of rows. The wizard
// never holds them: the virtualiser says which rows are on screen, this module
// says which pages that needs, a bounded cache keeps the recent ones, and the
// three list endpoints are called with a query built from one filter object —
// so a count and the page it labels can never be asked different questions.

import type { CandidateFilter } from './data-port-types'

/** Rows per request. Matches the server's `CANDIDATE_PAGE_DEFAULT`. */
export const PAGE_SIZE = 200

/**
 * Pages kept per folder/filter combination — 4 000 rows, a few megabytes at
 * most. Past this the least recently touched page is dropped and refetched if
 * the owner scrolls back to it.
 */
export const MAX_PAGES_PER_GROUP = 20

/**
 * The page indexes a rendered row range needs, inclusive of both ends. A range
 * the virtualiser has not measured yet (empty, reversed, non-finite) needs
 * nothing — asking for page `NaN` would fetch `offset=NaN`.
 */
export function pagesForRange(startIndex: number, endIndex: number): number[] {
  if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) return []
  if (endIndex < 0 || endIndex < startIndex) return []
  const first = Math.floor(Math.max(0, startIndex) / PAGE_SIZE)
  const last = Math.floor(endIndex / PAGE_SIZE)
  const pages: number[] = []
  for (let p = first; p <= last; p++) pages.push(p)
  return pages
}

export interface PageCache<T> {
  get(page: number): T | undefined
  set(page: number, value: T): void
  has(page: number): boolean
  delete(page: number): void
  clear(): void
  readonly size: number
}

/**
 * Least-recently-used page cache. `Map` keeps insertion order, so a `get` that
 * re-inserts its key moves it to the back and the eviction victim is always the
 * first key — no timestamps, no scan.
 */
export function createPageCache<T>(max: number = MAX_PAGES_PER_GROUP): PageCache<T> {
  const map = new Map<number, T>()
  return {
    get(page) {
      if (!map.has(page)) return undefined
      const value = map.get(page)!
      map.delete(page)
      map.set(page, value)
      return value
    },
    set(page, value) {
      map.delete(page)
      map.set(page, value)
      while (map.size > max) {
        const oldest = map.keys().next()
        if (oldest.done) break
        map.delete(oldest.value)
      }
    },
    has: (page) => map.has(page),
    delete: (page) => void map.delete(page),
    clear: () => map.clear(),
    get size() {
      return map.size
    },
  }
}

/**
 * Filter fields in a fixed order, so the same filter always produces the same
 * string and it can be used as a cache key. An unset field is omitted entirely
 * — `subtree` only appears when the caller actually asked for one, because the
 * server's own default (subtree) is the honest answer when nobody chose.
 */
function appendFilter(params: URLSearchParams, filter: CandidateFilter): void {
  const list = (key: string, values: string[] | undefined) => {
    if (values && values.length) params.set(key, values.join(','))
  }
  list('kind', filter.kind)
  list('reason', filter.reason)
  if (filter.folder) params.set('folder', filter.folder)
  if (filter.subtree !== undefined) params.set('subtree', String(filter.subtree))
  if (filter.selected !== undefined) params.set('selected', String(filter.selected))
  if (filter.importable !== undefined) params.set('importable', String(filter.importable))
  if (filter.q) params.set('q', filter.q)
  list('tag', filter.tag)
  list('excludeKinds', filter.excludeKinds)
  list('excludeReasons', filter.excludeReasons)
  list('excludeFolders', filter.excludeFolders)
}

const scanPath = (scanId: string) => `/data-port/import/scans/${encodeURIComponent(scanId)}`
const withQuery = (path: string, params: URLSearchParams) => {
  const q = params.toString()
  return q ? `${path}?${q}` : path
}

/** One page of rows under `filter`. `order` is the server's `path` unless asked otherwise. */
export function buildCandidatesQuery(
  scanId: string,
  filter: CandidateFilter,
  offset: number,
  limit: number = PAGE_SIZE,
  order?: 'path' | 'seq',
): string {
  const params = new URLSearchParams()
  appendFilter(params, filter)
  params.set('offset', String(offset))
  params.set('limit', String(limit))
  if (order) params.set('order', order)
  return withQuery(`${scanPath(scanId)}/candidates`, params)
}

/** The counts for the same filter — the numbers above the list must match the list. */
export function buildCountsQuery(scanId: string, filter: CandidateFilter): string {
  const params = new URLSearchParams()
  appendFilter(params, filter)
  return withQuery(`${scanPath(scanId)}/counts`, params)
}

/**
 * The children of one folder. The tree endpoint scopes by `parent`, so a
 * `folder` or `subtree` left in the filter would fight it — they are dropped
 * here rather than at every call site.
 */
export function buildTreeQuery(scanId: string, parent: string, filter: CandidateFilter = {}): string {
  const params = new URLSearchParams()
  params.set('parent', parent)
  const { folder: _folder, subtree: _subtree, ...rest } = filter
  appendFilter(params, rest)
  return withQuery(`${scanPath(scanId)}/tree`, params)
}
