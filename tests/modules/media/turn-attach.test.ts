// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { collectMediaDocumentIds } from '@modules/media/turn-attach'

describe('collectMediaDocumentIds', () => {
  it('appends new document ids from jobs', () => {
    expect(
      collectMediaDocumentIds(
        [{ documentIds: ['d1', 'd2'] }, { documentIds: ['d3'] }],
        ['a1'],
      ),
    ).toEqual(['a1', 'd1', 'd2', 'd3'])
  })

  it('skips ids already present', () => {
    expect(
      collectMediaDocumentIds(
        [{ documentIds: ['a1', 'd2'] }, { documentIds: ['d2', 'd3'] }],
        ['a1'],
      ),
    ).toEqual(['a1', 'd2', 'd3'])
  })

  it('returns a copy of already when jobs are empty', () => {
    const already = ['a1']
    const out = collectMediaDocumentIds([], already)
    expect(out).toEqual(['a1'])
    expect(out).not.toBe(already)
  })

  it('treats missing documentIds as empty', () => {
    expect(
      collectMediaDocumentIds([{ documentIds: undefined as unknown as string[] }], ['a1']),
    ).toEqual(['a1'])
  })
})
