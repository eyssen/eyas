// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { OPENAI_COMPAT_CATALOG, type CompatProviderDef } from './catalog.js'
import { createCompatProvider } from './provider.js'

async function loadOne(ctx: ModuleContext, def: CompatProviderDef): Promise<void> {
  ctx.model.unregisterProvider(def.id)

  const config = ctx.providerConfig.getProvider(def.id)
  if (!config?.enabled) return

  const apiKey = (await ctx.secrets.get(def.secretName, 'system')) ?? ''
  if (!apiKey && !def.local) return

  // Optional baseURL override from provider settings.
  const baseURL = (config.settings?.baseURL as string | undefined) || def.baseURL
  const provider = createCompatProvider({ ...def, baseURL }, apiKey)
  ctx.model.registerProvider(provider)

  const existingModels = ctx.providerConfig.listModels(def.id)
  if (existingModels.length === 0) {
    const models = await provider.listModels()
    ctx.providerConfig.upsertModels(def.id, models)
  }
}

async function loadAll(ctx: ModuleContext): Promise<void> {
  for (const def of OPENAI_COMPAT_CATALOG) {
    try {
      await loadOne(ctx, def)
    } catch (err) {
      ctx.logger.warn({ err, providerId: def.id }, 'openai-compat provider load failed')
    }
  }
}

/**
 * Single submodule that registers every OpenAI-compatible catalog provider
 * (xAI, Mistral, Groq, Together, DeepSeek, …). Each id still has its own
 * provider_config row and reload hook.
 */
export const openaiCompatManifest: SubmoduleManifest = {
  id: 'model.openai-compat',
  name: 'OpenAI-compatible providers',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    for (const def of OPENAI_COMPAT_CATALOG) {
      ctx.providerConfig.ensureProvider(def.id)
      ctx.providerReload.set(def.id, () => loadOne(ctx, def))
    }
    await loadAll(ctx)
    const active = OPENAI_COMPAT_CATALOG.filter((d) => ctx.model.getProvider(d.id)).map((d) => d.id)
    if (active.length > 0) {
      ctx.logger.info({ providers: active }, 'OpenAI-compatible providers registered')
    } else {
      ctx.logger.info('OpenAI-compatible catalog ready — no API keys configured yet')
    }
  },
}
