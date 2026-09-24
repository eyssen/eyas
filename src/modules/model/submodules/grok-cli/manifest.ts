// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SubmoduleManifest, ModuleContext } from '@core/types'
import type { AIProvider } from '../../types.js'
import { resolveBridgeBaseUrl } from '../../cli-mcp/bridge-routes.js'
import { createGrokCliProvider } from './provider.js'
import { resolveCliExecutable } from '../../cli-runtime/executables.js'
import { createAcpProfile, startSessionStoreSweeper } from './acp-profiles.js'
import { createAcpVerifier, verifyAcpIsolationAtLoad } from './acp-verify.js'
import { runScratchCwd } from '../../cli-runtime/workspaces.js'
import { registerIsolationVerifier } from '../../cli-runtime/isolation.js'
import { cliTurnTimeoutsFrom } from '../../cli-turn-watchdog.js'

/**
 * True when the Grok CLI executable resolves (EYAS_GROK_BIN, else `grok`
 * on PATH) — the same resolver every spawn uses. Exported so the model
 * module's onboarding reconcile can probe availability BEFORE this
 * submodule's onStart runs.
 */
export async function isGrokCliAvailable(): Promise<boolean> {
  return (await resolveCliExecutable('grok-cli')).ok
}

/** Stops the session-store sweeper of the currently loaded provider. */
let stopSessionStoreSweeper: (() => void) | null = null

async function loadProvider(ctx: ModuleContext): Promise<void> {
  ctx.model.unregisterProvider('grok-cli')
  registerIsolationVerifier('grok-cli', null)
  stopSessionStoreSweeper?.()
  stopSessionStoreSweeper = null

  const config = ctx.providerConfig.getProvider('grok-cli')
  if (!config?.enabled) return

  // A reload re-resolves: the operator may have installed or replaced the binary.
  const executable = await resolveCliExecutable('grok-cli', { refresh: true })
  if (!executable.ok) {
    ctx.logger.warn({ detail: executable.detail, remedy: executable.remedy }, 'grok-cli: executable not resolved — provider skipped')
    return
  }

  // The EYAS-owned home, env and managed files every grok spawn uses. The
  // EYAS sign-in's credential lives in that home; an API key stored in EYAS
  // secrets instead reaches grok as XAI_API_KEY, read at every spawn (a
  // reload re-reads the secret, so a key added on the Secrets page counts).
  await ctx.cliSignIn?.refresh('grok-cli')
  const profile = createAcpProfile('grok-cli', { extraEnv: () => ctx.cliSignIn?.profileEnv('grok-cli') ?? {} })
  // Boot backstop for a purge a crash or kill skipped (EYAS never resumes).
  stopSessionStoreSweeper = startSessionStoreSweeper(profile, { logger: ctx.logger })

  // The fail-closed session checks, on the binary the resolver chose.
  const verifier = createAcpVerifier(profile, {
    logger: ctx.logger,
    runtime: { path: executable.path, version: executable.version, source: executable.source },
  })

  const maxTurns = config.settings?.maxTurns as number | undefined
  const provider = createGrokCliProvider({
    logger: ctx.logger,
    maxTurns,
    profile,
    verifier,
    // Resolved lazily at stream() time — the security-gate / agent modules may
    // register after the model module starts.
    getGovernance: () => ({
      securityGate: (ctx as any).securityGate,
      // The CLI's own plan steps go on the run tree the agent runner opens.
      orchestrationSink: (ctx as any).orchestration,
    }),
    // EYAS tools via the stdio MCP child; the child runs under this runtime
    // from a module-relative path (cli-mcp/bridge-routes.ts).
    mcpBridge: { baseUrl: resolveBridgeBaseUrl(ctx.config.server) },
    // Signed out: a turn fails at once with the localized 'cliSignIn' error.
    isSignedIn: () => ctx.cliSignIn?.isSignedIn('grok-cli') ?? true,
    // The Vision flag follows what the CLI reports it accepts, on every turn.
    onPromptCapabilities: ({ image }) => ctx.providerConfig.setImageSupport('grok-cli', image),
    // A discovered model keeps running the model it names after a restart.
    lookupModelMetadata: (modelId) => ctx.providerConfig.getModelMetadata('grok-cli', modelId),
    // model.cli turn timeouts, read from the live config at every turn.
    turnTimeouts: () => cliTurnTimeoutsFrom(ctx.config),
  })
  ctx.model.registerProvider(provider)

  // A first boot gets the CLI's default row at once; discovery adds the rest.
  if (ctx.providerConfig.listModels('grok-cli').length === 0) {
    ctx.providerConfig.upsertModels('grok-cli', await provider.listModels())
  }

  // In the background, never blocking the boot: seed the isolation status
  // (until it is verified, Grok is not offered isolated background work),
  // then rediscover the models and their effort levels — on every load, so
  // a CLI update or a newly offered model is seen without a manual refresh.
  // Both run through the isolated profile and make no model call.
  // The same sequence is the panel's Verify now.
  const verifyIsolation = () =>
    verifyAcpIsolationAtLoad(verifier, { profile, executable: executable.path, cwd: runScratchCwd('isolation-check') }, ctx.logger)
      .then(() => rediscoverModels(ctx, provider))
  registerIsolationVerifier('grok-cli', verifyIsolation)
  void verifyIsolation()
}

/**
 * Discovery at provider load. Skipped while the EYAS home is signed out (the
 * CLI could not open a session). Only a successful discovery changes the
 * stored rows (F2 reconcile: missing rows are flagged, never deleted); a
 * failure leaves every row as it was.
 */
async function rediscoverModels(ctx: ModuleContext, provider: AIProvider): Promise<void> {
  if (ctx.cliSignIn && !ctx.cliSignIn.isSignedIn('grok-cli')) {
    ctx.logger.debug('grok-cli: signed out — model discovery skipped')
    return
  }
  try {
    const models = await provider.fetchModels!()
    ctx.providerConfig.reconcileDiscoveredModels('grok-cli', models)
    // The discovered effort levels replace what the registry memoized.
    ctx.reasoningRegistry?.invalidate('grok-cli')
  } catch (err) {
    ctx.logger.debug({ err: err instanceof Error ? err.message : String(err) }, 'grok-cli: model discovery unavailable — the stored models stand')
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
      ctx.logger.warn('Grok CLI not resolved or disabled — provider skipped')
    }
  },
}
