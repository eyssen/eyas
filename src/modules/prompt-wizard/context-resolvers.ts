// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/prompt-wizard/context-resolvers.ts
// Resolves live team + working-memory + code-search context for the prompt assembler.
// Read services off ctx INSIDE the call (lazy) so module load order is irrelevant.
import type {
  TeamContextSummary,
  MemoryContextSummary,
  CodeSearchContextSummary,
  WorkingDirectoriesContext,
  ConversationTagLine,
} from './cache-suffix-builder.js'
import { parseWorkingDirectories } from '@modules/tools/working-directories.js'

export async function resolveTeamContextImpl(
  ctx: any,
  conversationId: string | null,
): Promise<TeamContextSummary | null> {
  if (!conversationId) return null
  try {
    const teamSessions = (ctx as any).agents?.teamSessions
    const registry = (ctx as any).agents?.registry
    if (!teamSessions?.listByConversation) return null
    const sessions = teamSessions.listByConversation(conversationId) as any[]
    if (!sessions?.length) return null
    const active = sessions.find((s) => s.status === 'running') ?? sessions[0]
    if (!active) return null
    let ids: string[] = []
    try {
      const cfg = JSON.parse(active.config)
      ids = [...new Set((cfg?.phases ?? []).flatMap((p: any) => p.agents ?? []))] as string[]
    } catch {
      ids = []
    }
    const members = ids.map((id) => {
      const a = registry?.get?.(id)
      return { name: a?.name ?? id, tier: a?.tier ?? 'specialist', status: active.status }
    })
    const sharedMemoryEntryCount = teamSessions.readMemory?.(active.id)?.length ?? 0
    return { teamSessionId: active.id, members, sharedMemoryEntryCount }
  } catch {
    ;(ctx as any)?.logger?.debug?.('team context resolve failed; omitting')
    return null
  }
}

export async function resolveMemoryContextImpl(
  ctx: any,
  conversationId: string | null,
  agentId: string,
): Promise<MemoryContextSummary | null> {
  try {
    const working = (ctx as any).memory?.working
    // agent-scoped only — never listAll() (would leak other agents' working memory)
    const blocks = agentId ? (working?.listByPrefix?.(`${agentId}:`) ?? []) : []
    const workingMemory = (blocks as any[]).map((b) => ({ content: b.content }))
    let goalAncestry: string | null = null
    if (conversationId) {
      const chain = (ctx as any).conversations?.getAncestry?.(conversationId) ?? []
      const goals = (chain as any[])
        .filter((c) => c.goalDescription)
        .map((c) => `[${c.title ?? 'Untitled'}] ${c.goalDescription}`)
      goalAncestry = goals.length ? goals.join(' -> ') : null
    }
    if (workingMemory.length === 0 && !goalAncestry) return null
    return { workingMemory, goalAncestry }
  } catch {
    ;(ctx as any)?.logger?.debug?.('memory context resolve failed; omitting')
    return null
  }
}

export async function resolveCodeSearchContextImpl(
  ctx: any,
  conversationId: string | null,
): Promise<CodeSearchContextSummary | null> {
  try {
    const search = (ctx as any).search
    if (!search?.resolveContext) return null
    const pin = search.resolveContext.resolve({ conversationId })
    return {
      reason: pin.reason,
      pinned: pin.pinned,
      needsPin: pin.needsPin,
      sources: pin.sources.map((s: any) => ({
        id: s.id,
        name: s.name,
        label: s.config?.label,
        version: s.config?.version,
        edition: s.config?.edition,
        status: s.status,
      })),
    }
  } catch {
    ;(ctx as any)?.logger?.debug?.('code search context resolve failed; omitting')
    return null
  }
}

export async function resolveConversationTagsImpl(
  ctx: any,
  conversationId: string | null,
): Promise<ConversationTagLine[] | null> {
  if (!conversationId) return null
  try {
    const tags = (ctx as any).board?.tags?.getConversationTags?.(conversationId) as
      | Array<{ name?: string; categoryName?: string | null }>
      | undefined
    if (!tags?.length) return null
    const lines: ConversationTagLine[] = tags
      .filter((t) => typeof t.name === 'string' && t.name.trim().length > 0)
      .map((t) => ({ name: t.name!.trim(), categoryName: t.categoryName?.trim() || null }))
    return lines.length ? lines : null
  } catch {
    ;(ctx as any)?.logger?.debug?.('conversation tags resolve failed; omitting')
    return null
  }
}

export async function resolveWorkingDirectoriesContextImpl(
  ctx: any,
  conversationId: string | null,
): Promise<WorkingDirectoriesContext | null> {
  if (!conversationId) return { primary: null, extra: [] }
  try {
    const conv = (ctx as any).conversations?.get?.(conversationId)
    const dirs = parseWorkingDirectories(conv?.workingDirectories ?? conv?.working_directories)
    if (dirs.length === 0) return { primary: null, extra: [] }
    return { primary: dirs[0], extra: dirs.slice(1) }
  } catch {
    ;(ctx as any)?.logger?.debug?.('working directories context resolve failed; omitting')
    return { primary: null, extra: [] }
  }
}
