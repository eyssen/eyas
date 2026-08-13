// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  createSearchContextResolver,
  hasMultiVersionOdooConflict,
} from '@modules/search/resolve-context'
import type { SearchSource } from '@modules/search/types'

function src(
  id: string,
  cfg: Record<string, unknown>,
  status: SearchSource['status'] = 'ready',
): SearchSource {
  return {
    id,
    name: id,
    type: 'code',
    indexer: 'code',
    config: { paths: [`/tmp/${id}`], ...cfg },
    status,
    chunkCount: 1,
    errorMessage: null,
    lastIndexedAt: null,
    createdAt: '',
    updatedAt: '',
  }
}

describe('resolveSearchContext', () => {
  const sources = [
    src('s18c', { label: '18c', version: '18', edition: 'community', family: 'odoo' }),
    src('s18e', { label: '18e', version: '18', edition: 'enterprise', family: 'odoo' }),
    src('s19c', { label: '19c', version: '19', edition: 'community', family: 'odoo' }),
    src('app', { paths: ['/tmp/app'] }),
  ]

  it('detects multi-version odoo conflict', () => {
    expect(hasMultiVersionOdooConflict(sources.filter((s) => s.status === 'ready'))).toBe(true)
  })

  it('explicit labels pin sources', () => {
    const r = createSearchContextResolver({ listSources: () => sources })
    const pin = r.resolve({ explicit: { labels: ['18c'] } })
    expect(pin.sourceIds).toEqual(['s18c'])
    expect(pin.pinned).toBe(true)
    expect(pin.needsPin).toBe(false)
  })

  it('conversation search_context wins over fallback', () => {
    const r = createSearchContextResolver({
      listSources: () => sources,
      getConversation: () => ({
        searchContext: { labels: ['19c'] },
        projectId: 'p1',
      }),
      getProject: () => ({ indexedSources: ['s18c'], typeId: null }),
    })
    const pin = r.resolve({ conversationId: 'c1' })
    expect(pin.sourceIds).toEqual(['s19c'])
    expect(pin.reason).toContain('conversation')
  })

  it('project indexed_sources used when conversation has no pin', () => {
    const r = createSearchContextResolver({
      listSources: () => sources,
      getConversation: () => ({ searchContext: null, projectId: 'p1' }),
      getProject: () => ({ indexedSources: ['s18c', 's18e'], typeId: null }),
    })
    const pin = r.resolve({ conversationId: 'c1' })
    expect(pin.sourceIds.sort()).toEqual(['s18c', 's18e'])
    expect(pin.reason).toContain('project')
  })

  it('needsPin when multi-version and no pin — excludes odoo family', () => {
    const r = createSearchContextResolver({ listSources: () => sources })
    const pin = r.resolve({})
    expect(pin.needsPin).toBe(true)
    expect(pin.sourceIds).toEqual(['app'])
    expect(pin.pinned).toBe(false)
  })

  it('version+edition filter', () => {
    const r = createSearchContextResolver({ listSources: () => sources })
    const pin = r.resolve({
      explicit: { version: '18', edition: 'enterprise' },
    })
    expect(pin.sourceIds).toEqual(['s18e'])
  })
})
