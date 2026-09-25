import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createOpenAIProvider } from './provider.js'

async function loadProvider(ctx: ModuleContext): Promise<void> {
  ctx.model.unregisterProvider('openai')

  const config = ctx.providerConfig.getProvider('openai')
  if (!config?.enabled) return

  const apiKey = await ctx.secrets.get('openai-api-key', 'system')
  if (!apiKey) return

  const provider = createOpenAIProvider({ apiKey })
  ctx.model.registerProvider(provider)

  const existingModels = ctx.providerConfig.listModels('openai')
  if (existingModels.length === 0) {
    const models = await provider.listModels()
    ctx.providerConfig.upsertModels('openai', models)
  }
}

export const openaiManifest: SubmoduleManifest = {
  id: 'model.openai',
  name: 'OpenAI',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    ctx.providerConfig.ensureProvider('openai')
    ctx.providerReload.set('openai', () => loadProvider(ctx))
    await loadProvider(ctx)
    if (ctx.model.getProvider('openai')) {
      ctx.logger.info('OpenAI provider registered')
    } else {
      ctx.logger.warn('OpenAI provider skipped — no API key in secrets')
    }
  },
}
