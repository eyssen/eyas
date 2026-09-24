// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createConnectionsTables } from './schema.js'
import { createConnectionsService } from './service.js'
import { createConnectionsRoutes } from './routes.js'
import { createProcessRunner } from '@modules/studio/cli-runner.js'
import type { AdapterContext } from './adapters.js'

/**
 * Connections — first-class inventory of external systems EYAS works with.
 *
 * MCP servers, channel configs, and integration skills remain the transport /
 * how-to layers; this module is the named multi-instance registry (which Odoo,
 * which GitHub org, health, scope, agent-propose + human approve).
 */
export const connectionsModule: EyasModule = {
  id: 'connections',
  name: 'Connections',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'External system connection inventory (catalog, health, propose/approve, agent tools)',
  dependencies: ['secrets', 'tools'],
  optional: ['tools', 'communication', 'security-gate', 'odoo'],

  async onRegister(ctx: ModuleContext) {
    createConnectionsTables(ctx.db)
    try {
      ;(ctx as any).permissions?.registerSubject?.('Connection', {
        actions: ['read', 'create', 'update', 'delete', 'manage'],
        defaults: {
          owner: ['manage'],
          admin: ['read', 'create', 'update', 'delete', 'manage'],
          user: ['read', 'create', 'update'],
          agent: ['read', 'create'],
          guest: [],
        },
      })
    } catch {
      /* already registered */
    }
    ctx.logger.info('Connections module registered')
  },

  async onStart(ctx: ModuleContext) {
    const service = createConnectionsService(ctx.db)
    ;(ctx as any).connections = service

    const getSecrets = () => (ctx.secrets as any) ?? null

    const getAdapterContext = (): AdapterContext => {
      const mcpClient =
        (ctx as any).mcpClient
        ?? (ctx as any).communication?.mcpClient
        ?? null
      return {
        secrets: getSecrets(),
        mcpClient,
        fetchImpl: globalThis.fetch?.bind(globalThis),
        cliRunner: createProcessRunner(),
      }
    }

    const createApproval = (input: {
      category: string
      toolName?: string
      agentId?: string
      conversationId?: string
      inputJson?: string
      preview?: string
      reason?: string
      kind?: string
    }) => {
      const autonomy = (ctx as any).securityGate?.autonomyPolicy
        ?? (ctx as any).autonomyPolicy
      if (!autonomy?.createApproval) {
        throw new Error('Autonomy policy unavailable')
      }
      return autonomy.createApproval(input)
    }

    createConnectionsRoutes(ctx.http, service, {
      getSecrets,
      getAdapterContext,
      createApproval: (input) => createApproval(input),
    })

    // Register agent tools when tools module is present
    try {
      const tools = (ctx as any).tools
      if (tools?.registry) {
        const { createConnectionTools } = await import('./tools.js')
        for (const tool of createConnectionTools({
          getService: () => (ctx as any).connections ?? null,
          getAdapterContext,
          createApproval: (input) => createApproval(input),
        })) {
          if (!tools.registry.has(tool.name)) {
            tools.registry.register(tool)
          }
        }
        ctx.logger.info('Connection tools registered')
      }
    } catch (err) {
      ctx.logger.debug({ err: String(err) }, 'Connection tools registration skipped')
    }

    ctx.logger.info('Connections module started')
  },

  async onStop() {},
}

export { createConnectionsService } from './service.js'
export { listSystemTypes, getSystemType, CONNECTION_CATALOG } from './catalog.js'
export { testConnection } from './adapters.js'
export { createConnectionTools } from './tools.js'
export type { Connection, ConnectionSystemType, CreateConnectionInput } from './types.js'
