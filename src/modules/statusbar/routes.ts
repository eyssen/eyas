// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import type { EyasConfig, EyasDb } from '@core/types'
import { buildSnapshot } from './segments.js'

export function createStatusbarRoutes(app: Hono, db: EyasDb, config: EyasConfig): void {
  // No auth/CSRF here: the global /api/v1/* gate in auth/routes.ts already
  // requires an authenticated session for every non-allowlisted route.
  app.get('/api/v1/statusbar', (c) => {
    return c.json({ snapshot: buildSnapshot(db, config) })
  })
}
