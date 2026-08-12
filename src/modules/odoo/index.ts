// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createOdooClient } from './client.js'

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
  dependencies: ['secrets'],
  optional: ['tools'],

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

    if (url && db && username && apiKey) {
      const client = createOdooClient({ url, db, username, apiKey })
      ;(ctx as any).odoo = { client }
      ctx.logger.info('Odoo client configured for %s / %s', url, db)
    } else {
      // Still publish a stub client so tools can return a clear error.
      ;(ctx as any).odoo = { client: createOdooClient(null) }
      ctx.logger.info('Odoo secrets not set — tools will report not configured')
    }

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
