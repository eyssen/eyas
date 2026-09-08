// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createToolRegistry, type ToolRegistry } from '@modules/tools/tool-registry.js'
import { registerBuiltinTools } from '@modules/tools/register-builtins.js'

/**
 * Build the COMPLETE production tool set — the module builtins *plus* the
 * agent-module-owned tools.
 *
 * Why this exists as one shared recipe: `registerBuiltinTools` deliberately
 * omits the agent-owned tools (agent/index.ts registers those from its own
 * onRegister, and registering them twice throws on the duplicate name). A test
 * that sweeps "every registered tool" using only `registerBuiltinTools` is
 * therefore blind to delegate/team/messaging/propose — which silently turns
 * `registry.get(name)?.…` assertions about those tools into no-ops. Keeping the
 * recipe in one place stops the two sweep tests from drifting apart.
 */
export interface ProductionRegistryOptions {
  /**
   * The `getService` half of the builtin wiring. Pass a `vi.fn` to assert that
   * services are resolved lazily (never during registration).
   */
  getService?: (id: string) => any
}

export async function buildProductionToolRegistry(
  opts: ProductionRegistryOptions = {},
): Promise<ToolRegistry> {
  const registry = createToolRegistry()

  await registerBuiltinTools(registry, {
    hasModule: () => true,
    getService: opts.getService ?? (() => ({})),
  })

  // Agent-module-owned tools, mirroring agent/index.ts onRegister. These
  // factories take service objects directly rather than getters, so the stub
  // proxy below is never consulted at registration and cannot affect a
  // laziness assertion made against `opts.getService`.
  const stub: any = new Proxy({}, { get: () => () => undefined })
  const { createDelegateTool } = await import('@modules/tools/builtin/delegate-tool.js')
  const { createAssignTaskTool } = await import('@modules/tools/builtin/assign-task-tool.js')
  const { createTeamTools, createProposeTeamTool } = await import('@modules/tools/builtin/team-tools.js')
  const { createAgentMessagingTools } = await import('@modules/tools/builtin/agent-messaging-tools.js')
  const { createProposeAgentTool } = await import('@modules/tools/builtin/propose-agent-tool.js')

  for (const t of createDelegateTool(stub, stub)) registry.register(t)
  for (const t of createAssignTaskTool({ getConversations: () => undefined, getStages: () => undefined })) registry.register(t)
  for (const t of createTeamTools(stub)) registry.register(t)
  for (const t of createProposeTeamTool(stub, stub, stub)) registry.register(t)
  for (const t of createAgentMessagingTools(stub)) registry.register(t)
  for (const t of createProposeAgentTool(stub, stub)) registry.register(t)

  // Design-module-owned tools, mirroring design/index.ts onStart. Same reason
  // as the agent tools above: a template may grant them, so a registry that
  // omits them makes the template-names contract fail on a tool that really
  // does exist in production.
  const { createDesignTools } = await import('@modules/design/design-tools.js')
  for (const t of createDesignTools({ designs: () => undefined })) registry.register(t)

  const { createHyperframesTools } = await import('@modules/studio/submodules/hyperframes/tools.js')
  for (const t of createHyperframesTools({ getGateway: () => undefined })) registry.register(t)

  const { createVideoUseTools } = await import('@modules/studio/submodules/videouse/tools.js')
  for (const t of createVideoUseTools({ getGateway: () => undefined })) registry.register(t)

  const { createBrowserUseTools } = await import('@modules/browser-use/tools.js')
  for (const t of createBrowserUseTools({
    getRunner: () => undefined,
    getSettings: () => ({
      enabled: true,
      cliPath: null,
      allowUvx: true,
      allowCloud: false,
      agentBrowser: { enabled: true, cliPath: null, allowedDomains: [] },
    }),
  })) registry.register(t)

  return registry
}
