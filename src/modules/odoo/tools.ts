// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation } from '@modules/tools/types.js'
import type { OdooClient } from './client.js'
import {
  citeOdooSrc,
  resolveConfiguredRoots,
  searchOdooFields,
  searchOdooModels,
  searchOdooXmlIds,
} from './source-index.js'

export interface OdooService {
  client: OdooClient
  /** Optional local checkout roots for source indexing */
  sourceRoots?: string[]
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

/**
 * Local Odoo source tools — model/field/XML-ID search against configured
 * checkout roots. Roots resolve from:
 *  1. Explicit labels/sourceIds/version on the tool call
 *  2. Conversation search_context pin (via search.resolveContext)
 *  3. Search sources with family=odoo
 *  4. EYAS_ODOO_SOURCE_PATHS / service.sourceRoots
 */
export function createOdooSourceTools(
  getService: () => OdooService | null | undefined,
  getSearch?: () => any,
): ToolImplementation[] {
  async function resolveRoots(
    ctx: import('@modules/tools/types.js').ToolContext | undefined,
    input: Record<string, unknown>,
  ): Promise<{ roots: import('./source-index.js').OdooRoot[]; reason: string; needsPin?: boolean; available?: unknown }> {
    const search = getSearch?.()
    const explicit = {
      sourceIds: Array.isArray(input.sourceIds) ? (input.sourceIds as string[]) : undefined,
      labels: Array.isArray(input.labels) ? (input.labels as string[]) : undefined,
      version: input.version as string | undefined,
      edition: input.edition as string | undefined,
      label: input.label as string | undefined,
    }
    // Normalize single label → labels[]
    if (explicit.label && !explicit.labels?.length) {
      explicit.labels = [explicit.label]
    }

    if (search?.resolveContext) {
      const pin = search.resolveContext.resolve({
        conversationId: ctx?.conversationId,
        explicit: {
          sourceIds: explicit.sourceIds,
          labels: explicit.labels,
          version: explicit.version,
          edition: explicit.edition,
        },
      })
      if (pin.needsPin && pin.roots.length === 0) {
        return {
          roots: [],
          reason: pin.reason,
          needsPin: true,
          available: pin.available,
        }
      }
      if (pin.roots.length) {
        const labeled = pin.sources.map((s: any) => ({
          path: (s.config?.paths?.[0] as string) ?? '',
          label: (s.config?.label as string) || s.name,
        })).filter((r: { path: string }) => r.path)
        // Prefer labeled roots from sources; fall back to pin.roots
        if (labeled.length) {
          return { roots: labeled, reason: pin.reason }
        }
        return {
          roots: pin.roots.map((p: string) => ({
            path: p,
            label: p.replace(/\/+$/, '').split('/').pop(),
          })),
          reason: pin.reason,
        }
      }
    }

    const svc = getService()
    const paths = await resolveConfiguredRoots(undefined, svc?.sourceRoots)
    return {
      roots: paths.map((p) => ({ path: p, label: p.replace(/\/+$/, '').split('/').pop() })),
      reason: 'EYAS_ODOO_SOURCE_PATHS / sourceRoots',
    }
  }

  const versionProps = {
    label: { type: 'string', description: 'Source label filter (e.g. 18c)' },
    labels: {
      type: 'array',
      items: { type: 'string' },
      description: 'Multiple labels (e.g. ["18c","eyssen-erp"])',
    },
    sourceIds: {
      type: 'array',
      items: { type: 'string' },
      description: 'Search source IDs (from list_search_sources)',
    },
    version: { type: 'string', description: 'Version filter (e.g. "18")' },
    edition: { type: 'string', description: 'Edition filter (e.g. "community")' },
  }

  return [
    {
      name: 'odoo_search_model',
      description:
        'Search local Odoo source checkouts for _name / _inherit model definitions. ' +
        'Uses conversation search pin (set_search_context) or labels/version/sourceIds. ' +
        'Also EYAS_ODOO_SOURCE_PATHS / Search Sources with family=odoo. ' +
        'Cite as [source:odoo-src:label:file:line].',
      category: 'search',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Model name fragment (e.g. sale.order)' },
          limit: { type: 'number' },
          ...versionProps,
        },
        required: ['query'],
      },
      execute: async (input, ctx) => {
        const { roots, reason, needsPin, available } = await resolveRoots(ctx, input)
        if (needsPin) {
          return {
            error: 'Multiple Odoo versions indexed — pin with set_search_context or pass labels/sourceIds.',
            needsPin: true,
            available,
            reason,
          }
        }
        if (!roots.length) {
          return {
            error:
              'No Odoo source roots. Register Search Sources (family=odoo), set conversation pin, ' +
              'or EYAS_ODOO_SOURCE_PATHS / EYAS_ODOO_SOURCES_JSON.',
          }
        }
        const hits = await searchOdooModels(roots, String(input.query ?? ''), (input.limit as number) ?? 30)
        return {
          roots: roots.map((r) => ({ path: r.path, label: r.label })),
          reason,
          count: hits.length,
          models: hits.map((h) => ({ ...h, ...citeOdooSrc(h) })),
        }
      },
    },
    {
      name: 'odoo_search_field',
      description:
        'Search local Odoo Python sources for fields.X assignments. Optional model filter. ' +
        'Respects conversation pin / labels. Cite as [source:odoo-src:label:file:line].',
      category: 'search',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Field name fragment' },
          model: { type: 'string', description: 'Optional model name to narrow the search' },
          limit: { type: 'number' },
          ...versionProps,
        },
        required: ['query'],
      },
      execute: async (input, ctx) => {
        const { roots, reason, needsPin, available } = await resolveRoots(ctx, input)
        if (needsPin) {
          return { error: 'Pin Odoo version first (set_search_context).', needsPin: true, available, reason }
        }
        if (!roots.length) {
          return { error: 'No Odoo source roots configured.' }
        }
        const hits = await searchOdooFields(roots, String(input.query ?? ''), {
          model: input.model as string | undefined,
          limit: (input.limit as number) ?? 40,
        })
        return {
          reason,
          count: hits.length,
          fields: hits.map((h) => ({ ...h, ...citeOdooSrc(h) })),
        }
      },
    },
    {
      name: 'odoo_search_xml_id',
      description:
        'Search local Odoo XML files for record ids / xml ids. ' +
        'Respects conversation pin / labels. Cite as [source:odoo-src:label:file:line].',
      category: 'search',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'XML id fragment' },
          limit: { type: 'number' },
          ...versionProps,
        },
        required: ['query'],
      },
      execute: async (input, ctx) => {
        const { roots, reason, needsPin, available } = await resolveRoots(ctx, input)
        if (needsPin) {
          return { error: 'Pin Odoo version first (set_search_context).', needsPin: true, available, reason }
        }
        if (!roots.length) {
          return { error: 'No Odoo source roots configured.' }
        }
        const hits = await searchOdooXmlIds(roots, String(input.query ?? ''), (input.limit as number) ?? 30)
        return {
          reason,
          count: hits.length,
          xmlIds: hits.map((h) => ({ ...h, ...citeOdooSrc(h) })),
        }
      },
    },
  ]
}
