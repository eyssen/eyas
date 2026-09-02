// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Context Builder v2 — assembles AI context from memory tiers.
 * Supports cross-agent sharing: parent goals, sibling discoveries, shared memory.
 */

export interface ContextAssemblyOptions {
  conversationId: string
  agentId?: string                   // Agent ID for scoped memory lookup
  includeAncestry: boolean        // Include parent/grandparent goals
  includeSiblingDiscoveries: boolean  // Include broadcast memories from siblings
  maxTokenBudget: number          // Max tokens for assembled context (rough estimate)
  strategy: 'balanced' | 'recency' | 'relevance' | 'minimal'
}

export interface ContextSection {
  source: string             // 'working' | 'episodic' | 'vault' | 'ancestry' | 'sibling'
  content: string
  relevanceScore: number     // 0-1
  tokenEstimate: number
}

export interface AssembledContext {
  sections: ContextSection[]
  totalTokenEstimate: number
  truncated: boolean
  includedSources: string[]
  excludedReasons: { source: string; reason: string }[]
}

// Rough token estimation: ~4 chars per token
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function createContextBuilderV2(deps: {
  memory?: any              // MemoryService (optional)
  conversations?: any       // ConversationService (optional)
  embeddingBridge?: { embed(texts: string[]): Promise<Float32Array[] | null> }
}) {
  const { memory, conversations } = deps

  return {
    /**
     * Assemble context for an AI request.
     * Queries relevant memories, applies strategy, respects token budget.
     */
    async assemble(
      query: string,
      options: ContextAssemblyOptions,
    ): Promise<AssembledContext> {
      const sections: ContextSection[] = []
      const excludedReasons: { source: string; reason: string }[] = []
      let remainingBudget = options.maxTokenBudget

      // 1. Goal ancestry (if enabled and conversation service available)
      if (options.includeAncestry && conversations) {
        try {
          const ancestry = conversations.getAncestry(options.conversationId)
          const goals = ancestry
            .filter((c: any) => c.goalDescription)
            .map((c: any) => `[${c.title ?? 'Untitled'}] ${c.goalDescription}`)

          if (goals.length > 0) {
            const content = `Goal hierarchy:\n${goals.map((g: string, i: number) => `${'  '.repeat(i)}→ ${g}`).join('\n')}`
            const tokens = estimateTokens(content)
            if (tokens <= remainingBudget) {
              sections.push({ source: 'ancestry', content, relevanceScore: 1.0, tokenEstimate: tokens })
              remainingBudget -= tokens
            } else {
              excludedReasons.push({ source: 'ancestry', reason: 'Exceeds token budget' })
            }
          }
        } catch {
          // Conversation service not available
        }
      }

      // 2. Working memory (highest priority, most recent)
      if (memory) {
        try {
          // Agent-scoped working memory
          if (options.agentId && memory.listByPrefix) {
            const prefix = `${options.agentId}:`
            const agentBlocks = await memory.listByPrefix(prefix)
            for (const block of agentBlocks ?? []) {
              const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
              const tokens = estimateTokens(content)
              if (tokens <= remainingBudget) {
                sections.push({ source: 'working', content: `[${block.key}] ${content}`, relevanceScore: 0.95, tokenEstimate: tokens })
                remainingBudget -= tokens
              }
            }
          } else {
            // Fallback: conversation-scoped working memory
            const working = await memory.getWorkingMemory?.(options.conversationId)
            if (working && working.length > 0) {
              for (const block of working) {
                const content = typeof block.value === 'string' ? block.value : JSON.stringify(block.value)
                const tokens = estimateTokens(content)
                if (tokens <= remainingBudget) {
                  sections.push({ source: 'working', content, relevanceScore: 0.95, tokenEstimate: tokens })
                  remainingBudget -= tokens
                }
              }
            }
          }
        } catch {
          // Working memory not available
        }
      }

      // 3. Episodic memory (search by relevance)
      if (memory && remainingBudget > 200) {
        try {
          const episodic = await memory.search?.(query, {
            tier: 'episodic',
            limit: 5,
            agentId: options.agentId,
            includeShared: true,
          })
          if (episodic?.results) {
            for (const result of episodic.results) {
              const content = result.content ?? result.text ?? String(result)
              const tokens = estimateTokens(content)
              if (tokens <= remainingBudget) {
                sections.push({
                  source: 'episodic',
                  content,
                  relevanceScore: result.score ?? 0.5,
                  tokenEstimate: tokens,
                })
                remainingBudget -= tokens
              }
            }
          }
        } catch {
          // Episodic search not available
        }
      }

      // 4. Vault/semantic memory (if budget allows)
      if (memory && remainingBudget > 500) {
        try {
          const vault = await memory.search?.(query, { tier: 'vault', limit: 3 })
          if (vault?.results) {
            for (const result of vault.results) {
              const content = result.content ?? result.text ?? String(result)
              const tokens = estimateTokens(content)
              if (tokens <= remainingBudget) {
                sections.push({
                  source: 'vault',
                  content,
                  relevanceScore: result.score ?? 0.4,
                  tokenEstimate: tokens,
                })
                remainingBudget -= tokens
              }
            }
          }
        } catch {
          // Vault search not available
        }
      }

      // 5. Sibling discoveries (broadcast memories from sibling conversations)
      if (options.includeSiblingDiscoveries && conversations) {
        try {
          const conv = conversations.get(options.conversationId)
          if (conv?.parentConversationId) {
            const siblings = conversations.getChildren(conv.parentConversationId)
            for (const sibling of siblings) {
              if (sibling.id === options.conversationId) continue
              // Check sibling's working memory for broadcast entries
              if (memory?.getWorkingMemory) {
                const siblingMemory = await memory.getWorkingMemory(sibling.id)
                for (const block of siblingMemory ?? []) {
                  if (block.key?.startsWith('broadcast:')) {
                    const content = `[From ${sibling.title}] ${typeof block.value === 'string' ? block.value : JSON.stringify(block.value)}`
                    const tokens = estimateTokens(content)
                    if (tokens <= remainingBudget) {
                      sections.push({ source: 'sibling', content, relevanceScore: 0.7, tokenEstimate: tokens })
                      remainingBudget -= tokens
                    }
                  }
                }
              }
            }
          }
        } catch {
          // Sibling access not available
        }
      }

      // 6. Vector-enhanced search (if embedding bridge available)
      if (deps.embeddingBridge && remainingBudget > 300) {
        try {
          const embeddings = await deps.embeddingBridge.embed([query])
          if (embeddings && embeddings.length > 0) {
            // Vector search would query Orama or sqlite-vec here
            // For now, the embedding bridge enables downstream vector search
            // The actual vector index query depends on the search engine implementation
          }
        } catch { /* embedding not available */ }
      }

      // Sort by strategy
      if (options.strategy === 'relevance') {
        sections.sort((a, b) => b.relevanceScore - a.relevanceScore)
      } else if (options.strategy === 'recency') {
        // Keep insertion order (already ordered by recency)
      } else if (options.strategy === 'minimal') {
        // Keep only top items by relevance, within 50% of budget
        const minBudget = options.maxTokenBudget * 0.5
        sections.sort((a, b) => b.relevanceScore - a.relevanceScore)
        let used = 0
        const kept: ContextSection[] = []
        for (const s of sections) {
          if (used + s.tokenEstimate <= minBudget) {
            kept.push(s)
            used += s.tokenEstimate
          }
        }
        sections.length = 0
        sections.push(...kept)
      }

      const totalTokenEstimate = sections.reduce((sum, s) => sum + s.tokenEstimate, 0)

      return {
        sections,
        totalTokenEstimate,
        truncated: remainingBudget < options.maxTokenBudget * 0.1,
        includedSources: [...new Set(sections.map(s => s.source))],
        excludedReasons,
      }
    },

    /**
     * Format assembled context into a string for the system prompt.
     */
    format(assembled: AssembledContext): string {
      if (assembled.sections.length === 0) return ''

      const parts: string[] = []

      // Group by source
      const bySource = new Map<string, ContextSection[]>()
      for (const s of assembled.sections) {
        const arr = bySource.get(s.source) ?? []
        arr.push(s)
        bySource.set(s.source, arr)
      }

      if (bySource.has('ancestry')) {
        parts.push(`<goal-context>\n${bySource.get('ancestry')!.map(s => s.content).join('\n')}\n</goal-context>`)
      }
      if (bySource.has('working')) {
        parts.push(`<working-memory>\n${bySource.get('working')!.map(s => s.content).join('\n---\n')}\n</working-memory>`)
      }
      if (bySource.has('episodic')) {
        parts.push(`<relevant-memories>\n${bySource.get('episodic')!.map(s => s.content).join('\n---\n')}\n</relevant-memories>`)
      }
      if (bySource.has('vault')) {
        parts.push(`<knowledge>\n${bySource.get('vault')!.map(s => s.content).join('\n---\n')}\n</knowledge>`)
      }
      if (bySource.has('sibling')) {
        parts.push(`<sibling-discoveries>\n${bySource.get('sibling')!.map(s => s.content).join('\n---\n')}\n</sibling-discoveries>`)
      }

      return parts.join('\n\n')
    },
  }
}
