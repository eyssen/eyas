// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolRegistry } from './tool-registry.js'

/**
 * Module-service access for the builtin tool set.
 *
 * `getService` is called PER TOOL CALL, never at registration. The module
 * loader runs every module's `onRegister` before any `onStart`, and most
 * services a builtin tool needs (memory, knowledge, documents, research, and
 * `search.engine`) are only published in their owner's `onStart`. Binding a
 * service instance while registering therefore captures `undefined` for the
 * lifetime of the process — the same trap the executor's `getSecurityGate`
 * lazy hook already avoids.
 */
export interface BuiltinToolWiring {
  hasModule(id: string): boolean
  getService(id: string): any
}

/**
 * Register every builtin tool that does not belong to the agent module.
 *
 * Agent-owned tools (delegate_to_agent, the team tools, propose_team,
 * propose_agent_creation and the agent messaging pair) are deliberately NOT
 * registered here: `agent/index.ts` owns them and registers them from its own
 * `onRegister`, where its services exist. Registering them here as well would
 * throw on the duplicate name at boot.
 */
export async function registerBuiltinTools(
  registry: ToolRegistry,
  wiring: BuiltinToolWiring,
): Promise<void> {
  if (wiring.hasModule('memory')) {
    const { createMemoryTools } = await import('./builtin/memory-tools.js')
    for (const tool of createMemoryTools(() => wiring.getService('memory'))) registry.register(tool)

    // F4 memory blocks — service is published on ctx.memoryBlocks by the memory module.
    const { createMemoryBlockTools } = await import('./builtin/memory-block-tools.js')
    for (const tool of createMemoryBlockTools(() => wiring.getService('memoryBlocks'))) {
      registry.register(tool)
    }
  }
  if (wiring.hasModule('search')) {
    const { createSearchTools } = await import('./builtin/search-tools.js')
    for (const tool of createSearchTools(() => wiring.getService('search'))) registry.register(tool)
  }
  if (wiring.hasModule('knowledge')) {
    const { createKnowledgeTools } = await import('./builtin/knowledge-tools.js')
    for (const tool of createKnowledgeTools(() => wiring.getService('knowledge'))) registry.register(tool)
  }
  if (wiring.hasModule('conversations')) {
    const { createConversationTools } = await import('./builtin/conversation-tools.js')
    for (const tool of createConversationTools(() => wiring.getService('conversations'))) registry.register(tool)
  }
  if (wiring.hasModule('board')) {
    const { createBoardTools } = await import('./builtin/board-tools.js')
    const tools = createBoardTools({
      getBoard: () => wiring.getService('board'),
      getConversations: () => wiring.getService('conversations'),
    })
    for (const tool of tools) registry.register(tool)
  }
  if (wiring.hasModule('documents')) {
    const { createDocumentTools } = await import('./builtin/document-tools.js')
    for (const tool of createDocumentTools(() => wiring.getService('documents'))) registry.register(tool)
  }
  if (wiring.hasModule('research')) {
    const { createResearchTools } = await import('./builtin/research-tools.js')
    for (const tool of createResearchTools(() => wiring.getService('research'))) registry.register(tool)
  }
  // A2A delegation tools (no module dependency, uses HTTP client)
  if (wiring.hasModule('communication')) {
    const { createA2ADelegateTools } = await import('./builtin/a2a-delegate-tools.js')
    for (const tool of createA2ADelegateTools()) registry.register(tool)

    const { createChannelTools } = await import('./builtin/channel-tools.js')
    for (const tool of createChannelTools({
      getRouter: () => wiring.getService('communication')?.router ?? null,
    })) {
      registry.register(tool)
    }
  }

  // Google Docs — service account JSON from secrets (optional)
  {
    const { createGdocsTools } = await import('./builtin/gdocs-tools.js')
    for (const tool of createGdocsTools({
      getServiceAccountJson: async () => {
        try {
          // secrets lives on ModuleContext, not under a module-id map key
          const secrets = wiring.getService('secrets')
            ?? (wiring as any).ctx?.secrets
          // Fallback: tools wiring only exposes module services; secrets is on ctx root.
          // register-builtins is called with getService: (id) => (ctx as any)[id]
          // so getService('secrets') works when ctx.secrets is set.
          return (await secrets?.get?.('google-docs-sa-json', 'system')) ?? null
        } catch {
          return null
        }
      },
    })) {
      registry.register(tool)
    }
  }

  // Scheduler — agent-managed recurring work (lazy getService)
  if (wiring.hasModule('scheduler')) {
    const { createScheduleTools } = await import('./builtin/schedule-tools.js')
    for (const tool of createScheduleTools(() => wiring.getService('scheduler'))) {
      registry.register(tool)
    }
  }

  // Shell and browser tools don't depend on modules but accept a service arg
  const { createShellTools } = await import('./builtin/shell-tools.js')
  for (const tool of createShellTools(undefined)) registry.register(tool)

  // Model-agnostic coding surface (P0) + review helpers (P2)
  const { createFileTools } = await import('./builtin/file-tools.js')
  for (const tool of createFileTools()) registry.register(tool)

  const { createReviewTools } = await import('./builtin/review-tools.js')
  for (const tool of createReviewTools()) registry.register(tool)

  const { createBrowserTools } = await import('./builtin/browser-tools.js')
  for (const tool of createBrowserTools(undefined)) registry.register(tool)
}
