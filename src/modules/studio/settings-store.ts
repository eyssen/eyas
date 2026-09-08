// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { HYPERFRAMES_VERSION_PIN } from './types.js'

export interface StudioSettings {
  hyperframes: {
    enabled: boolean
    cliPath: string | null
    versionPin: string
    allowNpx: boolean
  }
  videouse: {
    enabled: boolean
  }
}

export function defaultStudioSettings(): StudioSettings {
  return {
    hyperframes: {
      enabled: true,
      cliPath: null,
      versionPin: HYPERFRAMES_VERSION_PIN,
      allowNpx: true,
    },
    videouse: {
      enabled: true,
    },
  }
}

export function load(db: EyasDb): StudioSettings {
  const row = db.all<{ json: string }>(sql`SELECT json FROM studio_settings WHERE id = 'default'`)[0]
  if (!row?.json) return defaultStudioSettings()
  try {
    const parsed = JSON.parse(row.json) as Partial<StudioSettings>
    const defaults = defaultStudioSettings()
    return {
      hyperframes: {
        ...defaults.hyperframes,
        ...(parsed.hyperframes ?? {}),
      },
      videouse: {
        ...defaults.videouse,
        ...(parsed.videouse ?? {}),
      },
    }
  } catch {
    return defaultStudioSettings()
  }
}

export function save(db: EyasDb, settings: StudioSettings): void {
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO studio_settings (id, json, updated_at)
    VALUES ('default', ${JSON.stringify(settings)}, ${now})
    ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`)
}
