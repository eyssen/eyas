import type { SubmoduleManifest, ModuleContext } from '@core/types'
import { createClaudeCodeProvider } from './provider.js'
import { createOrchestrationBroadcaster } from '@modules/agent/orchestration-broadcaster.js'

/**
 * True when the `claude` CLI binary is present and runnable on PATH.
 * Exported so the model module's onboarding reconcile (index.ts) can probe
 * availability BEFORE this submodule's onStart runs — at that point the
 * provider isn't registered yet, so gateway-based detection isn't possible.
 */
export async function isClaudeCliAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['claude', '--version'], { stdout: 'pipe', stderr: 'pipe' })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

async function loadProvider(ctx: ModuleContext): Promise<void> {
  ctx.model.unregisterProvider('claude-code')

  const config = ctx.providerConfig.getProvider('claude-code')
  if (!config?.enabled) return

  if (!(await isClaudeCliAvailable())) return

  const loadClaudeMd = config.settings?.loadClaudeMd === true // opt-in — default: false
  const maxTurns = config.settings?.maxTurns as number | undefined

  // Inject tool executor and registry for MCP bridge (when tools module is available)
  const toolsCtx = (ctx as any).tools as { registry?: any; executor?: any } | undefined
  const provider = createClaudeCodeProvider({
    loadClaudeMd,
    toolExecutor: toolsCtx?.executor,
    toolRegistry: toolsCtx?.registry,
    logger: ctx.logger,
    maxTurns,
    // Resolved lazily at stream() time — securityGate/agents/wsRegistry may be
    // registered by their modules after the model module starts.
    getGovernance: () => {
      const securityGate = (ctx as any).securityGate
      const agentRegistry = (ctx as any).agents?.registry
      const wsRegistry = (ctx as any).wsRegistry
      // Prefer the agent module's persisting sink (replay + live WS); fall back
      // to a live-only broadcaster when the agent module is absent.
      const orchestration = (ctx as any).orchestration
      return {
        securityGate,
        agentRegistry,
        orchestrationSink:
          orchestration?.emit ?? (wsRegistry ? createOrchestrationBroadcaster(wsRegistry).emit : undefined),
      }
    },
  })
  ctx.model.registerProvider(provider)

  const existingModels = ctx.providerConfig.listModels('claude-code')
  if (existingModels.length === 0) {
    // Persist accurate known caps immediately (instant, no CLI call)...
    ctx.providerConfig.upsertModels('claude-code', await provider.listModels())
    // ...then enrich names with real model ids in the background (best-effort,
    // non-blocking — never delays startup, failures are ignored).
    void provider.fetchModels!()
      .then((models) => ctx.providerConfig.upsertModels('claude-code', models))
      .catch(() => { /* CLI probe unavailable — known caps stand */ })
  }
}

export const claudeCodeManifest: SubmoduleManifest = {
  id: 'model.claude-code',
  name: 'Claude Code CLI',
  parentModule: 'model',
  enabled: true,

  async onStart(ctx: ModuleContext) {
    ctx.providerConfig.ensureProvider('claude-code')
    ctx.providerReload.set('claude-code', () => loadProvider(ctx))
    await loadProvider(ctx)
    if (ctx.model.getProvider('claude-code')) {
      ctx.logger.info('Claude Code CLI provider registered')
    } else {
      ctx.logger.warn('Claude Code CLI not found on PATH — provider skipped')
    }
  },
}
