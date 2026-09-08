// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { createTelegramBot } from '../../../src/modules/communication/submodules/telegram/bot.js'

const logger = pino({ level: 'silent' })

describe('Telegram bot adapter', () => {
  it('creates channel with correct id, type, name', () => {
    const bot = createTelegramBot({ logger })
    expect(bot.id).toBe('telegram')
    expect(bot.type).toBe('telegram')
    expect(bot.name).toBe('Telegram Bot')
  })

  it('isConfigured is false without a token', () => {
    const bot = createTelegramBot({ logger })
    expect(bot.isConfigured).toBe(false)
    expect(bot.connected).toBe(false)
  })

  it('isConfigured is true when a bot token is provided', () => {
    const bot = createTelegramBot({ botToken: 'test-token', logger })
    expect(bot.isConfigured).toBe(true)
  })

  it('accepts an onCallbackQuery handler without connecting', () => {
    const bot = createTelegramBot({
      logger,
      onCallbackQuery: async () => ({ text: 'Approved' }),
    })
    expect(() => {
      bot.onMessage(async () => {})
    }).not.toThrow()
  })
})
