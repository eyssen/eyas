// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation } from '@modules/tools/types.js'
import type { OdooClient } from './client.js'

export interface OdooService {
  client: OdooClient
}

/**
 * Read-heavy Odoo tools for ticket/support workflows.
 * Write paths (stage change, chatter) are yellow/red and go through the security gate.
 */
export function createOdooTools(getService: () => OdooService | null | undefined): ToolImplementation[] {
  const client = () => {
    const svc = getService()
    if (!svc?.client?.configured) {
      return null
    }
    return svc.client
  }

  return [
    {
      name: 'odoo_search_tasks',
      description:
        'Search Odoo project.task (or helpdesk.ticket) records. Read-only. Returns id, name, stage, partner, description snippet.',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name/description search string' },
          model: {
            type: 'string',
            description: 'Odoo model (default project.task)',
            enum: ['project.task', 'helpdesk.ticket'],
          },
          stage: { type: 'string', description: 'Optional stage name filter' },
          limit: { type: 'number', description: 'Max rows (default 20)' },
        },
      },
      execute: async (input) => {
        const c = client()
        if (!c) return { error: 'Odoo is not configured — set odoo-* secrets and enable the odoo module' }

        const model = (input.model as string) || 'project.task'
        const limit = (input.limit as number) ?? 20
        const domain: unknown[] = []
        if (input.query) {
          domain.push('|', ['name', 'ilike', input.query], ['description', 'ilike', input.query])
        }
        if (input.stage) {
          domain.push(['stage_id.name', 'ilike', input.stage])
        }

        const fields =
          model === 'helpdesk.ticket'
            ? ['id', 'name', 'stage_id', 'partner_id', 'description', 'priority', 'create_date']
            : ['id', 'name', 'stage_id', 'partner_id', 'description', 'user_id', 'date_deadline', 'project_id']

        const rows = await c.searchRead(model, domain, fields, { limit, order: 'write_date desc' })
        return {
          model,
          count: rows.length,
          tasks: rows.map((r) => ({
            id: r.id,
            name: r.name,
            stage: Array.isArray(r.stage_id) ? r.stage_id[1] : r.stage_id,
            partner: Array.isArray(r.partner_id) ? r.partner_id[1] : r.partner_id,
            description: typeof r.description === 'string' ? r.description.slice(0, 500) : null,
            citationId: `odoo:${model}:${r.id}`,
            cite: `[source:odoo:${model}:${r.id}]`,
          })),
        }
      },
    },
    {
      name: 'odoo_get_task',
      description: 'Fetch a single Odoo task/ticket by id with full description. Cite as [source:odoo:<model>:<id>].',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Record id' },
          model: { type: 'string', enum: ['project.task', 'helpdesk.ticket'] },
        },
        required: ['id'],
      },
      execute: async (input) => {
        const c = client()
        if (!c) return { error: 'Odoo is not configured' }
        const model = (input.model as string) || 'project.task'
        const rows = await c.read(model, [input.id as number])
        if (!rows.length) return { error: `Record not found: ${model}#${input.id}` }
        const r = rows[0]
        return {
          task: r,
          citationId: `odoo:${model}:${r.id}`,
          cite: `[source:odoo:${model}:${r.id}]`,
        }
      },
    },
    {
      name: 'odoo_message_post',
      description:
        'Post a chatter message on an Odoo task/ticket. Does NOT change stage. Requires approval when autonomy is gated.',
      category: 'custom',
      riskTier: 'yellow',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Record id' },
          body: { type: 'string', description: 'Message body (HTML or plain text)' },
          model: { type: 'string', enum: ['project.task', 'helpdesk.ticket'] },
        },
        required: ['id', 'body'],
      },
      execute: async (input) => {
        const c = client()
        if (!c) return { error: 'Odoo is not configured' }
        const model = (input.model as string) || 'project.task'
        const messageId = await c.messagePost(model, input.id as number, input.body as string)
        return { ok: true, messageId, model, id: input.id }
      },
    },
    {
      name: 'odoo_write_task',
      description:
        'Write fields on an Odoo task (e.g. stage_id, description). Destructive — red tier, always approval-gated.',
      category: 'custom',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          values: { type: 'object', description: 'Field map to write' },
          model: { type: 'string', enum: ['project.task', 'helpdesk.ticket'] },
        },
        required: ['id', 'values'],
      },
      execute: async (input) => {
        const c = client()
        if (!c) return { error: 'Odoo is not configured' }
        const model = (input.model as string) || 'project.task'
        const ok = await c.write(model, [input.id as number], input.values as Record<string, unknown>)
        return { ok, model, id: input.id }
      },
    },
  ]
}
