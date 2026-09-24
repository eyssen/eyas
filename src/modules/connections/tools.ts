// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation, ToolContext } from '@modules/tools/types.js'
import { listSystemTypes } from './catalog.js'
import { testConnection, type AdapterContext } from './adapters.js'
import type { ConnectionsService } from './service.js'

export function createConnectionTools(deps: {
  getService: () => ConnectionsService | null
  getAdapterContext: () => AdapterContext
  createApproval?: (input: {
    category: string
    toolName?: string
    agentId?: string
    conversationId?: string
    inputJson?: string
    preview?: string
    reason?: string
    kind?: string
  }) => number
}): ToolImplementation[] {
  return [
    {
      name: 'connections_list',
      description:
        'List external system connections EYAS may use (Odoo, GitHub, MCP, etc.). Filter by systemType or status. Does not return secrets — only names, status, and config metadata.',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          systemType: {
            type: 'string',
            description: 'Filter by catalog id (odoo, github, mcp, …)',
          },
          status: {
            type: 'string',
            enum: ['pending', 'disabled', 'connected', 'error', 'unknown'],
          },
          includePending: {
            type: 'boolean',
            description: 'Include agent-proposed pending connections (default false for agents)',
          },
        },
      },
      execute: async (input, ctx?: ToolContext) => {
        const service = deps.getService()
        if (!service) return { ok: false, error: 'Connections module not available' }
        const connections = service.list({
          systemType: input.systemType as string | undefined,
          status: input.status as any,
          includePending: input.includePending === true,
          agentId: ctx?.agentId,
          projectId: undefined,
        })
        return {
          ok: true,
          count: connections.length,
          connections: connections.map((c) => ({
            id: c.id,
            name: c.name,
            systemType: c.systemType,
            adapter: c.adapter,
            status: c.status,
            config: c.config,
            scope: c.scope,
            health: c.health,
            source: c.source,
            reason: c.reason,
          })),
        }
      },
    },
    {
      name: 'connections_catalog',
      description:
        'List known external system types that can be registered as connections (fields, adapters, setup hints). Use before proposing a new connection.',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        const systems = listSystemTypes().map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          adapter: s.adapter,
          category: s.category,
          configFields: s.configFields.map((f) => ({ name: f.name, required: f.required, label: f.label })),
          secretFields: s.secretFields.map((f) => ({ name: f.name, required: f.required, label: f.label })),
          skillName: s.skillName,
          tags: s.tags,
        }))
        return { ok: true, systems }
      },
    },
    {
      name: 'connections_test',
      description:
        'Run a health check on an existing connection (Odoo auth, GitHub /user, MCP status, etc.). Updates stored status.',
      category: 'custom',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          connectionId: { type: 'string', description: 'Connection id from connections_list' },
        },
        required: ['connectionId'],
      },
      execute: async (input) => {
        const service = deps.getService()
        if (!service) return { ok: false, error: 'Connections module not available' }
        const conn = service.get(String(input.connectionId))
        if (!conn) return { ok: false, error: 'Connection not found' }
        const result = await testConnection(service, conn, deps.getAdapterContext())
        return { ok: result.ok, result, connection: service.get(conn.id) }
      },
    },
    {
      name: 'connections_propose',
      description:
        'Propose a new external system connection for human approval. Creates a pending inventory entry; the owner must approve under Settings → Connections (and optionally Autonomy). Do NOT put secret values in chat logs — pass them only in the secrets map so they go to the vault. Prefer proposing over inventing ad-hoc credentials.',
      category: 'custom',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Human label, e.g. "Odoo eyssen prod"' },
          systemType: {
            type: 'string',
            description: 'Catalog id from connections_catalog (odoo, github, mcp, …)',
          },
          config: {
            type: 'object',
            description: 'Non-secret config (url, db, org, mcpServerId, …)',
          },
          secrets: {
            type: 'object',
            description: 'Map of catalog secret field → value (stored in vault, never on the connection row)',
            additionalProperties: { type: 'string' },
          },
          secretRefs: {
            type: 'array',
            items: { type: 'string' },
            description: 'Existing vault secret names to bind (instead of secrets map)',
          },
          reason: {
            type: 'string',
            description: 'Why this connection is needed — shown to the approver',
          },
          scope: {
            type: 'object',
            description: 'Optional agent/project scope',
            properties: {
              default: { type: 'boolean' },
              agentIds: { type: 'array', items: { type: 'string' } },
              projectIds: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        required: ['name', 'systemType', 'reason'],
      },
      execute: async (input, ctx?: ToolContext) => {
        const service = deps.getService()
        if (!service) return { ok: false, error: 'Connections module not available' }

        // Dedupe by name + systemType pending
        const existing = service.list({ includePending: true, systemType: String(input.systemType) })
          .find((c) => c.name.toLowerCase() === String(input.name).toLowerCase())
        if (existing) {
          return {
            ok: true,
            alreadyExists: true,
            pending: existing.status === 'pending',
            connectionId: existing.id,
            status: existing.status,
            message: existing.status === 'pending'
              ? `Proposal "${existing.name}" already pending approval (id ${existing.id}). Ask the user to approve it in Settings → Connections.`
              : `Connection "${existing.name}" already exists (id ${existing.id}, status ${existing.status}).`,
          }
        }

        try {
          let connection = await service.create(
            {
              name: String(input.name),
              systemType: String(input.systemType),
              config: (input.config as Record<string, unknown>) ?? {},
              secrets: input.secrets as Record<string, string> | undefined,
              secretRefs: input.secretRefs as string[] | undefined,
              scope: input.scope as any,
              source: 'agent',
              pending: true,
              reason: String(input.reason),
              createdBy: ctx?.agentId ?? ctx?.userId ?? undefined,
            },
            { secrets: deps.getAdapterContext().secrets ?? undefined },
          )

          let approvalId: number | null = null
          if (deps.createApproval) {
            try {
              const id = deps.createApproval({
                category: 'connection',
                toolName: 'connections_propose',
                agentId: ctx?.agentId,
                conversationId: ctx?.conversationId,
                inputJson: JSON.stringify({ connectionId: connection.id, systemType: connection.systemType }),
                preview: `Approve connection "${connection.name}" (${connection.systemType})`,
                reason: String(input.reason),
                kind: 'connection_propose',
              })
              if (typeof id === 'number' && id > 0) {
                approvalId = id
                connection = service.setApprovalId(connection.id, id)
              }
            } catch {
              approvalId = null
            }
          }

          return {
            ok: true,
            pending: true,
            connectionId: connection.id,
            approvalId,
            message: `Connection "${connection.name}" proposed and waiting for approval. Tell the user to open Settings → Connections.`,
          }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      },
    },
  ]
}
