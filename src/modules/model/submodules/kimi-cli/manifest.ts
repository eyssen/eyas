// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SubmoduleManifest, ModuleContext } from '@core/types'
import type { AIProvider } from '../../types.js'
import { resolveBridgeBaseUrl } from '../../cli-mcp/bridge-routes.js'
import { repointRetiredKimiCliModels } from '../../onboarding-reconcile.js'
import { createKimiCliProvider } from './provider.js'
import { resolveCliExecutable } from '../../cli-runtime/executables.js'
import { createAcpProfile, startSessionStoreSweeper } from '../grok-cli/acp-profiles.js'
import { createAcpVerifier, verifyAcpIsolationAtLoad } from '../grok-cli/acp-verify.js'
import { runScratchCwd } from '../../cli-runtime/workspaces.js'
import { registerIsolationVerifier } from '../../cli-runtime/isolation.js'
import { cliTurnTimeoutsFrom } from '../../cli-turn-watchdog.js'

/**
 * True when the Kimi Code CLI executable resolves (EYAS_KIMI_BIN, else `kimi`
 * on PATH) — the same resolver every spawn uses. Exported so the model
 * module's onboarding reconcile can probe availability BEFORE this
 * submodule's onStart runs.
 */
export async function isKimiCliAvailable(): Promise<boolean> {
  return (await resolveCliExecutable('kimi-cli')).ok
}

/** Stops the session-store sweeper of the currently loaded provider. */
let stopSessionStoreSweeper: (() => void) | null = null

async function loadProvider(ctx: ModuleContext): Promise<void> {
  ctx.model.unregisterProvider('kimi-cli')
  registerIsolationVerifier('kimi-cli', null)
  stopSessionStoreSweeper?.()
  stopSessionStoreSweeper = null

  const config = ctx.providerConfig.getProvider('kimi-cli')
  if (!config?.enabled) return

  // A reload re-resolves: the operator may have installed or replaced the binary.
  const executable = await resolveCliExecutable('kimi-cli', { refresh: true })
  if (!executable.ok) {
    ctx.logger.warn({ detail: executable.detail, remedy: executable.remedy }, 'kimi-cli: executable not resolved — provider skipped')
    return
  }

  // The EYAS-owned home, env and managed files every kimi spawn uses; the
  // EYAS sign-in writes its credential into this home, never the host's.
  await ctx.cliSignIn?.refresh('kimi-cli')
  const profile = createAcpProfile('kimi-cli')
  // Boot backstop for a purge a crash or kill skipped (EYAS never resumes).
  stopSessionStoreSweeper = startSessionStoreSweeper(profile, { logger: ctx.logger })

  // The fail-closed session checks, on the binary the resolver chose.
  const verifier = createAcpVerifier(profile, {
    logger: ctx.logger,
    runtime: { path: executable.path, version: executable.version, source: executable.source },
  })

  const maxTurns = config.settings?.maxTurns as number | undefined
  const provider = createKimiCliProvider({
    logger: ctx.logger,
    maxTurns,
    profile,
    verifier,
    getGovernance: () => ({
      securityGate: (ctx as any).securityGate,
      // The CLI's own plan steps go on the run tree the agent runner opens.
      orchestrationSink: (ctx as any).orchestration,
    }),
    mcpBridge: { baseUrl: resolveBridgeBaseUrl(ctx.config.server) },
    // Signed out: a turn fails at once with the localized 'cliSignIn' error.
    isSignedIn: () => ctx.cliSignIn?.isSignedIn('kimi-cli') ?? true,
    // The Vision flag follows what the CLI reports it accepts, on every turn.
    onPromptCapabilities: ({ image }) => ctx.providerConfig.setImageSupport('kimi-cli', image),
    // model.cli turn timeouts, read from the live config at every turn.
    turnTimeouts: () => cliTurnTimeoutsFrom(ctx.config),
    // A discovered model keeps selecting the Kimi model it names after a restart.
    lookupModelMetadata: (modelId) => ctx.providerConfig.getModelMetadata('kimi-cli', modelId),
  })
  ctx.model.registerProvider(provider)

  // A first boot gets the CLI's default row at once; discovery adds the rest.
  if (ctx.providerConfig.listModels('kimi-cli').length === 0) {
    ctx.providerConfig.upsertModels('kimi-cli', await provider.listModels())
  }

  // In the background, never blocking the boot: check the EYAS home (no
  // model call; a tampered home shows at once — Kimi counts as verified only
  // once a session has started on this host), then rediscover the models and
  // their thinking variants from a session/new, on every load, so a CLI
  // update or a newly configured model is seen without a manual refresh.
  // The same sequence is the panel's Verify now.
  const verifyIsolation = () =>
    verifyAcpIsolationAtLoad(verifier, { profile, executable: executable.path, cwd: runScratchCwd('isolation-check') }, ctx.logger)
      .then(() => rediscoverModels(ctx, provider))
  registerIsolationVerifier('kimi-cli', verifyIsolation)
  void verifyIsolation()
}

/**
 * Discovery at provider load. Skipped while the EYAS home is signed out (Kimi
 * opens no session without a login). Only a successful discovery changes the
 * stored rows (F2 reconcile: missing rows are flagged, never deleted); a
 * failure leaves every row as it was — and Kimi's thinking control unknown,
 * so EYAS sends none.
 */
async function rediscoverModels(ctx: ModuleContext, provider: AIProvider): Promise<void> {
  if (ctx.cliSignIn && !ctx.cliSignIn.isSignedIn('kimi-cli')) {
    ctx.logger.debug('kimi-cli: signed out — model discovery skipped')
    return
  }
  try {
    const models = await provider.fetchModels!()
    ctx.providerConfig.reconcileDiscoveredModels('kimi-cli', models)
    // The discovered thinking variants replace what the registry memoized.
    ctx.reasoningRegistry?.invalidate('kimi-cli')
  } catch (err) {
    ctx.logger.debug({ err: err instanceof Error ? err.message : String(err) }, 'kimi-cli: model discovery unavailable — the stored models stand')
  }
}

export const kimiCliManifest: SubmoduleManifest = {
  id: 'model.kimi-cli',
  name: 'Kimi Code CLI',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    ctx.providerConfig.ensureProvider('kimi-cli')
    // Routing tiers and the provider default that still name a retired seed
    // id (they never selected a model) move to the CLI's own default.
    if (ctx.db) {
      try {
        const moved = repointRetiredKimiCliModels(ctx.db)
        if (moved > 0) ctx.logger.info({ rows: moved }, 'kimi-cli: retired seed model ids moved to kimi-cli-default')
      } catch (err) {
        ctx.logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'kimi-cli: retired seed model ids could not be moved (non-fatal)')
      }
    }
    ctx.providerReload.set('kimi-cli', () => loadProvider(ctx))
    await loadProvider(ctx)
    if (ctx.model.getProvider('kimi-cli')) {
      ctx.logger.info('Kimi Code CLI provider registered')
    } else {
      ctx.logger.warn('Kimi Code CLI not resolved or disabled — provider skipped')
    }
  },
}
