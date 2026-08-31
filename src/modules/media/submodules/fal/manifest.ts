// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ModuleContext, SubmoduleManifest } from '@core/types'
import { createFalAdapter } from './adapter.js'

export const falManifest: SubmoduleManifest = {
  id: 'media.fal',
  name: 'fal.ai',
  parentModule: 'media',
  enabled: true,
  async onStart(ctx: ModuleContext) {
    const mcp =
      (ctx as any).communication?.mcpClient
      ?? (ctx as any).mcpClient
    if (!mcp?.callTool || !mcp?.list || !mcp?.add || !mcp?.connect || !mcp?.update) {
      ctx.logger.warn('fal adapter skipped — MCP client not available')
      return
    }

    const adapter = createFalAdapter({
      mcp,
      secrets: ctx.secrets,
      logger: ctx.logger,
    })
    try {
      await adapter.connect()
    } catch (err) {
      ctx.logger.warn({ err }, 'fal MCP connect failed')
    }

    const media = (ctx as any).media
    if (media?.registerProvider) {
      media.registerProvider(adapter)
    }
  },
}
