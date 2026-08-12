// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { createFirefliesProvider } from './providers/fireflies.js'

export const meetingModule: EyasModule = {
  id: 'meeting',
  name: 'Meeting',
  version: '1.0.0',
  type: 'extra',
  required: false,
  description: 'Meeting transcript processing with provider pattern (Fireflies.ai)',
  dependencies: [],

  async onRegister(ctx: ModuleContext) {
    ctx.logger.info('Meeting module registered')
  },

  async onStart(ctx: ModuleContext) {
    // Read the Fireflies API key from secrets. When absent the provider runs
    // unconfigured (fail closed) — it returns an empty list and never fabricates
    // transcripts, summaries or action items.
    const apiKey = ctx.hasModule('secrets')
      ? (await ctx.secrets.get('fireflies-api-key', 'system')) ?? undefined
      : undefined

    const provider = createFirefliesProvider(apiKey)
    await provider.connect()
    ;(ctx as any).meeting = provider

    const { createMeetingRoutes } = await import('./routes.js')
    createMeetingRoutes(ctx.http, provider)
    ctx.logger.info(
      provider.configured
        ? 'Meeting module started (Fireflies configured)'
        : 'Meeting module started (no API key — unconfigured, serving empty state)',
    )
  },

  async onStop() {},
}
