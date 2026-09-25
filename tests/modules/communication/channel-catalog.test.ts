// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { CHANNEL_CATALOG, getCatalogEntry } from '@modules/communication/channel-catalog.js'

describe('channel catalog', () => {
  it('covers all major messaging channel types', () => {
    const types = new Set(CHANNEL_CATALOG.map((e) => e.type))
    for (const t of [
      'telegram',
      'discord',
      'slack',
      'email',
      'whatsapp',
      'signal',
      'googlechat',
      'teams',
    ]) {
      expect(types.has(t as any)).toBe(true)
    }
  })

  it('has unique catalog ids and required secrets marked', () => {
    const ids = CHANNEL_CATALOG.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of CHANNEL_CATALOG) {
      expect(entry.secrets.some((s) => s.required)).toBe(true)
      expect(entry.name.length).toBeGreaterThan(0)
    }
  })

  it('resolves telegram catalog entry', () => {
    const tg = getCatalogEntry('telegram')
    expect(tg?.secrets.some((s) => s.name === 'telegram-bot-token')).toBe(true)
    expect(tg?.supportsPairing).toBe(true)
  })
})
