// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto.js'

export type ChannelMode = 'managed' | 'autonomous'

export interface ChannelConfig {
  id: string
  channelType: string
  channelId: string
  name: string
  agentId: string | null
  /** 'managed' (security gate governs each tool) | 'autonomous' (ladder-gated). */
  mode: ChannelMode
  enabled: boolean
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

function rowToConfig(r: any): ChannelConfig {
  return {
    id: r.id,
    channelType: r.channel_type,
    channelId: r.channel_id,
    name: r.name,
    agentId: r.agent_id ?? null,
    mode: r.mode === 'autonomous' ? 'autonomous' : 'managed',
    enabled: r.enabled === 1,
    config: r.config ? JSON.parse(r.config) : {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function createChannelConfigService(db: any) {
  return {
    upsert(input: { channelType: string; channelId: string; name: string; agentId?: string | null }) {
      const now = new Date().toISOString()
      const existing = this.getByChannelId(input.channelId)
      if (existing) {
        db.run(
          sql`UPDATE channel_configs SET agent_id = ${input.agentId ?? null}, name = ${input.name}, updated_at = ${now} WHERE channel_id = ${input.channelId}`,
        )
      } else {
        const id = generateId()
        db.run(
          sql`INSERT INTO channel_configs (id, channel_type, channel_id, name, agent_id, enabled, config, created_at, updated_at) VALUES (${id}, ${input.channelType}, ${input.channelId}, ${input.name}, ${input.agentId ?? null}, 1, '{}', ${now}, ${now})`,
        )
      }
    },

    /**
     * Ensure a config row exists for a registered channel WITHOUT clobbering an
     * existing binding (agent/mode). Called on startup for every registered
     * channel so the bindings UI lists them and PATCH /channels/:id can target
     * them. No-op when the row already exists.
     */
    ensureChannel(input: { channelType: string; channelId: string; name: string }) {
      if (this.getByChannelId(input.channelId)) return
      const now = new Date().toISOString()
      const id = generateId()
      db.run(
        sql`INSERT INTO channel_configs (id, channel_type, channel_id, name, agent_id, enabled, config, mode, created_at, updated_at)
            VALUES (${id}, ${input.channelType}, ${input.channelId}, ${input.name}, ${null}, 1, '{}', 'managed', ${now}, ${now})`,
      )
    },

    getByChannelId(channelId: string): ChannelConfig | null {
      const rows = (db as any).all(
        sql`SELECT * FROM channel_configs WHERE channel_id = ${channelId}`,
      ) as any[]
      return rows.length > 0 ? rowToConfig(rows[0]) : null
    },

    list(): ChannelConfig[] {
      return (
        (db as any).all(sql`SELECT * FROM channel_configs ORDER BY name ASC`) as any[]
      ).map(rowToConfig)
    },

    updateAgent(channelId: string, agentId: string | null) {
      const now = new Date().toISOString()
      db.run(
        sql`UPDATE channel_configs SET agent_id = ${agentId}, updated_at = ${now} WHERE channel_id = ${channelId}`,
      )
    },

    updateMode(channelId: string, mode: ChannelMode) {
      const now = new Date().toISOString()
      db.run(
        sql`UPDATE channel_configs SET mode = ${mode}, updated_at = ${now} WHERE channel_id = ${channelId}`,
      )
    },

    updateName(channelId: string, name: string) {
      const now = new Date().toISOString()
      db.run(
        sql`UPDATE channel_configs SET name = ${name}, updated_at = ${now} WHERE channel_id = ${channelId}`,
      )
    },

    /**
     * Create a new instance row with an explicit channel_id (multi-instance).
     * Throws if channel_id already exists.
     */
    createInstance(input: {
      channelType: string
      channelId: string
      name: string
      agentId?: string | null
      mode?: ChannelMode
      config?: Record<string, unknown>
    }): ChannelConfig {
      if (this.getByChannelId(input.channelId)) {
        throw new Error(`Channel instance already exists: ${input.channelId}`)
      }
      const now = new Date().toISOString()
      const id = generateId()
      const mode = input.mode === 'autonomous' ? 'autonomous' : 'managed'
      const configJson = JSON.stringify(input.config ?? {})
      db.run(
        sql`INSERT INTO channel_configs (id, channel_type, channel_id, name, agent_id, enabled, config, mode, created_at, updated_at)
            VALUES (${id}, ${input.channelType}, ${input.channelId}, ${input.name}, ${input.agentId ?? null}, 1, ${configJson}, ${mode}, ${now}, ${now})`,
      )
      return this.getByChannelId(input.channelId)!
    },

    deleteByChannelId(channelId: string): boolean {
      if (!this.getByChannelId(channelId)) return false
      db.run(sql`DELETE FROM channel_configs WHERE channel_id = ${channelId}`)
      return true
    },

    updateConfig(channelId: string, config: Record<string, unknown>) {
      const now = new Date().toISOString()
      db.run(
        sql`UPDATE channel_configs SET config = ${JSON.stringify(config)}, updated_at = ${now} WHERE channel_id = ${channelId}`,
      )
    },

    /** All rows for messaging types (excludes accidental junk if any). */
    listByTypes(types: string[]): ChannelConfig[] {
      return this.list().filter((c) => types.includes(c.channelType))
    },
  }
}
