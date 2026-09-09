// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { createEmailAdapter } from '../../../src/modules/communication/submodules/email/adapter.js'

const logger = pino({ level: 'silent' })

describe('Email adapter', () => {
  it('creates channel with correct id, type, name', () => {
    const adapter = createEmailAdapter({ logger })
    expect(adapter.id).toBe('email')
    expect(adapter.type).toBe('email')
    expect(adapter.name).toBe('Email (SMTP/IMAP)')
  })

  it('connected is false initially', () => {
    const adapter = createEmailAdapter({ logger })
    expect(adapter.connected).toBe(false)
  })

  it('isConfigured is false without credentials', () => {
    const adapter = createEmailAdapter({ logger })
    expect(adapter.isConfigured).toBe(false)
  })

  it('isConfigured is true when SMTP credentials are provided', () => {
    const adapter = createEmailAdapter({
      smtpHost: 'smtp.example.com',
      smtpUser: 'user@example.com',
      smtpPass: 'secret',
      logger,
    })
    expect(adapter.isConfigured).toBe(true)
  })

  it('onMessage registers handlers without error', () => {
    const adapter = createEmailAdapter({ logger })
    expect(() => {
      adapter.onMessage(async (_msg) => {})
    }).not.toThrow()
  })
})
