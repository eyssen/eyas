// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { processStreamEvent } from '../../src/web/src/hooks/use-streaming'
import { useConversationStore } from '../../src/web/src/stores/conversation-store'
import { planAutoTitle } from '../../src/shared/conversation-title'

function seedConversation(title: string | null = null) {
  useConversationStore.getState().setActiveConversation({
    id: 'c1',
    title,
    status: 'working',
    providerId: null,
    modelId: null,
    tokensUsed: 0,
    sdkSessionId: null,
    mode: 'simple',
    agentId: null,
    parentConversationId: null,
    complexity: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
  })
}

describe('optimistic first-turn title', () => {
  beforeEach(() => {
    useConversationStore.getState().setActiveConversation(null)
  })

  it('names an untitled conversation from the first request', () => {
    seedConversation(null)
    const title = planAutoTitle(useConversationStore.getState().activeConversation?.title, 'Hány modul van a könyvtárban?')
    useConversationStore.getState().updateConversation({ title })
    expect(useConversationStore.getState().activeConversation?.title).toBe('Hány modul van a könyvtárban?')
  })

  it('does not overwrite a user-set title', () => {
    seedConversation('Már van neve')
    const title = planAutoTitle(useConversationStore.getState().activeConversation?.title, 'Hány modul van a könyvtárban?')
    expect(title).toBe('')
  })
})

describe('processStreamEvent title', () => {
  beforeEach(() => {
    useConversationStore.getState().setActiveConversation(null)
  })

  it('applies a generated title to the active conversation', () => {
    seedConversation(null)
    processStreamEvent({ type: 'title', title: 'Fix the indexer' }, useConversationStore.getState())
    expect(useConversationStore.getState().activeConversation?.title).toBe('Fix the indexer')
  })

  it('replaces a placeholder title when the SSE title event arrives', () => {
    seedConversation('Névtelen')
    processStreamEvent({ type: 'title', title: 'Odoo 18 indexer' }, useConversationStore.getState())
    expect(useConversationStore.getState().activeConversation?.title).toBe('Odoo 18 indexer')
  })
})
