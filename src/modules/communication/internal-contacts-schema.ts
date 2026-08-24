// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const internalContacts = sqliteTable('internal_contacts', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  channelType: text('channel_type', {
    enum: ['web', 'telegram', 'email', 'odoo-chatter', 'hand-companion', 'slack', 'discord'],
  }).notNull(),
  displayName: text('display_name').notNull(),
  role: text('role', { enum: ['owner', 'team-member'] }).notNull(),
  // 'internal' is the only allowed value: this table only stores internal contacts.
  // External parties are not tracked here; field is reserved for future expansion.
  scope: text('scope', { enum: ['internal'] }).notNull().default('internal'),
  notes: text('notes'),
  addedAt: text('added_at').notNull(),
  addedBy: text('added_by').notNull(),
}, (t) => ({
  identByChannel: uniqueIndex('internal_contacts_ident_channel').on(t.identifier, t.channelType),
}))
