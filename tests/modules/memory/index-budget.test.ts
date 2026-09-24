// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { configSchema } from '@core/config/schema'
import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'

describe('memory.index.budgetChars', () => {
  it('defaults to 2400 and accepts an override', () => {
    expect(configSchema.parse({}).memory.index.budgetChars).toBe(2400)
    expect(configSchema.parse({ memory: { index: { budgetChars: 8000 } } }).memory.index.budgetChars).toBe(8000)
    expect(() => configSchema.parse({ memory: { index: { budgetChars: 0 } } })).toThrow()
  })

  it('ships the same default in config/default.yaml, not a value tuned to one instance', () => {
    const shipped = configSchema.parse(parseYaml(readFileSync('config/default.yaml', 'utf8')))
    expect(shipped.memory.index.budgetChars).toBe(2400)
  })
})

describe('memory.relatedWork (retired)', () => {
  it('(−) is no longer part of the config: prior work is in the recalled-memory block', () => {
    expect((configSchema.parse({}).memory as Record<string, unknown>).relatedWork).toBeUndefined()
    const shipped = parseYaml(readFileSync('config/default.yaml', 'utf8'))
    expect(shipped.memory.relatedWork).toBeUndefined()
  })

  it('(+) an old local.yaml that still sets it keeps loading; the key is dropped', () => {
    const parsed = configSchema.parse({ memory: { relatedWork: { enabled: false, maxHits: 9 }, index: { budgetChars: 3000 } } })
    expect((parsed.memory as Record<string, unknown>).relatedWork).toBeUndefined()
    expect(parsed.memory.index.budgetChars).toBe(3000)
  })
})
