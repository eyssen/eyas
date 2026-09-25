// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * General slug templates for auto-maintained project wiki pages.
 * The wiki row is already scoped by project id (`client_id`); the slug must
 * not repeat a tenant, client, or organisation name.
 */

function sanitizeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'untitled'
}

export function ticketSlug(ticketId: string): string {
  return `ticket-${sanitizeId(ticketId)}`
}

export function decisionSlug(sourceId: string): string {
  return `decision-${sanitizeId(sourceId)}`
}

export const WIKI_TICKET_BODIES = ['title', 'latest', 'transcript'] as const
export type WikiTicketBody = (typeof WIKI_TICKET_BODIES)[number]

export interface WikiProjectSettings {
  wikiAutoTickets: boolean
  wikiAutoDecisions: boolean
  wikiTicketBody: WikiTicketBody
}

/** Unknown or missing values fail closed to title-only — never dump a transcript by accident. */
export function parseWikiTicketBody(raw: unknown): WikiTicketBody {
  return raw === 'latest' || raw === 'transcript' ? raw : 'title'
}
