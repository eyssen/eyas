// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createKimiCliProvider } from './provider.js'

/**
 * True when the `kimi` CLI binary is present and runnable on PATH.
 * Exported so the model module's onboarding reconcile can probe availability
 * BEFORE this submodule's onStart runs.
 */
export async function isKimiCliAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['kimi', '--version'], { stdout: 'pipe', stderr: 'pipe' })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

async function loadProvider(ctx: ModuleContext): Promise<void> {
  ctx.model.unregisterProvider('kimi-cli')

  const config = ctx.providerConfig.getProvider('kimi-cli')
  if (!config?.enabled) return

  if (!(await isKimiCliAvailable())) return

  const maxTurns = config.settings?.maxTurns as number | undefined
  const port = ctx.config.server.port
  const host = ctx.config.server.host === '0.0.0.0' ? '127.0.0.1' : (ctx.config.server.host || '127.0.0.1')
  const installRoot = process.env.EYAS_INSTALL_ROOT || process.cwd()
  const provider = createKimiCliProvider({
    logger: ctx.logger,
    maxTurns,
    getGovernance: () => ({
      securityGate: (ctx as any).securityGate,
      orchestrationSink: (ctx as any).orchestration?.emit,
    }),
    mcpBridge: {
      baseUrl: `http://${host}:${port}`,
      installRoot,
    },
  })
  ctx.model.registerProvider(provider)

  const existingModels = ctx.providerConfig.listModels('kimi-cli')
  if (existingModels.length === 0) {
    ctx.providerConfig.upsertModels('kimi-cli', await provider.listModels())
  }
}

export const kimiCliManifest: SubmoduleManifest = {
  id: 'model.kimi-cli',
  name: 'Kimi Code CLI',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    ctx.providerConfig.ensureProvider('kimi-cli')
    ctx.providerReload.set('kimi-cli', () => loadProvider(ctx))
    await loadProvider(ctx)
    if (ctx.model.getProvider('kimi-cli')) {
      ctx.logger.info('Kimi Code CLI provider registered')
    } else {
      ctx.logger.warn('Kimi Code CLI not found on PATH or disabled — provider skipped')
    }
  },
}
