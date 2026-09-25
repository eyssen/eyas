// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { buildAbilityForRole } from '@modules/permissions/roles.js'
import type { RoleId } from '@modules/permissions/types.js'
import { createToolRegistry } from './tool-registry.js'
import { createToolExecutor } from './tool-executor.js'
import { createToolSuggester } from './tool-suggester.js'
import { ensureToolExecutionsTable, recordToolExecution } from './execution-log.js'
// A pure function module: importing it creates no module-lifecycle coupling,
// unlike reaching for a brand SERVICE, which is done lazily off ctx below.
import { renderHtmlEmail } from '@shared/html-document.js'

export const toolsModule: EyasModule = {
  id: 'tools',
  name: 'Tool Registry',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'Central tool registry and execution engine for agent tool use',
  dependencies: [],
  optional: ['memory', 'search', 'knowledge', 'board', 'documents', 'conversations', 'agent', 'research', 'media'],

  async onRegister(ctx: ModuleContext) {
    ensureToolExecutionsTable(ctx.db)

    const registry = createToolRegistry()
    // Role→ability is deterministic for a given permission registry, so build
    // each role's ability once and reuse it for every subsequent tool call.
    const abilityCache = new Map<string, ReturnType<typeof buildAbilityForRole>>()
    const executor = createToolExecutor(registry, {
      bus: ctx.bus,
      authorization: {
        // Lazy: the security-gate module registers AFTER tools.
        getSecurityGate: () => (ctx as any).securityGate,
        getAbilityForRole: (role) => {
          let ability = abilityCache.get(role)
          if (!ability) {
            ability = buildAbilityForRole(role as RoleId, ctx.permissions)
            abilityCache.set(role, ability)
          }
          return ability
        },
      },
      // Tool output reaches memory from the agent run that called it, for every
      // provider alike (memory/v2/run-capture.ts) — not from this log.
      logExecution: (entry) => recordToolExecution(ctx.db, entry),
      // renderForModel masks memory tool results that leave past the gateway
      // (CLI bridges, external MCP). Lazy: the privacy module starts after us.
      getModelOutputRedactor: () => ctx.privacy?.redactToolOutput,
      logger: ctx.logger,
    })

    // Register built-in tools from available modules. Services are resolved
    // lazily, per call — see register-builtins.ts. The agent-owned tools
    // (delegate/team/messaging/propose) are registered by agent/index.ts.
    const { registerBuiltinTools } = await import('./register-builtins.js')
    await registerBuiltinTools(registry, {
      hasModule: (id) => ctx.hasModule(id),
      getService: (id) => (ctx as any)[id],
    })
    ctx.logger.info(`Tools module: ${registry.list().length} tools registered`)

    const suggester = createToolSuggester(registry)

    ;(ctx as any).tools = {
      registry,
      executor,
      suggester,
      /** Universal Pre/Post tool hooks (P4) — same registry as the executor. */
      hooks: executor.hooks,
    }
    ctx.logger.info('Tools module registered')
  },

  async onStart(ctx: ModuleContext) {
    const { createToolRoutes } = await import('./routes.js')
    createToolRoutes(ctx.http, (ctx as any).tools.registry)

    // CLI MCP bridge — loopback + secret proxy so Grok/Kimi ACP can call EYAS tools
    const { registerCliMcpBridgeRoutes } = await import('@modules/model/cli-mcp/bridge-routes.js')
    registerCliMcpBridgeRoutes({
      http: ctx.http,
      toolRegistry: (ctx as any).tools.registry,
      toolExecutor: (ctx as any).tools.executor,
      // Lazy: the security-gate module registers after tools.
      getSecurityGate: () => (ctx as any).securityGate,
      logger: ctx.logger,
    })

    // Email draft → approve → send tools (L2 email loop)
    try {
      const { createEmailTools } = await import('./builtin/email-tools.js')
      for (const tool of createEmailTools({
        getDb: () => ctx.db,
        getCommunication: () => (ctx as any).communication,
        bus: ctx.bus,
        // Fail-soft: a rendering failure must never block an approved send.
        renderBranded: ({ body, title }) => {
          try {
            const out = renderHtmlEmail({ body, title })
            return { html: out.html, text: out.text }
          } catch {
            return null
          }
        },
      })) {
        ;(ctx as any).tools.registry.register(tool)
      }
    } catch (err) {
      ctx.logger.debug({ err: String(err) }, 'email tools registration skipped')
    }

    ctx.logger.info('Tools module started')
  },

  async onStop() {},
}

// Phase 3M — public ACI formatter. Re-exported from the module root so
// tool authors and the executor can apply consistent truncation without
// importing a submodule path.
export { formatToolOutput } from './aci-layer.js'
export type { AciFormatOptions, AciFormatResult } from './aci-layer.js'
