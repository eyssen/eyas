// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createOllamaProvider, isOllamaAvailable } from './provider.js'

async function loadProvider(ctx: ModuleContext): Promise<void> {
  ctx.model.unregisterProvider('ollama')

  const config = ctx.providerConfig.getProvider('ollama')
  if (!config?.enabled) return

  const baseUrl = process.env.OLLAMA_HOST || 'http://localhost:11434'
  const available = await isOllamaAvailable(baseUrl)
  if (!available) return

  const provider = createOllamaProvider({ baseUrl })
  ctx.model.registerProvider(provider)

  const existingModels = ctx.providerConfig.listModels('ollama')
  if (existingModels.length === 0) {
    const models = await provider.listModels()
    ctx.providerConfig.upsertModels('ollama', models)
  }
}

export const ollamaManifest: SubmoduleManifest = {
  id: 'model.ollama',
  name: 'Ollama',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    ctx.providerConfig.ensureProvider('ollama')
    ctx.providerReload.set('ollama', () => loadProvider(ctx))
    await loadProvider(ctx)
    if (ctx.model.getProvider('ollama')) {
      ctx.logger.info('Ollama provider registered')
    } else {
      ctx.logger.info('Ollama provider skipped — not available')
    }
  },
}
