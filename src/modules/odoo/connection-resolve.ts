// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Pick which Odoo connection a tool call should use.
 *
 * Ticket tools (get/search/post/write task) go to the project's ticket
 * connection. Everything else (including `odoo_execute`, once it lands)
 * goes to the project's default connection. An explicit `connectionId` always
 * wins. Missing ids stay null so the caller can fall back to global secrets.
 */

export type OdooConnectionPurpose = 'ticket' | 'execute'

export interface ProjectOdooConnections {
  defaultConnectionId?: string | null
  ticketConnectionId?: string | null
}

const TICKET_ODOO_TOOLS = new Set([
  'odoo_get_task',
  'odoo_search_tasks',
  'odoo_message_post',
  'odoo_write_task',
])

export function purposeForOdooTool(toolName: string): OdooConnectionPurpose {
  return TICKET_ODOO_TOOLS.has(toolName) ? 'ticket' : 'execute'
}

function nonempty(id: string | null | undefined): string | null {
  const trimmed = id?.trim()
  return trimmed ? trimmed : null
}

export function resolveOdooConnectionId(opts: {
  toolName: string
  explicitConnectionId?: string | null
  project?: ProjectOdooConnections | null
}): string | null {
  const explicit = nonempty(opts.explicitConnectionId)
  if (explicit) return explicit

  const project = opts.project
  if (!project) return null

  if (purposeForOdooTool(opts.toolName) === 'ticket') {
    return nonempty(project.ticketConnectionId) ?? nonempty(project.defaultConnectionId)
  }
  return nonempty(project.defaultConnectionId)
}
