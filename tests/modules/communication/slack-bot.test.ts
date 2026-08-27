// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { createSlackBot } from '../../../src/modules/communication/submodules/slack/bot.js'

const logger = pino({ level: 'silent' })

describe('Slack bot adapter', () => {
  it('creates channel with correct id, type, name', () => {
    const bot = createSlackBot({ logger })
    expect(bot.id).toBe('slack')
    expect(bot.type).toBe('slack')
    expect(bot.name).toBe('Slack Bot')
  })

  it('connected is false initially', () => {
    const bot = createSlackBot({ logger })
    expect(bot.connected).toBe(false)
  })

  it('isConfigured is false without credentials', () => {
    const bot = createSlackBot({ logger })
    expect(bot.isConfigured).toBe(false)
  })

  it('isConfigured is false with only botToken', () => {
    const bot = createSlackBot({ botToken: 'xoxb-test', logger })
    expect(bot.isConfigured).toBe(false)
  })

  it('isConfigured is true when both tokens are provided', () => {
    const bot = createSlackBot({ botToken: 'xoxb-test', appToken: 'xapp-test', logger })
    expect(bot.isConfigured).toBe(true)
  })

  it('onMessage registers handlers without error', () => {
    const bot = createSlackBot({ logger })
    expect(() => {
      bot.onMessage(async (_msg) => {})
    }).not.toThrow()
  })
})
