// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createGrokCliProvider } from './provider.js'

/**
 * True when the `grok` CLI binary is present and runnable on PATH.
 * Exported so the model module's onboarding reconcile can probe availability
 * BEFORE this submodule's onStart runs.
 */
export async function isGrokCliAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['grok', '--version'], { stdout: 'pipe', stderr: 'pipe' })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

async function loadProvider(ctx: ModuleContext): Promise<void> {
  ctx.model.unregisterProvider('grok-cli')

  const config = ctx.providerConfig.getProvider('grok-cli')
  if (!config?.enabled) return

  if (!(await isGrokCliAvailable())) return

  const maxTurns = config.settings?.maxTurns as number | undefined
  const port = ctx.config.server.port
  const host = ctx.config.server.host === '0.0.0.0' ? '127.0.0.1' : (ctx.config.server.host || '127.0.0.1')
  const installRoot = process.env.EYAS_INSTALL_ROOT || process.cwd()
  const provider = createGrokCliProvider({
    logger: ctx.logger,
    maxTurns,
    // Resolved lazily at stream() time — the security-gate / agent modules may
    // register after the model module starts.
    getGovernance: () => ({
      securityGate: (ctx as any).securityGate,
      orchestrationSink: (ctx as any).orchestration?.emit,
    }),
    // Wave 1 — EYAS tools via stdio MCP for ACP hosts
    mcpBridge: {
      baseUrl: `http://${host}:${port}`,
      installRoot,
    },
  })
  ctx.model.registerProvider(provider)

  const existingModels = ctx.providerConfig.listModels('grok-cli')
  if (existingModels.length === 0) {
    ctx.providerConfig.upsertModels('grok-cli', await provider.listModels())
    void provider.fetchModels!()
      .then((models) => ctx.providerConfig.upsertModels('grok-cli', models))
      .catch(() => { /* CLI probe unavailable — known caps stand */ })
  }
}

export const grokCliManifest: SubmoduleManifest = {
  id: 'model.grok-cli',
  name: 'Grok CLI',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    ctx.providerConfig.ensureProvider('grok-cli')
    ctx.providerReload.set('grok-cli', () => loadProvider(ctx))
    await loadProvider(ctx)
    if (ctx.model.getProvider('grok-cli')) {
      ctx.logger.info('Grok CLI provider registered')
    } else {
      ctx.logger.warn('Grok CLI not found on PATH or disabled — provider skipped')
    }
  },
}
