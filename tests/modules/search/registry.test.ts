import { describe, it, expect } from 'vitest'
import { createIndexerRegistry } from '@modules/search/registry'
import type { ContentIndexer } from '@modules/search/types'

const mockIndexer: ContentIndexer = {
  name: 'test',
  async index() { return [] },
  supports() { return true },
}

describe('IndexerRegistry', () => {
  it('registers and retrieves an indexer', () => {
    const reg = createIndexerRegistry()
    reg.register('test', mockIndexer)
    expect(reg.get('test')).toBe(mockIndexer)
  })

  it('returns null for unregistered indexer', () => {
    const reg = createIndexerRegistry()
    expect(reg.get('nope')).toBeNull()
  })

  it('lists registered indexer names', () => {
    const reg = createIndexerRegistry()
    reg.register('a', mockIndexer)
    reg.register('b', mockIndexer)
    expect(reg.list()).toEqual(['a', 'b'])
  })

  it('throws on duplicate registration', () => {
    const reg = createIndexerRegistry()
    reg.register('x', mockIndexer)
    expect(() => reg.register('x', mockIndexer)).toThrow('already registered')
  })
})
