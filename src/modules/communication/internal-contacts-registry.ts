// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '../../core/types.js'

export type ContactRole = 'owner' | 'team-member'
export type ChannelType = 'web' | 'telegram' | 'email' | 'odoo-chatter' | 'hand-companion' | 'slack' | 'discord'

export interface InternalContact {
  id: string
  identifier: string
  channelType: ChannelType
  displayName: string
  role: ContactRole
  notes: string | null
  addedAt: string
  addedBy: string
}

export interface InternalContactsRegistry {
  add(input: { identifier: string; channelType: ChannelType; displayName: string; role: ContactRole; notes?: string; addedBy: string }): Promise<InternalContact>
  remove(id: string): Promise<boolean>
  lookup(identifier: string, channelType: ChannelType): Promise<InternalContact | null>
  list(): Promise<InternalContact[]>
  isInternal(identifier: string, channelType: ChannelType): Promise<boolean>
}

interface ContactRow {
  id: string
  identifier: string
  channel_type: ChannelType
  display_name: string
  role: ContactRole
  notes: string | null
  added_at: string
  added_by: string
}

function rowToContact(r: ContactRow): InternalContact {
  return {
    id: r.id,
    identifier: r.identifier,
    channelType: r.channel_type,
    displayName: r.display_name,
    role: r.role,
    notes: r.notes,
    addedAt: r.added_at,
    addedBy: r.added_by,
  }
}

export function createInternalContactsRegistry(db: EyasDb): InternalContactsRegistry {
  return {
    async add(input) {
      const id = `ic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const addedAt = new Date().toISOString()
      db.run(sql`INSERT INTO internal_contacts (id, identifier, channel_type, display_name, role, scope, notes, added_at, added_by)
        VALUES (${id}, ${input.identifier}, ${input.channelType}, ${input.displayName}, ${input.role}, 'internal', ${input.notes ?? null}, ${addedAt}, ${input.addedBy})`)
      return {
        id,
        identifier: input.identifier,
        channelType: input.channelType,
        displayName: input.displayName,
        role: input.role,
        notes: input.notes ?? null,
        addedAt,
        addedBy: input.addedBy,
      }
    },

    async remove(id) {
      // db.all returns named-column objects; db.get returns positional array in bun-sqlite
      const rows = db.all<{ c: number }>(sql`SELECT COUNT(*) AS c FROM internal_contacts WHERE id = ${id}`)
      const count = rows[0]?.c ?? 0
      db.run(sql`DELETE FROM internal_contacts WHERE id = ${id}`)
      return count > 0
    },

    async lookup(identifier, channelType) {
      // Use db.all with LIMIT 1 — db.get returns a positional array in bun-sqlite, not a named object
      const rows = db.all<ContactRow>(sql`SELECT * FROM internal_contacts WHERE identifier = ${identifier} AND channel_type = ${channelType} LIMIT 1`)
      return rows.length > 0 ? rowToContact(rows[0]) : null
    },

    async list() {
      const rows = db.all<ContactRow>(sql`SELECT * FROM internal_contacts ORDER BY added_at ASC`)
      return rows.map(rowToContact)
    },

    async isInternal(identifier, channelType) {
      const rows = db.all<{ id: string }>(sql`SELECT id FROM internal_contacts WHERE identifier = ${identifier} AND channel_type = ${channelType} LIMIT 1`)
      return rows.length > 0
    },
  }
}
