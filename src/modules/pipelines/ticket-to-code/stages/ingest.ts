// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { PipelineDeps } from '../port-types.js'
import type { StageContext, StageResult, TicketContext } from '../types.js'

/**
 * Stage 1 — Ingest.
 *
 * Fetches the ticket from the configured source (the internal board, or
 * manual) and persists it as a `prd`-kind artifact draft. The draft uses the
 * ticket body verbatim; pm-clarify refines it into a proper PRD.
 *
 * Note on artifact kind choice: we reuse the existing `prd` kind as a
 * minimal "ticket context" carrier so we don't have to add a new
 * artifact kind for the raw ingest step. The pm-clarify stage overwrites
 * it with a fully-structured PRD.
 */
export async function runIngestStage(
  deps: PipelineDeps,
  ctx: StageContext,
  ticketSource: string,
  ticketId: string,
): Promise<StageResult & { ticket: TicketContext }> {
  const ticket = await deps.ticketSource.fetchTicket(ticketSource, ticketId)

  // Build a valid PRD payload using the raw ticket. Meets minimums for
  // the existing PrdSchema (problem >= 20 chars, >=1 persona, >=1 metric,
  // >=1 functional requirement).
  const problem = ticket.body?.trim().length >= 20
    ? ticket.body.trim()
    : `Imported ticket ${ticket.id}: ${ticket.title}. (awaiting PM clarification)`

  const payload = {
    problem,
    personas: [
      {
        name: ticket.customer ?? ticket.reporter ?? 'Customer',
        goals: [`Resolution for: ${ticket.title}`],
      },
    ],
    successMetrics: ['Ticket closed with customer sign-off'],
    requirements: {
      functional: [`Address the request described in ticket ${ticket.source}:${ticket.id}`],
    },
    outOfScope: [],
    openQuestions: ['To be refined by pm-clarify'],
  }

  const artifact = deps.artifacts.create({
    sessionId: ctx.sessionId,
    kind: 'prd',
    title: `[Ingest] ${ticket.title}`.slice(0, 200),
    payload,
    producedBy: 'stage:ingest',
    changeNote: `Ingested from ${ticket.source}:${ticket.id}`,
  })

  return {
    artifactId: artifact.id,
    summary: `Ingested ticket ${ticket.source}:${ticket.id} — "${ticket.title}"`,
    ticket,
    metadata: {
      source: ticket.source,
      ticketId: ticket.id,
      title: ticket.title,
    },
  }
}
