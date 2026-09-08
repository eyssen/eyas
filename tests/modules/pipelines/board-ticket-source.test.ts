// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { createBoardTicketSource } from '@modules/pipelines/ticket-to-code/adapters/board-ticket-source'

describe('createBoardTicketSource', () => {
  it('maps a board conversation to a TicketContext', async () => {
    const conv = {
      id: 'c1',
      title: 'Add export button',
      messages: [{ role: 'user', content: 'We need a CSV export.' }],
    }
    const src = createBoardTicketSource({ get: (id) => (id === 'c1' ? conv : null) })
    const t = await src.fetchTicket('board', 'c1')
    expect(t.id).toBe('c1')
    expect(t.title).toBe('Add export button')
    expect(t.body).toContain('CSV export')
    expect(t.source).toBe('board')
  })

  it('throws when the conversation is not found', async () => {
    const src = createBoardTicketSource({ get: () => null })
    await expect(src.fetchTicket('board', 'missing')).rejects.toThrow(/not found/i)
  })

  it('falls back to "Untitled ticket" when the conversation has no title', async () => {
    const conv = { id: 'c2', title: null, messages: [] }
    const src = createBoardTicketSource({ get: () => conv })
    const t = await src.fetchTicket('board', 'c2')
    expect(t.title).toBe('Untitled ticket')
    expect(t.body).toBe('')
  })

  it('stringifies non-string content blocks safely', async () => {
    const conv = {
      id: 'c3',
      title: 'Weird content',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Part A' }, { type: 'text', text: 'Part B' }] },
        { role: 'assistant', content: 'Plain reply' },
      ],
    }
    const src = createBoardTicketSource({ get: () => conv })
    const t = await src.fetchTicket('board', 'c3')
    expect(t.body).toContain('Part A')
    expect(t.body).toContain('Part B')
    expect(t.body).toContain('Plain reply')
  })
})
