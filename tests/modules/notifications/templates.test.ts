import { describe, it, expect } from 'vitest'
import { createTemplateEngine } from '@modules/notifications/templates'
import type { NotificationPayload, NotificationRecord } from '@modules/notifications/router'

const basePayload: NotificationPayload = {
  id: 'n1',
  event: 'budget.warning',
  severity: 'warning',
  title: 'Monthly budget at 80%',
  body: '320/400 USD used',
  createdAt: '2026-04-17T10:00:00Z',
}

const baseRecord = (over: Partial<NotificationRecord> = {}): NotificationRecord => ({
  id: 'n1',
  userId: 'u1',
  event: 'budget.warning',
  severity: 'warning',
  title: 'Budget warning',
  body: 'Getting close',
  data: null,
  readAt: null,
  channelsSent: null,
  createdAt: '2026-04-17T10:00:00Z',
  ...over,
})

describe('createTemplateEngine', () => {
  describe('single render', () => {
    it('renders email with subject + text + html', () => {
      const engine = createTemplateEngine()
      const out = engine.render('email', basePayload)
      expect(out.subject).toContain('Monthly budget at 80%')
      expect(out.text).toContain('Monthly budget at 80%')
      expect(out.html).toContain('<h2')
      expect(out.html).toContain('Monthly budget at 80%')
    })

    it('prepends critical siren icon to email subject', () => {
      const engine = createTemplateEngine()
      const out = engine.render('email', { ...basePayload, severity: 'critical' })
      expect(out.subject?.startsWith('🚨')).toBe(true)
    })

    it('renders telegram as markdown text only', () => {
      const engine = createTemplateEngine()
      const out = engine.render('telegram', basePayload)
      expect(out.subject).toBeUndefined()
      expect(out.html).toBeUndefined()
      expect(out.text).toContain('*Monthly budget at 80%*')
    })

    it('renders webhook as JSON body', () => {
      const engine = createTemplateEngine()
      const out = engine.render('webhook', basePayload)
      const parsed = JSON.parse(out.text)
      expect(parsed.title).toBe('Monthly budget at 80%')
      expect(parsed.event).toBe('budget.warning')
    })

    it('falls back to web renderer for unknown channel', () => {
      const engine = createTemplateEngine()
      const out = engine.render('unknown-channel', basePayload)
      expect(out.text).toContain('Monthly budget at 80%')
    })

    it('escapes HTML in email body to prevent injection', () => {
      const engine = createTemplateEngine()
      const out = engine.render('email', {
        ...basePayload,
        title: '<script>alert(1)</script>',
        body: '"><img src=x>',
      })
      expect(out.html).not.toContain('<script>')
      expect(out.html).toContain('&lt;script&gt;')
      expect(out.html).not.toContain('<img src=x>')
      expect(out.html).toContain('&quot;')
    })
  })

  describe('custom templates', () => {
    it('applies registered template for exact event match', () => {
      const engine = createTemplateEngine()
      engine.registerTemplate('budget.warning', {
        text: (p) => `CUSTOM: ${p.title}`,
        subject: (p) => `[BUDGET] ${p.title}`,
      })
      const out = engine.render('email', basePayload)
      expect(out.text).toBe('CUSTOM: Monthly budget at 80%')
      expect(out.subject).toBe('[BUDGET] Monthly budget at 80%')
    })

    it('applies registered template via pattern match', () => {
      const engine = createTemplateEngine()
      engine.registerTemplate('budget.*', {
        text: (p) => `PATTERN: ${p.title}`,
      })
      const out = engine.render('telegram', basePayload)
      expect(out.text).toBe('PATTERN: Monthly budget at 80%')
    })

    it('exact match takes precedence over pattern match', () => {
      const engine = createTemplateEngine()
      engine.registerTemplate('budget.*', { text: () => 'PATTERN' })
      engine.registerTemplate('budget.warning', { text: () => 'EXACT' })
      const out = engine.render('telegram', basePayload)
      expect(out.text).toBe('EXACT')
    })
  })

  describe('digest render', () => {
    it('renders email digest as HTML table', () => {
      const engine = createTemplateEngine()
      const out = engine.renderDigest('email', [
        baseRecord({ id: '1', title: 'First' }),
        baseRecord({ id: '2', title: 'Second' }),
      ])
      expect(out).toContain('<table')
      expect(out).toContain('First')
      expect(out).toContain('Second')
      expect(out).toContain('2 notifications')
    })

    it('renders telegram digest as plain text', () => {
      const engine = createTemplateEngine()
      const out = engine.renderDigest('telegram', [
        baseRecord({ id: '1', title: 'First' }),
      ])
      expect(out).toContain('Digest')
      expect(out).toContain('First')
    })

    it('renders webhook digest as JSON array', () => {
      const engine = createTemplateEngine()
      const out = engine.renderDigest('webhook', [
        baseRecord({ id: '1', title: 'First' }),
        baseRecord({ id: '2', title: 'Second' }),
      ])
      const parsed = JSON.parse(out)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed).toHaveLength(2)
      expect(parsed[0].title).toBe('First')
    })

    it('handles singular vs plural wording', () => {
      const engine = createTemplateEngine()
      const single = engine.renderDigest('email', [baseRecord()])
      expect(single).toContain('1 notification')
      expect(single).not.toMatch(/1 notifications\b/)
    })
  })
})

describe('event pattern matching treats the pattern as a glob, not a regex', () => {
  it('does not let regex metacharacters in a pattern change what it matches', () => {
    const engine = createTemplateEngine()
    engine.registerTemplate('board.(task).*', {
      text: () => 'custom',
    } as never)
    // Read as a regex, the parentheses are a group and this would match
    // "board.task.assigned". As a glob it must not.
    const out = engine.render('email', {
      event: 'board.task.assigned',
      title: 't',
      body: 'b',
      severity: 'info',
    } as never)
    expect(out.text).not.toBe('custom')
  })

  it('still matches a plain star pattern', () => {
    const engine = createTemplateEngine()
    engine.registerTemplate('board.*', { text: () => 'custom' } as never)
    const out = engine.render('email', {
      event: 'board.assigned',
      title: 't',
      body: 'b',
      severity: 'info',
    } as never)
    expect(out.text).toBe('custom')
  })

  it('survives a pattern that is not a valid regex', () => {
    const engine = createTemplateEngine()
    engine.registerTemplate('board.[unclosed.*', { text: () => 'custom' } as never)
    expect(() =>
      engine.render('email', {
        event: 'board.task.assigned',
        title: 't',
        body: 'b',
        severity: 'info',
      } as never),
    ).not.toThrow()
  })
})
