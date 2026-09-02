// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware'
import type { CliRunner } from '@modules/studio/cli-runner.js'
import { doctorBrowserUse } from './doctor.js'
import { normalizeBrowserUseSettings, type BrowserUseSettings } from './settings-store.js'

const settingsPatch = z.object({
  enabled: z.boolean().optional(),
  cliPath: z.string().nullable().optional(),
  allowUvx: z.boolean().optional(),
  allowCloud: z.boolean().optional(),
  agentBrowser: z.object({
    enabled: z.boolean().optional(),
    cliPath: z.string().nullable().optional(),
    allowedDomains: z.array(z.string()).optional(),
  }).optional(),
}).passthrough()

export function createBrowserUseRoutes(
  app: Hono,
  deps: {
    runner: CliRunner
    load(): BrowserUseSettings
    save(s: BrowserUseSettings): void
  },
): void {
  app.get('/api/v1/browser-use/status', requirePermission('read', 'BrowserUse'), async (c) => {
    const status = await doctorBrowserUse(deps.runner, deps.load())
    return c.json(status)
  })

  app.get('/api/v1/browser-use/settings', requirePermission('read', 'BrowserUse'), (c) => {
    return c.json(deps.load())
  })

  app.put('/api/v1/browser-use/settings', requirePermission('manage', 'BrowserUse'), async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = settingsPatch.safeParse(body)
    const current = deps.load()
    const patch = parsed.success ? parsed.data : {}
    const next = normalizeBrowserUseSettings({
      ...current,
      ...patch,
      agentBrowser: {
        ...current.agentBrowser,
        ...(patch.agentBrowser ?? {}),
      },
    })
    deps.save(next)
    return c.json(next)
  })
}
