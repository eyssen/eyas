// Part of eYssen. See LICENSE file for full copyright and licensing details.

// --- Working Memory ---

export interface WorkingMemoryBlock {
  key: string
  content: string
  maxTokens: number
  accessCount: number
  createdAt: string
  updatedAt: string
  expiresAt: string
}

// --- Episodic Memory ---

export type EpisodicSourceType = 'conversation' | 'extraction' | 'user' | 'system'

export interface EpisodicMemory {
  id: string
  content: string
  sourceType: EpisodicSourceType
  sourceId: string | null
  salience: number
  accessCount: number
  conversationCount: number
  validFrom: string
  validUntil: string | null
  tags: string[]
  embeddingHash: string | null
  agentId: string | null
  createdAt: string
  lastAccessedAt: string | null
}

export interface CreateEpisodicInput {
  content: string
  sourceType: EpisodicSourceType
  sourceId?: string
  tags?: string[]
  validFrom?: string
  agentId?: string
}

// --- Archive Memory ---

export interface ArchivedMemory {
  id: string
  originalId: string
  content: string
  sourceType: string
  tags: string[]
  archivedAt: string
  originalCreatedAt: string
}

// --- Vault ---

export type VaultTier = 'semantic' | 'procedural'

/**
 * What a durable note is ABOUT, which is also how it is ranked into the prompt.
 * `project` exists in the type from the start so a hand-written note declaring
 * it is not rejected; the index does not yet rank it — there is no mapping from
 * a conversation's project to a vault folder.
 */
export const MEMORY_KINDS = ['user', 'feedback', 'project', 'reference'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]

export interface VaultFrontmatter {
  title: string
  tags: string[]
  tier: VaultTier
  links: string[]
  /** Alternate titles that should resolve to this note (Obsidian-compatible). */
  aliases?: string[]
  created: string
  updated: string
  embedding_hash?: string
  /** Declared note kind. Absent on hand-written notes — see inferKind(). */
  kind?: MemoryKind
  /** The one line this note contributes to the always-on prompt index. */
  summary?: string
}

export interface VaultEntry {
  path: string
  frontmatter: VaultFrontmatter
  content: string
}

export interface VaultIndexRecord {
  path: string
  title: string
  tier: VaultTier
  tags: string
  contentText: string
  embeddingHash: string | null
  fileHash: string
  indexedAt: string
}

// --- Search ---

export interface MemorySearchQuery {
  query: string
  tiers?: ('episodic' | 'semantic' | 'procedural' | 'archive')[]
  tags?: string[]
  limit?: number
  validOnly?: boolean
}

export interface MemorySearchResult {
  source: 'episodic' | 'vault' | 'archive' | 'knowledge'
  id: string
  content: string
  score: number
  metadata: Record<string, unknown>
}

// --- Context Builder ---

export interface ContextSource {
  tier: string
  id: string
  tokens: number
}

export interface ContextBuildResult {
  workingBlocks: WorkingMemoryBlock[]
  relevantMemories: MemorySearchResult[]
  totalTokens: number
  sources: ContextSource[]
}

// --- Memory Config ---

export interface MemoryConfig {
  working: {
    ttlHours: number
    defaultBlocks: string[]
    maxTokensPerBlock: number
  }
  episodic: {
    decayRate: number
    promotionThreshold: number
    promotionMinAccess: number
    demotionThreshold: number
    demotionAgeDays: number
  }
  vault: {
    path: string
    watch: boolean
  }
  consolidation: {
    implicitExtraction: boolean
    autoDreamCron: string
    autoDreamModel: string
  }
  search: {
    contextBudgetTokens: number
    rrfK: number
    ftsWeightDefault: number
    vectorWeightDefault: number
  }
}

// --- Module Context Extension ---

export interface MemoryContext {
  working: import('./tiers/working-memory.js').WorkingMemoryService
  episodic: import('./tiers/episodic-memory.js').EpisodicMemoryService
  archive: import('./tiers/archive-memory.js').ArchiveMemoryService
  search: (query: MemorySearchQuery) => Promise<MemorySearchResult[]>
}
