// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const installedExtensions = sqliteTable('installed_extensions', {
  id: text('id').primaryKey(),
  version: text('version').notNull(),
  license: text('license').notNull(),
  licenseCompat: text('license_compat').notNull(),
  licenseAcceptedAt: text('license_accepted_at').notNull(),
  installedAt: text('installed_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  enabled: integer('enabled').notNull().default(1),
  installPath: text('install_path').notNull(),
})
