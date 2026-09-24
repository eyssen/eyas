import type { SubmoduleManifest, ModuleContext } from '@core/types'
import type { AIProvider, ModelInfo } from '../../types.js'
import type { ModelConfigRow } from '../../provider-config-service.js'
import { createClaudeCodeProvider } from './provider.js'
import { readClaudeAuthStatus, resolveClaudeRuntime, toClaudeRuntime } from './runtime.js'
import { cliTurnTimeoutsFrom } from '../../cli-turn-watchdog.js'

/**
 * Availability (runtime resolves AND is signed in). Exported so the model
 * module's onboarding reconcile (index.ts) can check it BEFORE this
 * submodule's onStart runs — at that point the provider isn't registered
 * yet, so gateway-based detection isn't possible.
 */
export { isClaudeRuntimeUsable } from './runtime.js'

/**
 * Settings keys that no longer do anything. `loadClaudeMd` loaded the host's
 * Claude config (settings.json hooks and permission rules, every CLAUDE.md
 * tier, skills, project MCP servers) and with it the CLI's own auto-memory, in
 * both directions. Claude Code now always runs isolated; host CLAUDE.md
 * content reaches EYAS only through a Data port import.
 */
const RETIRED_SETTINGS = ['loadClaudeMd'] as const

/**
 * One-time cleanup, idempotent: drop retired keys from the stored provider
 * config so nothing (API, panel, backups) suggests they still apply. Never
 * blocks the provider from starting.
 */
export function stripRetiredClaudeSettings(ctx: Pick<ModuleContext, 'providerConfig' | 'logger'>): void {
  try {
    const settings = ctx.providerConfig.getProvider('claude-code')?.settings
    if (!settings) return
    const present = RETIRED_SETTINGS.filter((key) => Object.prototype.hasOwnProperty.call(settings, key))
    if (present.length === 0) return
    const kept: Record<string, unknown> = { ...settings }
    for (const key of present) delete kept[key]
    ctx.providerConfig.updateProvider('claude-code', { settings: kept })
    ctx.logger.info({ removed: present }, 'claude-code: retired settings removed — host Claude config is never loaded')
  } catch (err) {
    ctx.logger.warn({ err: String(err) }, 'claude-code: removing retired settings failed — they are ignored either way')
  }
}

async function loadProvider(ctx: ModuleContext): Promise<void> {
  ctx.model.unregisterProvider('claude-code')

  const config = ctx.providerConfig.getProvider('claude-code')
  if (!config?.enabled) return

  // One binary for the sign-in check and every query(). A reload resolves
  // again, so a CLI installed or an override changed since boot is seen.
  const resolved = await resolveClaudeRuntime({ refresh: true })
  if (!resolved.ok) {
    const log = { error: resolved.error, detail: resolved.detail, remedy: resolved.remedy }
    // An invalid override is an operator error: fail closed, loudly.
    if (resolved.error === 'override-invalid') ctx.logger.error(log, 'Claude Code runtime override is invalid — provider skipped')
    else ctx.logger.warn(log, 'Claude Code runtime not found — provider skipped')
    return
  }
  const runtime = toClaudeRuntime(resolved)
  for (const warning of resolved.warnings) ctx.logger.warn({ ...runtime }, warning)

  const auth = await readClaudeAuthStatus(runtime, { logger: ctx.logger })
  if (!auth.loggedIn) {
    ctx.logger.warn({ ...runtime, reason: auth.error ?? 'signed-out' }, 'Claude Code runtime is not signed in — provider skipped')
    return
  }

  const maxTurns = config.settings?.maxTurns as number | undefined

  // Inject tool executor and registry for MCP bridge (when tools module is available)
  const toolsCtx = (ctx as any).tools as { registry?: any; executor?: any } | undefined
  const provider = createClaudeCodeProvider({
    runtime,
    toolExecutor: toolsCtx?.executor,
    toolRegistry: toolsCtx?.registry,
    logger: ctx.logger,
    maxTurns,
    // The persisted alias of a model row selects the model the runtime runs;
    // its discovered reasoning bounds the effort levels sent.
    lookupModelMetadata: (modelId) => ctx.providerConfig.getModelMetadata('claude-code', modelId),
    // Resolved lazily at stream() time — the security gate may be registered
    // by its module after the model module starts. No agent roster:
    // specialists are EYAS sub-conversations (run_specialist), never Claude
    // Code native subagents. No run tree either: the agent runner emits it
    // for every provider.
    getGovernance: () => ({ securityGate: (ctx as any).securityGate }),
    // model.cli turn timeouts, read from the live config at every query.
    turnTimeouts: () => cliTurnTimeoutsFrom(ctx.config),
  })
  ctx.model.registerProvider(provider)
  ctx.logger.info({ ...runtime }, 'Claude Code provider registered')

  // A first boot gets the known aliases at once (no CLI call); discovery
  // replaces them with what the runtime offers. A later boot re-applies the
  // seed only to its own rows no discovery has confirmed whose window drifted.
  const seed = await provider.listModels()
  const stored = ctx.providerConfig.listModels('claude-code')
  const seeding = stored.length === 0 ? seed : undiscoveredSeedDrift(stored, seed)
  if (seeding.length > 0) ctx.providerConfig.upsertModels('claude-code', seeding)

  // In the background, never blocking the boot: rediscover the models, the
  // concrete model behind each alias and its effort levels on every load, so
  // a runtime update is seen without a manual refresh. Zero-cost and
  // isolated — the runtime's `initialize` answer, no prompt, no model call.
  void rediscoverModels(ctx, provider)
}

/**
 * Seed rows stored earlier that no discovery has written since, whose window
 * differs from the current seed's: an earlier EYAS seeded the bare fable,
 * opus and sonnet aliases with a 1M window the runtime does not give them
 * (CCB-3), and on a host whose discovery keeps failing that claim would size
 * prompts and the context bar forever. Only the seed's own ids qualify, and
 * only while no discovery has confirmed them (no discoveredAt). Such a row is
 * rewritten from the current seed (name, window, output cap); a row the user
 * switched off stays off (upsertModels keeps the enabled choice and the
 * missing flag). Nothing is added or deleted.
 */
export function undiscoveredSeedDrift(stored: ReadonlyArray<Pick<ModelConfigRow, 'modelId' | 'contextWindow' | 'metadata'>>, seed: ReadonlyArray<ModelInfo>): ModelInfo[] {
  const byId = new Map(stored.map((row) => [row.modelId, row]))
  return seed.filter((model) => {
    const row = byId.get(model.id)
    return row !== undefined && !row.metadata?.discoveredAt && row.contextWindow !== model.contextWindow
  })
}

/**
 * Discovery at provider load. Only a successful discovery changes the stored
 * rows (F2 reconcile: rows it no longer offers are flagged and switched off,
 * never deleted); a failure leaves every row as it was.
 */
async function rediscoverModels(ctx: ModuleContext, provider: AIProvider): Promise<void> {
  try {
    const models = await provider.fetchModels!()
    ctx.providerConfig.reconcileDiscoveredModels('claude-code', models)
    // The discovered effort levels replace what the registry memoized.
    ctx.reasoningRegistry?.invalidate('claude-code')
  } catch (err) {
    ctx.logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'claude-code: model discovery unavailable — the stored models stand')
  }
}

export const claudeCodeManifest: SubmoduleManifest = {
  id: 'model.claude-code',
  name: 'Claude Code CLI',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    ctx.providerConfig.ensureProvider('claude-code')
    stripRetiredClaudeSettings(ctx)
    ctx.providerReload.set('claude-code', () => loadProvider(ctx))
    await loadProvider(ctx)
  },
}
