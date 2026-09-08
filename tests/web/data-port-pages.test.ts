// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The wizard never holds a whole scan: it asks for one 200-row page at a time
// and keeps at most MAX_PAGES_PER_GROUP of them. These are the pure parts of
// that — which pages a rendered range needs, the cache that bounds them, and
// the query strings the three list endpoints are called with.
import { describe, expect, it } from 'vitest'
import {
  buildCandidatesQuery,
  buildCountsQuery,
  buildTreeQuery,
  createPageCache,
  MAX_PAGES_PER_GROUP,
  PAGE_SIZE,
  pagesForRange,
} from '@/pages/settings/data-port-pages'

describe('pagesForRange', () => {
  it('answers the pages a rendered row range needs', () => {
    expect(PAGE_SIZE).toBe(200)
    expect(pagesForRange(0, 150)).toEqual([0])
    expect(pagesForRange(180, 420)).toEqual([0, 1, 2])
    expect(pagesForRange(200, 200)).toEqual([1])
    expect(pagesForRange(199, 200)).toEqual([0, 1])
  })

  it('is defensive about a range the virtualiser has not measured yet', () => {
    expect(pagesForRange(-5, -1)).toEqual([])
    expect(pagesForRange(10, 5)).toEqual([])
    expect(pagesForRange(Number.NaN, 10)).toEqual([])
    expect(pagesForRange(-10, 10)).toEqual([0])
  })
})

describe('createPageCache', () => {
  it('evicts the least recently touched page once the cap is passed', () => {
    expect(MAX_PAGES_PER_GROUP).toBe(20)
    const cache = createPageCache<string>()
    for (let page = 0; page < MAX_PAGES_PER_GROUP; page++) cache.set(page, `p${page}`)
    expect(cache.size).toBe(20)
    expect(cache.get(0)).toBe('p0') // touching page 0 makes page 1 the oldest
    cache.set(20, 'p20')
    expect(cache.size).toBe(20)
    expect(cache.has(1)).toBe(false)
    expect(cache.get(0)).toBe('p0')
    expect(cache.get(20)).toBe('p20')
  })

  it('overwrites without growing, and clears on a filter change', () => {
    const cache = createPageCache<string>(3)
    cache.set(0, 'a')
    cache.set(0, 'b')
    expect(cache.size).toBe(1)
    expect(cache.get(0)).toBe('b')
    cache.set(1, 'c')
    cache.set(2, 'd')
    cache.set(3, 'e')
    expect(cache.has(0)).toBe(false)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get(3)).toBeUndefined()
  })
})

describe('query builders', () => {
  it('encodes every set filter field and omits the empty ones', () => {
    const q = buildCandidatesQuery('s', { q: 'a & b', folder: 'Documents/Notes' }, 0, 200)
    expect(q.startsWith('/data-port/import/scans/s/candidates?')).toBe(true)
    const params = new URLSearchParams(q.slice(q.indexOf('?') + 1))
    expect(params.get('folder')).toBe('Documents/Notes')
    expect(params.get('q')).toBe('a & b')
    expect(params.get('offset')).toBe('0')
    expect(params.get('limit')).toBe('200')
    expect([...params.keys()]).toEqual(['folder', 'q', 'offset', 'limit'])
    expect(q).toContain('folder=Documents%2FNotes')
    expect(q).not.toContain('subtree=')
    expect(q).not.toContain('kind=')
  })

  it('names subtree only when the caller asked for one', () => {
    expect(buildCandidatesQuery('s', { folder: 'notes', subtree: true }, 0, 200)).toBe(
      '/data-port/import/scans/s/candidates?folder=notes&subtree=true&offset=0&limit=200',
    )
    expect(buildCandidatesQuery('s', { folder: 'notes', subtree: false }, 400, 200)).toBe(
      '/data-port/import/scans/s/candidates?folder=notes&subtree=false&offset=400&limit=200',
    )
    expect(buildCandidatesQuery('s', { folder: 'notes' }, 0, 200)).toBe(
      '/data-port/import/scans/s/candidates?folder=notes&offset=0&limit=200',
    )
  })

  it('joins list fields with commas and keeps a stable field order', () => {
    const q = buildCandidatesQuery(
      's1',
      {
        kind: ['memory', 'code'],
        reason: ['directory-skipped'],
        folder: 'notes',
        subtree: true,
        selected: false,
        q: 'alpha',
        tag: ['legacy', 'contains-secrets'],
        excludeKinds: ['noise'],
      },
      200,
      200,
    )
    expect(q).toBe(
      '/data-port/import/scans/s1/candidates?kind=memory%2Ccode&reason=directory-skipped&folder=notes' +
        '&subtree=true&selected=false&q=alpha&tag=legacy%2Ccontains-secrets&excludeKinds=noise&offset=200&limit=200',
    )
    expect(buildCandidatesQuery('s1', { kind: [], tag: [] }, 0, 200)).toBe(
      '/data-port/import/scans/s1/candidates?offset=0&limit=200',
    )
  })

  it('escapes a scan id into the path and orders explicitly when asked', () => {
    expect(buildCandidatesQuery('a b/c', {}, 0, 200)).toBe('/data-port/import/scans/a%20b%2Fc/candidates?offset=0&limit=200')
    expect(buildCandidatesQuery('s', {}, 0, 200, 'seq')).toBe('/data-port/import/scans/s/candidates?offset=0&limit=200&order=seq')
  })

  it('builds the counts and tree queries from the same filter', () => {
    expect(buildCountsQuery('s', { q: 'alpha' })).toBe('/data-port/import/scans/s/counts?q=alpha')
    expect(buildCountsQuery('s', {})).toBe('/data-port/import/scans/s/counts')
    expect(buildTreeQuery('s', '.')).toBe('/data-port/import/scans/s/tree?parent=.')
    expect(buildTreeQuery('s', 'notes', { q: 'alpha' })).toBe('/data-port/import/scans/s/tree?parent=notes&q=alpha')
    // The tree endpoint scopes by `parent`; a `folder` in the filter would fight it.
    expect(buildTreeQuery('s', 'notes', { folder: 'other', subtree: false, q: 'a' })).toBe(
      '/data-port/import/scans/s/tree?parent=notes&q=a',
    )
  })
})
