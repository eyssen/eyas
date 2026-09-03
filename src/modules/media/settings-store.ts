// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import type { MediaSettings } from './types.js'
import { defaultMediaSettings } from './routing.js'

const SETTINGS_ID = 'default'

type SettingsRow = {
  id: string
  json: string
  updated_at: string
}

function parseSettings(raw: string): MediaSettings | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MediaSettings>
    const defaults = defaultMediaSettings()
    return {
      routing: { ...defaults.routing, ...(parsed.routing ?? {}) },
      budget: parsed.budget ?? {},
      expertRawMcpTools: parsed.expertRawMcpTools ?? false,
    }
  } catch {
    return null
  }
}

export function load(db: EyasDb): MediaSettings {
  const row = db.get<SettingsRow>(
    sql`SELECT id, json, updated_at FROM media_settings WHERE id = ${SETTINGS_ID}`,
  )
  if (!row) {
    const settings = defaultMediaSettings()
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO media_settings (id, json, updated_at)
      VALUES (${SETTINGS_ID}, ${JSON.stringify(settings)}, ${now})`)
    return settings
  }

  const parsed = parseSettings(row.json)
  if (!parsed) {
    const settings = defaultMediaSettings()
    save(db, settings)
    return settings
  }
  return parsed
}

export function save(db: EyasDb, settings: MediaSettings): void {
  const now = new Date().toISOString()
  db.run(sql`
    INSERT INTO media_settings (id, json, updated_at)
    VALUES (${SETTINGS_ID}, ${JSON.stringify(settings)}, ${now})
    ON CONFLICT(id) DO UPDATE SET
      json = excluded.json,
      updated_at = excluded.updated_at
  `)
}
