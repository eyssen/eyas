import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createGeminiProvider } from './provider.js'

async function loadProvider(ctx: ModuleContext): Promise<void> {
  ctx.model.unregisterProvider('gemini')

  const config = ctx.providerConfig.getProvider('gemini')
  if (!config?.enabled) return

  const apiKey = await ctx.secrets.get('gemini-api-key', 'system')
  if (!apiKey) return

  const provider = createGeminiProvider(apiKey)
  ctx.model.registerProvider(provider)

  const existingModels = ctx.providerConfig.listModels('gemini')
  if (existingModels.length === 0) {
    const models = await provider.listModels()
    ctx.providerConfig.upsertModels('gemini', models)
  }
}

export const geminiManifest: SubmoduleManifest = {
  id: 'model.gemini',
  name: 'Google Gemini',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    ctx.providerConfig.ensureProvider('gemini')
    ctx.providerReload.set('gemini', () => loadProvider(ctx))
    await loadProvider(ctx)
    if (ctx.model.getProvider('gemini')) {
      ctx.logger.info('Gemini provider registered')
    } else {
      ctx.logger.warn('Gemini provider skipped — no API key in secrets')
    }
  },
}
