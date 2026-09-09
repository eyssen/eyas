// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { ticketSlug, decisionSlug, parseWikiTicketBody } from '../../../src/modules/client-wiki/wiki-paths.js'

describe('wiki path templates', () => {
  it('scopes a ticket page by id only — no tenant or project name in the slug', () => {
    expect(ticketSlug('conv-alpha-1')).toBe('ticket-conv-alpha-1')
    expect(ticketSlug('CONV/Alpha 1')).toBe('ticket-conv-alpha-1')
  })

  it('scopes a decision page by source id only — no tenant or project name in the slug', () => {
    expect(decisionSlug('sess-bravo-9')).toBe('decision-sess-bravo-9')
    expect(decisionSlug('sess:Bravo 9!')).toBe('decision-sess-bravo-9')
  })

  it('never embeds a client or organisation name', () => {
    const slugs = [ticketSlug('abc'), decisionSlug('xyz')].join(' ')
    expect(slugs).not.toMatch(/acme|werth|eyssen|odoo/i)
  })

  it('unknown ticket body falls closed to title', () => {
    expect(parseWikiTicketBody(undefined)).toBe('title')
    expect(parseWikiTicketBody('title')).toBe('title')
    expect(parseWikiTicketBody('latest')).toBe('latest')
    expect(parseWikiTicketBody('transcript')).toBe('transcript')
    expect(parseWikiTicketBody('nope')).toBe('title')
  })
})
