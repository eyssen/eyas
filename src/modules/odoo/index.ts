// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createOdooClient, type OdooClient } from './client.js'
import { createOdooClientFromConnection } from './connection-client.js'

/**
 * Optional Odoo integration — ticket read/write tools for support workflows.
 * Off until secrets are present; never couples core board/pipelines to Odoo.
 */
export const odooModule: EyasModule = {
  id: 'odoo',
  name: 'Odoo Integration',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Odoo JSON-RPC client + ticket tools (project.task / helpdesk.ticket)',
  dependencies: ['secrets', 'tools'],
  optional: ['tools', 'board', 'connections'],

  async onRegister(ctx: ModuleContext) {
    ;(ctx as any).odoo = { client: createOdooClient(null) }
    ctx.logger.info('Odoo module registered (client pending secrets)')
  },

  async onStart(ctx: ModuleContext) {
    // Prefer secrets; fall back to env for headless deploy.
    const get = async (key: string, envKey: string) => {
      try {
        const v = await ctx.secrets.get(key, 'system')
        if (v) return v
      } catch { /* */ }
      return process.env[envKey] ?? null
    }

    const url = await get('odoo-url', 'EYAS_ODOO_URL')
    const db = await get('odoo-db', 'EYAS_ODOO_DB')
    const username = await get('odoo-username', 'EYAS_ODOO_USERNAME')
    const apiKey = await get('odoo-api-key', 'EYAS_ODOO_API_KEY')

    const globalClient = url && db && username && apiKey
      ? createOdooClient({ url, db, username, apiKey })
      : createOdooClient(null)
    if (globalClient.configured) {
      ctx.logger.info('Odoo client configured for %s / %s', url, db)
    } else {
      ctx.logger.info('Odoo secrets not set — tools will report not configured unless a project connection is set')
    }

    const clientCache = new Map<string, OdooClient>()

    function getProjectConnections(projectId: string) {
      const project = (ctx as any).board?.projects?.get(projectId)
      if (!project) return null
      return {
        defaultConnectionId: project.defaultConnectionId ?? null,
        ticketConnectionId: project.ticketConnectionId ?? null,
      }
    }

    async function getClientForConnection(connectionId: string): Promise<OdooClient | null> {
      const cached = clientCache.get(connectionId)
      if (cached) return cached
      const conn = (ctx as any).connections?.get(connectionId)
      if (!conn) return null
      const secrets = ctx.secrets as { get: (name: string, scope: string, requester?: unknown) => Promise<string | null> } | undefined
      if (!secrets) return null
      const client = await createOdooClientFromConnection(conn, secrets)
      if (client?.configured) clientCache.set(connectionId, client)
      return client
    }

    ;(ctx as any).odoo = { client: globalClient, getProjectConnections, getClientForConnection }

    // Register tools after tools module is up (lazy import; optional).
    try {
      const tools = (ctx as any).tools
      if (tools?.registry) {
        const { createOdooTools, createOdooSourceTools } = await import('./tools.js')
        const getOdoo = () => (ctx as any).odoo
        for (const tool of createOdooTools(getOdoo)) {
          if (!tools.registry.has(tool.name)) tools.registry.register(tool)
        }
        for (const tool of createOdooSourceTools(getOdoo, () => (ctx as any).search)) {
          if (!tools.registry.has(tool.name)) tools.registry.register(tool)
        }
        ctx.logger.info('Odoo tools registered on tool registry (live + source index)')
      }
    } catch (err) {
      ctx.logger.debug({ err: String(err) }, 'Odoo tools registration skipped')
    }
  },

  async onStop() {},
}

export { createOdooClient } from './client.js'
export { createOdooTools, createOdooSourceTools } from './tools.js'
export { resolveOdooConnectionId } from './connection-resolve.js'
