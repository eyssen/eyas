// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { createDiscordBot } from '../../../src/modules/communication/submodules/discord/bot.js'

const logger = pino({ level: 'silent' })

describe('Discord bot adapter', () => {
  it('creates channel with correct id, type, name', () => {
    const bot = createDiscordBot({ logger })
    expect(bot.id).toBe('discord')
    expect(bot.type).toBe('discord')
    expect(bot.name).toBe('Discord Bot')
  })

  it('connected is false initially', () => {
    const bot = createDiscordBot({ logger })
    expect(bot.connected).toBe(false)
  })

  it('isConfigured is false without credentials', () => {
    const bot = createDiscordBot({ logger })
    expect(bot.isConfigured).toBe(false)
  })

  it('isConfigured is true when botToken is provided', () => {
    const bot = createDiscordBot({ botToken: 'test-token', logger })
    expect(bot.isConfigured).toBe(true)
  })

  it('onMessage registers handlers without error', () => {
    const bot = createDiscordBot({ logger })
    expect(() => {
      bot.onMessage(async (_msg) => {})
    }).not.toThrow()
  })
})
