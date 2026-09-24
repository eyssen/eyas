// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SubmoduleManifest, ModuleContext } from '@core/types'
import type { AIProvider } from '../../types.js'
import { createOllamaProvider, isOllamaAvailable } from './provider.js'

/**
 * Nothing here assumes Ollama exists: a disabled provider is never contacted,
 * and an enabled one that does not answer the ping is skipped (no discovery,
 * no rows touched).
 */
async function loadProvider(ctx: ModuleContext): Promise<void> {
  ctx.model.unregisterProvider('ollama')

  const config = ctx.providerConfig.getProvider('ollama')
  if (!config?.enabled) return

  const baseUrl = process.env.OLLAMA_HOST || 'http://localhost:11434'
  const available = await isOllamaAvailable(baseUrl)
  if (!available) return

  const provider = createOllamaProvider({ baseUrl })
  ctx.model.registerProvider(provider)

  if (ctx.providerConfig.listModels('ollama').length === 0) {
    // A first load seeds the rows from discovery, so tools and thinking are right from the start.
    ctx.providerConfig.upsertModels('ollama', await provider.fetchModels!())
    ctx.reasoningRegistry?.invalidate('ollama')
    return
  }
  // In the background, never blocking the boot: re-read the models and their
  // capabilities, so a newly pulled model or an Ollama update is seen
  // without a manual refresh.
  void rediscoverModels(ctx, provider)
}

/**
 * Discovery at provider load. Only a successful, non-empty discovery changes
 * the stored rows (reconcile: missing rows are flagged, never deleted); a
 * failure leaves every row as it was.
 */
async function rediscoverModels(ctx: ModuleContext, provider: AIProvider): Promise<void> {
  try {
    const models = await provider.fetchModels!()
    if (models.length === 0) return
    ctx.providerConfig.reconcileDiscoveredModels('ollama', models)
    // The discovered thinking controls replace what the registry memoized.
    ctx.reasoningRegistry?.invalidate('ollama')
  } catch (err) {
    ctx.logger.debug({ err: err instanceof Error ? err.message : String(err) }, 'ollama: model discovery unavailable — the stored models stand')
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
