// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { collectStudioDocumentIds } from '@modules/studio/turn-attach'

describe('collectStudioDocumentIds', () => {
  it('appends new ids without duplicating', () => {
    expect(collectStudioDocumentIds([{ documentIds: ['a', 'b'] }], ['a'])).toEqual(['a', 'b'])
    expect(collectStudioDocumentIds([{ documentIds: [] }], ['x'])).toEqual(['x'])
    expect(collectStudioDocumentIds([{ documentIds: undefined as unknown as string[] }], ['a1'])).toEqual(['a1'])
  })
})
