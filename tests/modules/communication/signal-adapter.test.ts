// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { createSignalAdapter } from '../../../src/modules/communication/submodules/signal/adapter.js'

const logger = pino({ level: 'silent' })

describe('Signal adapter', () => {
  it('creates channel with correct id, type, name', () => {
    const adapter = createSignalAdapter({ logger })
    expect(adapter.id).toBe('signal')
    expect(adapter.type).toBe('signal')
    expect(adapter.name).toBe('Signal (signal-cli)')
  })

  it('connected is false initially', () => {
    const adapter = createSignalAdapter({ logger })
    expect(adapter.connected).toBe(false)
  })

  it('isConfigured is false without credentials', () => {
    const adapter = createSignalAdapter({ logger })
    expect(adapter.isConfigured).toBe(false)
  })

  it('isConfigured is true when url and account are provided', () => {
    const adapter = createSignalAdapter({
      signalCliUrl: 'http://localhost:8080',
      accountNumber: '+1234567890',
      logger,
    })
    expect(adapter.isConfigured).toBe(true)
  })

  it('onMessage registers handlers without error', () => {
    const adapter = createSignalAdapter({ logger })
    expect(() => {
      adapter.onMessage(async (_msg) => {})
    }).not.toThrow()
  })
})
