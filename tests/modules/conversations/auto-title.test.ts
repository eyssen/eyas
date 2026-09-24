// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  fallbackTitleFromMessage,
  generateConversationTitle,
  isUntitledTitle,
  planAutoTitle,
  sanitizeGeneratedTitle,
} from '../../../src/modules/conversations/auto-title.js'
import {
  auxError,
  auxNone,
  auxOk,
  createFakeAuxiliaryModel,
  createGatewayBackedAuxiliaryModel,
  fakeHeartbeatTier,
} from '../../helpers/fake-auxiliary-model.js'

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
  it('asks the background model for a title under the title purpose, and sanitises it', async () => {
    const aux = createFakeAuxiliaryModel(auxOk('"Indexer fix."'))
    const title = await generateConversationTitle({
      aux,
      userMessage: 'Please fix the code indexer it is stuck',
      conversationId: 'conv-1',
    })
    expect(title).toBe('Indexer fix')
    expect(aux.calls).toHaveLength(1)
    expect(aux.calls[0]).toMatchObject({
      purpose: 'title',
      user: 'Please fix the code indexer it is stuck',
      maxTokens: 24,
      conversationId: 'conv-1',
    })
    expect(aux.calls[0].system).toMatch(/conversation titles/)
  })

  it('reaches the gateway isolated, with the instruction in request.system and one user message', async () => {
    const { aux, requests } = createGatewayBackedAuxiliaryModel({ answer: 'Indexer fix' })
    const title = await generateConversationTitle({ aux, userMessage: 'Fix the indexer', conversationId: 'conv-1' })
    expect(title).toBe('Indexer fix')
    expect(requests).toHaveLength(1)
    expect(requests[0].isolated).toBe(true)
    expect(requests[0].system).toMatch(/conversation titles/)
    expect(requests[0].messages).toEqual([{ role: 'user', content: 'Fix the indexer' }])
    expect(requests[0].metadata).toMatchObject({ purpose: 'title', conversationId: 'conv-1' })
  })

  it('returns the snippet without any call when no background model is wired', async () => {
    expect(await generateConversationTitle({ userMessage: 'Fix the indexer' })).toBe('Fix the indexer')
  })

  it('returns the snippet when the service has no eligible model', async () => {
    const aux = createFakeAuxiliaryModel(auxNone('tier_not_configured'))
    expect(await generateConversationTitle({ aux, userMessage: 'Fix the indexer' })).toBe('Fix the indexer')
  })

  it('never bills another model: without a heartbeat tier the gateway is not called', async () => {
    // An API provider is registered and eligible, but titles are tier-only.
    const { aux, requests } = createGatewayBackedAuxiliaryModel({ tiers: [] })
    expect(await generateConversationTitle({ aux, userMessage: 'Fix the indexer' })).toBe('Fix the indexer')
    expect(requests).toHaveLength(0)
  })

  it('returns the snippet on a Grok-only install, with zero model calls', async () => {
    const { aux, requests } = createGatewayBackedAuxiliaryModel({
      providers: ['grok-cli'],
      tiers: [fakeHeartbeatTier('grok-cli', 'grok-4')],
    })
    expect(await generateConversationTitle({ aux, userMessage: 'Fix the indexer' })).toBe('Fix the indexer')
    expect(requests).toHaveLength(0)
  })

  it('returns the snippet when the call fails', async () => {
    const aux = createFakeAuxiliaryModel(auxError('down'))
    expect(await generateConversationTitle({ aux, userMessage: 'Fix the indexer' })).toBe('Fix the indexer')
  })

  it('makes no call for a blank message', async () => {
    const aux = createFakeAuxiliaryModel(auxOk('Something'))
    expect(await generateConversationTitle({ aux, userMessage: '   ' })).toBe('')
    expect(aux.calls).toHaveLength(0)
  })
})
