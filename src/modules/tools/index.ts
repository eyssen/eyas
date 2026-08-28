// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule, ModuleContext } from '@core/types'
import { sql } from 'drizzle-orm'
import { buildAbilityForRole } from '@modules/permissions/roles.js'
import type { RoleId } from '@modules/permissions/types.js'
import { createToolRegistry } from './tool-registry.js'
import { createToolExecutor } from './tool-executor.js'
import { createToolSuggester } from './tool-suggester.js'
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
  optional: ['memory', 'search', 'knowledge', 'board', 'documents', 'conversations', 'agent', 'research'],

  async onRegister(ctx: ModuleContext) {
    // Create tool_executions table
    ctx.db.run(sql`CREATE TABLE IF NOT EXISTS tool_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT,
      agent_id TEXT,
      tool_name TEXT NOT NULL,
      input TEXT,
      output TEXT,
      error TEXT,
      success INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_tool_exec_conv ON tool_executions(conversation_id)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_tool_exec_agent ON tool_executions(agent_id)`)
    ctx.db.run(sql`CREATE INDEX IF NOT EXISTS idx_tool_exec_name ON tool_executions(tool_name)`)

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
      logExecution: (entry) => {
        ctx.db.run(sql`INSERT INTO tool_executions (conversation_id, agent_id, tool_name, input, output, error, success, duration_ms, created_at)
          VALUES (${entry.conversationId ?? null}, ${entry.agentId ?? null}, ${entry.toolName},
                  ${JSON.stringify(entry.input)}, ${entry.output ? JSON.stringify(entry.output) : null},
                  ${entry.error ?? null}, ${entry.success ? 1 : 0}, ${entry.durationMs}, ${entry.timestamp})`)
      },
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
