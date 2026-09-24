// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SubmoduleManifest, ModuleContext } from '@core/types'
import type { AIProvider, ModelInfo } from '../../types.js'
import { createAnthropicProvider } from './provider.js'

/**
 * The first catalog of a provider with a key: discovered from the Models API
 * (no model call, no cost), so it lists exactly the models this key can use,
 * each with its context window, output cap and reasoning capabilities. When
 * discovery is unavailable (offline, a proxy, an error) the built-in catalog
 * stands in; a later Refresh replaces it. Runs only while the provider has no
 * rows, so a user's catalog is never re-seeded behind their back.
 */
export async function seedAnthropicModels(ctx: ModuleContext, provider: AIProvider): Promise<'discovered' | 'builtin'> {
  let discovered: ModelInfo[] = []
  try {
    discovered = provider.fetchModels ? await provider.fetchModels() : []
  } catch (err) {
    ctx.logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'anthropic: model discovery unavailable — using the built-in catalog')
  }
  if (discovered.length > 0) {
    ctx.providerConfig.reconcileDiscoveredModels('anthropic', discovered)
    // The discovered effort levels replace anything the registry memoized.
    ctx.reasoningRegistry?.invalidate('anthropic')
    return 'discovered'
  }
  ctx.providerConfig.upsertModels('anthropic', await provider.listModels())
  return 'builtin'
}

async function loadProvider(ctx: ModuleContext): Promise<void> {
  ctx.model.unregisterProvider('anthropic')

  const config = ctx.providerConfig.getProvider('anthropic')
  if (!config?.enabled) return

  const apiKey = await ctx.secrets.get('anthropic-api-key', 'system')
  if (!apiKey) return

  const provider = createAnthropicProvider(apiKey)
  ctx.model.registerProvider(provider)

  if (ctx.providerConfig.listModels('anthropic').length === 0) {
    await seedAnthropicModels(ctx, provider)
  }
}

export const anthropicManifest: SubmoduleManifest = {
  id: 'model.anthropic',
  name: 'Anthropic Claude API',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    ctx.providerConfig.ensureProvider('anthropic')
    ctx.providerReload.set('anthropic', () => loadProvider(ctx))
    await loadProvider(ctx)
    if (ctx.model.getProvider('anthropic')) {
      ctx.logger.info('Anthropic provider registered')
    } else {
      ctx.logger.warn('Anthropic provider skipped — no API key in secrets')
    }
  },
}
