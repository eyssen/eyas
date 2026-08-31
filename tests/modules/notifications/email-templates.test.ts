// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createTemplateEngine } from '@modules/notifications/templates'
import { createEmailChannel } from '@modules/notifications/channels/email'

const payload = (over: Record<string, unknown> = {}) => ({
  event: 'board.task.assigned',
  title: 'Task assigned',
  body: 'Review the invoice batch',
  severity: 'info',
  createdAt: '2026-08-26T10:00:00.000Z',
  ...over,
}) as any

describe('notification templates', () => {
  it('renders the shell from its own constants', () => {
    const engine = createTemplateEngine()
    const out = engine.render('email', payload())
    expect(out.html).toContain('#ffffff')
    expect(out.html).toContain('EYAS Notifications')
  })

  it('escapes the event and the title', () => {
    // The reason this file exists: the channel used to build its own
    // unescaped HTML, and both the escaping bug and the bypass were fixed by
    // routing everything through this engine.
    const engine = createTemplateEngine()
    const out = engine.render('email', payload({ title: '<img src=x onerror=alert(1)>', event: 'a&b' }))
    expect(out.html).not.toContain('<img src=x')
    expect(out.html).toContain('&lt;img')
    expect(out.html).toContain('a&amp;b')
  })
})

describe('the notification email channel', () => {
  function channel(templates?: any) {
    const sent: any[] = []
    const ch = createEmailChannel({
      getSmtpConfig: () => ({ host: 'h', port: 587, secure: false, auth: { user: 'u', pass: 'p' }, from: 'eyas@b.test' }),
      resolveEmail: () => 'to@b.test',
      templates,
      createTransport: () => ({ sendMail: async (mail: any) => { sent.push(mail); return {} } }),
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as any,
    })
    return { ch, sent }
  }

  it('sends the engine-rendered subject, text and html', async () => {
    const { ch, sent } = channel(createTemplateEngine())
    expect(await ch.send('u1', payload())).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].subject).toBe('[EYAS] Task assigned')
    expect(sent[0].html).toContain('Task assigned')
    expect(sent[0].text).toContain('Review the invoice batch')
  })

  it('always sets a text alternative, even with no engine', async () => {
    const { ch, sent } = channel(undefined)
    expect(await ch.send('u1', payload())).toBe(true)
    expect(sent[0].text).toBe('Task assigned\nReview the invoice batch')
  })

  it('no longer emits the unescaped inline HTML it used to build', async () => {
    const { ch, sent } = channel(createTemplateEngine())
    await ch.send('u1', payload({ title: '<script>alert(1)</script>' }))
    expect(sent[0].html).not.toMatch(/<script[\s>]/)
    expect(sent[0].html).toContain('&lt;script&gt;')
  })

  it('omits html entirely when the engine supplies none', async () => {
    const { ch, sent } = channel({ render: () => ({ subject: 'S', text: 'T' }) })
    await ch.send('u1', payload())
    expect('html' in sent[0]).toBe(false)
    expect(sent[0].text).toBe('T')
  })

  it('returns false and does not throw when the address cannot be resolved', async () => {
    const ch = createEmailChannel({
      getSmtpConfig: () => ({ host: 'h', port: 1, secure: false, auth: { user: '', pass: '' }, from: 'a@b.test' }),
      resolveEmail: () => null,
      createTransport: () => ({ sendMail: async () => ({}) }),
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as any,
    })
    expect(await ch.send('u1', payload())).toBe(false)
  })

  it('reports a transport failure as false rather than throwing', async () => {
    const ch = createEmailChannel({
      getSmtpConfig: () => ({ host: 'h', port: 1, secure: false, auth: { user: '', pass: '' }, from: 'a@b.test' }),
      resolveEmail: () => 'to@b.test',
      createTransport: () => ({ sendMail: async () => { throw new Error('smtp down') } }),
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as any,
    })
    expect(await ch.send('u1', payload())).toBe(false)
  })
})
