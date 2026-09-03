// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import {
  fallbackTitleFromMessage,
  generateConversationTitle,
  isUntitledTitle,
  planAutoTitle,
  sanitizeGeneratedTitle,
} from '../../../src/modules/conversations/auto-title.js'

describe('isUntitledTitle', () => {
  it('treats null, empty, and whitespace as untitled', () => {
    expect(isUntitledTitle(null)).toBe(true)
    expect(isUntitledTitle(undefined)).toBe(true)
    expect(isUntitledTitle('')).toBe(true)
    expect(isUntitledTitle('   ')).toBe(true)
  })

  it('treats localized placeholders as untitled', () => {
    expect(isUntitledTitle('Untitled')).toBe(true)
    expect(isUntitledTitle('Névtelen')).toBe(true)
    expect(isUntitledTitle('névtelen beszélgetés')).toBe(true)
    expect(isUntitledTitle('Ohne Titel')).toBe(true)
    expect(isUntitledTitle('Sin título')).toBe(true)
    expect(isUntitledTitle('Sans titre')).toBe(true)
    expect(isUntitledTitle('pong Hutlh')).toBe(true)
  })

  it('leaves a real title alone', () => {
    expect(isUntitledTitle('Fix the indexer')).toBe(false)
    expect(isUntitledTitle('Névtelenül jó ötlet')).toBe(false)
  })
})

describe('fallbackTitleFromMessage', () => {
  it('returns empty for blank input', () => {
    expect(fallbackTitleFromMessage('')).toBe('')
    expect(fallbackTitleFromMessage('   \n\t  ')).toBe('')
  })

  it('keeps a short first request intact', () => {
    expect(fallbackTitleFromMessage('Javítsd meg az indexert')).toBe('Javítsd meg az indexert')
  })

  it('collapses whitespace and cuts at a word boundary', () => {
    const long = 'Please  investigate   the Odoo 18 code indexer because it never finishes on large addons'
    const title = fallbackTitleFromMessage(long, 40)
    expect(title.endsWith('…')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(41)
    expect(title).not.toMatch(/\s{2,}/)
  })
})

describe('sanitizeGeneratedTitle', () => {
  it('strips quotes, trailing dots, and wrapping whitespace', () => {
    expect(sanitizeGeneratedTitle('  "Fix the indexer."  ', 'fb')).toBe('Fix the indexer')
  })

  it('falls back when the model returns empty or a placeholder', () => {
    expect(sanitizeGeneratedTitle('', 'fb')).toBe('fb')
    expect(sanitizeGeneratedTitle('Untitled', 'fb')).toBe('fb')
    expect(sanitizeGeneratedTitle('Névtelen', 'fb')).toBe('fb')
  })

  it('truncates a long model title at a word boundary', () => {
    const raw = 'A very long generated title that exceeds the allowed maximum length for conversation names'
    const title = sanitizeGeneratedTitle(raw, 'fb', 40)
    expect(title.length).toBeLessThanOrEqual(40)
    expect(title).not.toBe('fb')
  })
})

describe('planAutoTitle', () => {
  it('returns a snippet only while the conversation is still untitled', () => {
    expect(planAutoTitle(null, 'Fix the indexer')).toBe('Fix the indexer')
    expect(planAutoTitle('Névtelen', 'Fix the indexer')).toBe('Fix the indexer')
    expect(planAutoTitle('Already named', 'Fix the indexer')).toBe('')
    expect(planAutoTitle(null, '   ')).toBe('')
  })
})

describe('generateConversationTitle', () => {
  it('returns the fallback when no heartbeat model is configured', async () => {
    const title = await generateConversationTitle({
      ctx: { model: { complete: vi.fn() } as any },
      userMessage: 'Fix the indexer',
    })
    expect(title).toBe('Fix the indexer')
  })

  it('uses the cheap-tier model when heartbeat routing is available', async () => {
    const complete = vi.fn(async () => ({ content: [{ type: 'text', text: '"Indexer fix"' }] }))
    const title = await generateConversationTitle({
      ctx: {
        model: { complete } as any,
        decisionEngine: { resolveForTier: () => ({ provider: 'anthropic', model: 'haiku' }) },
      },
      userMessage: 'Please fix the code indexer it is stuck',
    })
    expect(title).toBe('Indexer fix')
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('falls back when the cheap model throws', async () => {
    const title = await generateConversationTitle({
      ctx: {
        model: { complete: vi.fn(async () => { throw new Error('down') }) } as any,
        decisionEngine: { resolveForTier: () => ({ provider: 'anthropic', model: 'haiku' }) },
      },
      userMessage: 'Fix the indexer',
    })
    expect(title).toBe('Fix the indexer')
  })
})
