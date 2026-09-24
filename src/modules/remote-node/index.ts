// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { createNodeRegistry } from './registry.js'

export const remoteNodeModule: EyasModule = {
  id: 'remote-node',
  name: 'Remote Node',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Registry for remote machines with SSH/WebSocket/Tailscale connectivity',
  dependencies: [],

  async onRegister(ctx: ModuleContext) {
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS remote_nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      connection_type TEXT NOT NULL DEFAULT 'ssh',
      capabilities TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'offline',
      last_seen TEXT,
      config TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)

    ctx.logger.info('Remote Node module registered')
  },

  async onStart(ctx: ModuleContext) {
    const registry = createNodeRegistry(ctx.db)
    ;(ctx as any).remoteNodes = registry

    const { createRemoteNodeRoutes } = await import('./routes.js')
    createRemoteNodeRoutes(ctx.http, registry, ctx.logger)
    ctx.logger.info('Remote Node module started')
  },

  async onStop() {},
}
