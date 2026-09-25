// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/prompt-wizard/tools-section.ts
//
// The assembled system prompt's tool inventory: one line per tool the run is
// actually offered. It used to list the whole registry, so an agent with a
// narrow tool list was told about tools its request never carried (and went
// looking for them). The inventory now goes through the same scope every run
// path applies (agent/tool-scope.ts): the agent's allowlist plus the mandatory
// memory tools, minus the delegation family in Solo mode.
//
// Extracted from the module's onStart closure so the scoping has a test.

import { resolveToolScope, scopedToolDefinitions, type ToolDefinitionSource } from '@modules/agent/tool-scope.js'

export interface ToolInventoryLine {
  name: string
  oneLine: string
}

export interface ToolInventorySources {
  toolRegistry?: ToolDefinitionSource | null
  agents?: { get(id: string): { tools?: readonly string[] | null } | null | undefined } | null
  /** The conversation's orchestration mode ('solo' | 'auto' | 'deep'; null = auto). */
  orchestrationOf?: (conversationId: string) => string | null | undefined
}

/**
 * The tools a prompt for `agentId` in `conversationId` may name. An unknown
 * agent (a workspace-only persona) has no allowlist, so it sees every tool.
 * A missing registry, or any lookup that throws, means "no tools section",
 * never a failed turn.
 */
export function resolveToolInventory(
  sources: ToolInventorySources,
  agentId: string,
  conversationId: string | null,
): ToolInventoryLine[] {
  if (!sources.toolRegistry?.toToolDefinitions) return []
  try {
    const agentTools = sources.agents?.get(agentId)?.tools ?? undefined
    const orchestration = conversationId ? (sources.orchestrationOf?.(conversationId) ?? null) : null
    return scopedToolDefinitions(sources.toolRegistry, resolveToolScope({ agentTools, orchestration }))
      .map((t) => ({ name: t.name, oneLine: t.description }))
  } catch {
    return []
  }
}
