// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { configSchema } from '@core/config/schema'

describe('memory.index.budgetChars', () => {
  it('defaults to 2400 and accepts an override', () => {
    expect(configSchema.parse({}).memory.index.budgetChars).toBe(2400)
    expect(configSchema.parse({ memory: { index: { budgetChars: 8000 } } }).memory.index.budgetChars).toBe(8000)
    expect(() => configSchema.parse({ memory: { index: { budgetChars: 0 } } })).toThrow()
  })
})
