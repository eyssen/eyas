// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, expect, it } from 'vitest'
import {
  ThreadIndex,
  buildThreads,
  normalizeSubject,
} from '../../../../../src/modules/communication/providers/imap-smtp/thread-builder.js'

describe('thread-builder: normalizeSubject', () => {
  it('strips Re: / Fwd: prefixes', () => {
    expect(normalizeSubject('Re: Hello')).toBe('hello')
    expect(normalizeSubject('FWD: hello')).toBe('hello')
    expect(normalizeSubject('Re: Re: Re: Topic')).toBe('topic')
  })

  it('strips Hungarian prefixes', () => {
    expect(normalizeSubject('Vá: Kérdés')).toBe('kérdés')
    expect(normalizeSubject('Továbbítás: Napló')).toBe('napló')
  })

  it('collapses whitespace', () => {
    expect(normalizeSubject('  Hello   World  ')).toBe('hello world')
  })

  it('handles empty / undefined', () => {
    expect(normalizeSubject(undefined)).toBe('')
    expect(normalizeSubject('')).toBe('')
  })
})

describe('thread-builder: ThreadIndex', () => {
  it('keeps unrelated messages in separate threads', () => {
    const idx = new ThreadIndex()
    const t1 = idx.add({ messageId: 'a@x' })
    const t2 = idx.add({ messageId: 'b@x' })
    expect(t1).not.toBe(t2)
  })

  it('merges messages linked via In-Reply-To', () => {
    const idx = new ThreadIndex()
    idx.add({ messageId: 'root@x', receivedAt: 1 })
    idx.add({ messageId: 'reply1@x', inReplyTo: 'root@x', receivedAt: 2 })
    idx.add({ messageId: 'reply2@x', inReplyTo: 'reply1@x', receivedAt: 3 })

    const thread = idx.threadOf('reply2@x')
    expect(thread).not.toBeNull()
    expect(thread!.messageIds).toEqual(['root@x', 'reply1@x', 'reply2@x'])
  })

  it('merges messages linked via References', () => {
    const idx = new ThreadIndex()
    idx.add({ messageId: 'r1@x' })
    idx.add({ messageId: 'r2@x', references: ['r1@x'] })
    idx.add({ messageId: 'r3@x', references: ['r1@x', 'r2@x'] })
    const thread = idx.threadOf('r3@x')!
    expect(thread.messageIds).toHaveLength(3)
  })

  it('falls back to subject-based threading when no references', () => {
    const idx = new ThreadIndex()
    idx.add({ messageId: 'a@x', normalisedSubject: 'meeting notes', receivedAt: 1 })
    idx.add({ messageId: 'b@x', normalisedSubject: 'meeting notes', receivedAt: 2 })
    const t = idx.threadOf('a@x')!
    expect(t.messageIds).toHaveLength(2)
  })

  it('buildThreads is a one-shot convenience wrapper', () => {
    const threads = buildThreads([
      { messageId: 'a@x', receivedAt: 1 },
      { messageId: 'b@x', inReplyTo: 'a@x', receivedAt: 2 },
      { messageId: 'c@x', receivedAt: 3 },
    ])
    expect(threads.length).toBe(2)
    const withA = threads.find(t => t.messageIds.includes('a@x'))!
    expect(withA.messageIds).toEqual(['a@x', 'b@x'])
  })

  it('clear() resets state', () => {
    const idx = new ThreadIndex()
    idx.add({ messageId: 'a@x' })
    idx.clear()
    expect(idx.threadOf('a@x')).toBeNull()
  })

  it('handles a 5-message reply chain', () => {
    const idx = new ThreadIndex()
    const ids = ['m1@x', 'm2@x', 'm3@x', 'm4@x', 'm5@x']
    for (let i = 0; i < ids.length; i++) {
      idx.add({
        messageId: ids[i]!,
        inReplyTo: i === 0 ? undefined : ids[i - 1],
        receivedAt: i,
      })
    }
    const t = idx.threadOf('m5@x')!
    expect(t.messageIds).toEqual(ids)
  })
})
