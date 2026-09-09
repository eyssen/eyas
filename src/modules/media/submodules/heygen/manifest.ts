// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ModuleContext, SubmoduleManifest } from '@core/types'
import { createHeygenAdapter } from './adapter.js'

export const heygenManifest: SubmoduleManifest = {
  id: 'media.heygen',
  name: 'HeyGen',
  parentModule: 'media',
  enabled: true,
  async onStart(ctx: ModuleContext) {
    const mcp =
      (ctx as any).communication?.mcpClient
      ?? (ctx as any).mcpClient
    if (!mcp?.callTool || !mcp?.list || !mcp?.add || !mcp?.connect) {
      ctx.logger.warn('HeyGen adapter skipped — MCP client not available')
      return
    }

    const adapter = createHeygenAdapter({
      mcp,
      secrets: ctx.secrets,
      logger: ctx.logger,
    })
    try {
      await adapter.connect()
    } catch (err) {
      ctx.logger.warn({ err }, 'HeyGen MCP connect failed')
    }

    const media = (ctx as any).media
    if (media?.registerProvider) {
      media.registerProvider(adapter)
    }
  },
}
