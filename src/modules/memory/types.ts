// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { TrustTier } from './v2/ingest-bridge.js'

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

export type EpisodicSourceType = 'conversation' | 'extraction' | 'user' | 'system' | 'agent-memory'

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
  conversationId?: string | null
  projectId?: string | null
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
  conversationId?: string | null
  projectId?: string | null
  /**
   * Whether the row is handed to the `onCreated` hook, which is what schedules
   * its embedding. Default `true`. The importer passes `false`: a bulk import
   * must not make a model call per row, and the ordinary background pass picks
   * the rows up afterwards.
   */
  embed?: boolean
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
 * `project` is the active board project; `domain` is that project's type
 * (shared across sibling projects). Recall ranks both; other projects' notes
 * stay out.
 */
export const MEMORY_KINDS = ['user', 'feedback', 'domain', 'project', 'reference'] as const
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
  /** Board project id this note is scoped to. Set at capture, frozen. */
  project?: string
  /** Board project-type id this note is scoped to. Set at capture, frozen. */
  projectType?: string
  /**
   * Where this note came from when it was imported rather than captured. Read
   * back on parse so a later rewrite of the note cannot quietly drop it.
   */
  source?: Record<string, unknown>
  /**
   * Which EYAS writer authored the note, when a model did (capture, nightly
   * consolidation, team summaries). A note that carries it is remembered with
   * 'derived' trust, never as the owner's own words (vault/vault-trust.ts).
   */
  origin?: VaultNoteOrigin
  /**
   * An explicit trust tier. It can only LOWER the note's derived trust —
   * `trust: quarantined` keeps a note out of every recall — never raise it.
   */
  trust?: TrustTier
  /**
   * The background model that suggested an imported note's metadata (kind,
   * summary, tags, links) — the body is never the model's. Read back on parse
   * so a later rewrite cannot drop it.
   */
  enriched_by?: VaultNoteEnrichment
}

/** frontmatter `enriched_by`: what answered an import's enrichment call, and the ladder rung that chose it. */
export interface VaultNoteEnrichment {
  provider: string
  model?: string
  route?: string
}

/** frontmatter `origin`: the EYAS writer that authored a note, plus what it knew. */
export interface VaultNoteOrigin {
  /** The writer: 'capture', 'consolidation', 'team', … */
  by: string
  provider?: string
  model?: string
  conversationId?: string
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

/** Vault-note window for search_memory. `current` is the tool default. */
export type MemorySearchScope = 'current' | 'all'

export interface MemorySearchQuery {
  query: string
  tiers?: ('episodic' | 'semantic' | 'procedural' | 'archive' | 'conversation')[]
  tags?: string[]
  limit?: number
  validOnly?: boolean
  /**
   * `current`: active project + its type + global kinds.
   * `all`: other projects too. Omit to leave vault notes unfiltered (HTTP / legacy).
   */
  scope?: MemorySearchScope
  /** Effective project of the calling conversation. Used when scope is `current`. */
  projectId?: string | null
  /** When omitted, looked up from `projects.type_id`. Pass `null` to skip. */
  projectTypeId?: string | null
  /** Drop L0 hits from this conversation (the turn already has its own messages). */
  excludeConversationId?: string | null
}

export interface MemorySearchResult {
  source: 'episodic' | 'vault' | 'archive' | 'knowledge' | 'conversation' | 'raw' | 'gist' | 'fact' | 'entity'
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
    /** No path: the vault is always InstancePaths.vaultDir (`<data dir>/vault`). */
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

/**
 * The seed catch-all project. Conversations default into it, so for MEMORY it
 * is "no project": capture never emits project facts there and recall treats
 * it as projectless (spec D2). Mirrors the seed id in board/index.ts.
 */
export const MEMORY_DEFAULT_PROJECT_ID = 'general-general'

export function effectiveProjectId(id: string | null | undefined): string | null {
  return id && id !== MEMORY_DEFAULT_PROJECT_ID ? id : null
}
