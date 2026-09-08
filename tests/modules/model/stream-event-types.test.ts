// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import type { ModelRequest } from '@modules/model/types.js'

describe('ModelRequest signal', () => {
  it('accepts an AbortSignal forwarded to the provider', () => {
    const ac = new AbortController()
    const req: ModelRequest = { messages: [], signal: ac.signal }
    expect(req.signal).toBe(ac.signal)
  })
})
