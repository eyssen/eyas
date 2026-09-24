// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import type { EyasModule, ModuleContext } from '@core/types'

/**
 * @deprecated Use the forge module instead. This module is kept only for backward compatibility.
 */
export const skillEvolutionModule: EyasModule = {
  id: 'skill-evolution',
  name: 'Skill Evolution (Deprecated)',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'DEPRECATED — use forge module instead',
  dependencies: ['conversations'],
  optional: ['skills', 'scheduler'],

  async onRegister(ctx: ModuleContext) {
    ctx.logger.warn('skill-evolution module is deprecated — use forge module instead')
  },

  async onStart(ctx: ModuleContext) {
    // Redirect old endpoint to forge
    const api = new Hono()
    api.get('/skill-evolution/candidates', (c) => {
      return c.redirect('/api/v1/forge/proposals', 301)
    })
    api.get('/skill-evolution/candidates/:id', (c) => {
      return c.redirect('/api/v1/forge/proposals', 301)
    })
    api.post('/skill-evolution/candidates/:id/approve', (c) => {
      return c.redirect('/api/v1/forge/proposals', 301)
    })
    api.post('/skill-evolution/candidates/:id/reject', (c) => {
      return c.redirect('/api/v1/forge/proposals', 301)
    })
    ctx.http.route('/api/v1', api)

    ctx.logger.warn('skill-evolution module started in deprecated mode — all routes redirect to forge')
  },

  async onStop(_ctx: ModuleContext) {
    // No cleanup needed
  },
}
