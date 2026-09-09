// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { EyasDb } from '@core/types'
import { defaultAgentBrowserSettings, type AgentBrowserSettingsSlice } from '@shared/agent-browser.js'

export interface BrowserUseSettings {
  enabled: boolean
  cliPath: string | null
  allowUvx: boolean
  allowCloud: boolean
  agentBrowser: AgentBrowserSettingsSlice
}

export function defaultBrowserUseSettings(): BrowserUseSettings {
  return {
    enabled: true,
    cliPath: null,
    allowUvx: true,
    allowCloud: false,
    agentBrowser: defaultAgentBrowserSettings(),
  }
}

export function normalizeBrowserUseSettings(parsed: Partial<BrowserUseSettings> | null | undefined): BrowserUseSettings {
  const base = defaultBrowserUseSettings()
  if (!parsed || typeof parsed !== 'object') return base
  const agent = (parsed.agentBrowser && typeof parsed.agentBrowser === 'object'
    ? parsed.agentBrowser
    : {}) as Partial<AgentBrowserSettingsSlice>
  return {
    enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : base.enabled,
    cliPath: parsed.cliPath === null || typeof parsed.cliPath === 'string' ? parsed.cliPath : base.cliPath,
    allowUvx: typeof parsed.allowUvx === 'boolean' ? parsed.allowUvx : base.allowUvx,
    allowCloud: typeof parsed.allowCloud === 'boolean' ? parsed.allowCloud : base.allowCloud,
    agentBrowser: {
      enabled: typeof agent.enabled === 'boolean' ? agent.enabled : base.agentBrowser.enabled,
      cliPath: agent.cliPath === null || typeof agent.cliPath === 'string' ? agent.cliPath : base.agentBrowser.cliPath,
      allowedDomains: Array.isArray(agent.allowedDomains)
        ? agent.allowedDomains.filter((d): d is string => typeof d === 'string' && d.trim().length > 0).map((d) => d.trim())
        : base.agentBrowser.allowedDomains,
    },
  }
}

export function load(db: EyasDb): BrowserUseSettings {
  const row = db.all<{ json: string }>(sql`SELECT json FROM browser_use_settings WHERE id = 'default'`)[0]
  if (!row?.json) return defaultBrowserUseSettings()
  try {
    return normalizeBrowserUseSettings(JSON.parse(row.json) as Partial<BrowserUseSettings>)
  } catch {
    return defaultBrowserUseSettings()
  }
}

export function save(db: EyasDb, settings: BrowserUseSettings): void {
  const now = new Date().toISOString()
  const next = normalizeBrowserUseSettings(settings)
  db.run(sql`INSERT INTO browser_use_settings (id, json, updated_at)
    VALUES ('default', ${JSON.stringify(next)}, ${now})
    ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`)
}
