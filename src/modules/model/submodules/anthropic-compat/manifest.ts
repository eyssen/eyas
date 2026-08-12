// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { ANTHROPIC_COMPAT_CATALOG, type AnthropicCompatDef } from './catalog.js'
import { createAnthropicCompatProvider } from './provider.js'

async function loadOne(ctx: ModuleContext, def: AnthropicCompatDef): Promise<void> {
  ctx.model.unregisterProvider(def.id)

  const config = ctx.providerConfig.getProvider(def.id)
  if (!config?.enabled) return

  const apiKey = await ctx.secrets.get(def.secretName, 'system')
  if (!apiKey) return

  const baseURL = (config.settings?.baseURL as string | undefined) || def.baseURL
  const provider = createAnthropicCompatProvider({ ...def, baseURL }, apiKey)
  ctx.model.registerProvider(provider)

  const existingModels = ctx.providerConfig.listModels(def.id)
  if (existingModels.length === 0) {
    ctx.providerConfig.upsertModels(def.id, await provider.listModels())
  }
}

export const anthropicCompatManifest: SubmoduleManifest = {
  id: 'model.anthropic-compat',
  name: 'Anthropic-compatible providers',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    for (const def of ANTHROPIC_COMPAT_CATALOG) {
      ctx.providerConfig.ensureProvider(def.id)
      ctx.providerReload.set(def.id, () => loadOne(ctx, def))
    }
    for (const def of ANTHROPIC_COMPAT_CATALOG) {
      try {
        await loadOne(ctx, def)
      } catch (err) {
        ctx.logger.warn({ err, providerId: def.id }, 'anthropic-compat provider load failed')
      }
    }
    const active = ANTHROPIC_COMPAT_CATALOG.filter((d) => ctx.model.getProvider(d.id)).map((d) => d.id)
    if (active.length > 0) {
      ctx.logger.info({ providers: active }, 'Anthropic-compatible providers registered')
    }
  },
}
