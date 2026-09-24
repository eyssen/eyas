// Part of eYssen. See LICENSE file for full copyright and licensing details.

export type PromptLevel = 'master' | 'project_type' | 'project' | 'conversation'

export interface PromptTemplate {
  id: string
  level: PromptLevel
  targetId?: string      // projectTypeId, projectId, or conversationId (null for master)
  name: string
  content: string
  section?: string
  locked: boolean
  isActive: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface PromptChainInput {
  master: string | null
  projectType: string | null
  project: string | null
  conversation: string | null
}

export interface CreatePromptTemplateInput {
  level: PromptLevel
  targetId?: string
  name: string
  content: string
  section?: string
  locked?: boolean
  createdBy: string
}

export interface PromptSection {
  name: string
  content: string
  source: PromptLevel | 'agent' | 'dynamic'
}

export interface SubAgentPromptOptions {
  agentId: string
  parentConversationId: string
  delegatedTask: string
}

// ─── v2 Prompt Architecture types ─────────────────────────────────────────────
// These types support the new file-based agent workspace + cache-aware assembly.

export type VoiceScope = 'internal' | 'external'

export type AddressForm = 'tegező' | 'magázó' | 'önöző' | 'kontextus-érzékeny'

export interface VoiceProfile {
  address: AddressForm
  tone: 'komoly' | 'kiegyensúlyozott' | 'baráti' | 'laza' | 'játékos'
  verbosity: 'lényegre törő' | 'kiegyensúlyozott' | 'részletező'
  directness: 'nagyon direkt' | 'direkt + udvarias' | 'diplomatikus' | 'körülíró'
  humor: 'nincs' | 'száraz/szellemes' | 'könnyed' | 'csípős/provokatív'
  emoji: 'soha' | 'funkcionálisan' | 'gyakran'
  blockedPhrases: string[]
  signature: string
}

export interface SoulStyle {
  $schema?: string
  version: 1
  preset: { internal: string; external: string }  // preset key or 'custom'
  internal: VoiceProfile  // address restricted to non-context-aware (validated at schema)
  external: VoiceProfile
}

export interface ParentSnapshot {
  agentId: string                 // originating agent ID
  name: string
  voiceProfile: VoiceProfile
  voiceProfileSource: VoiceScope
  blockedPhrases: string[]
  signature: string
  originatingAgentId: string
}

/** One context section as it appears in the assembled prompt. */
export interface ContextSection {
  /**
   * Where the text goes. 'turn' is the per-message block attached to the
   * current user message (AssembledPrompt.turn), never to the system prompt.
   */
  zone: 'prefix' | 'suffix' | 'reminder' | 'append' | 'turn'
  /** Tag name as it appears in the prompt, e.g. 'core-identity', 'skill'. */
  key: string
  /** Skill id, file path, project id — whatever identifies the concrete source. */
  sourceRef?: string
  /** The FINAL rendered text, tags included, exactly as concatenated into the prompt. */
  content: string
  chars: number
  estimatedTokens: number
  /** The cap that applied; undefined for unbudgeted appends. */
  budgetTokens?: number
  truncated: boolean
  droppedChars: number
}

/**
 * v2 prompt structure — provider-agnostic with explicit cache boundary.
 */
export interface AssembledPrompt {
  prefix: string                  // stable cache prefix
  suffix: string                  // dynamic per-turn
  reminders: string[]             // per-message reminders
  cacheBoundaryHint: number       // char-pos of prefix/suffix boundary
  prefixHash: string              // sha256(prefix), 64 hex chars
  tokenEstimate: { prefix: number; suffix: number; reminders: number; turn?: number }
  /** Per-section manifest of everything above. Concatenating the prefix and
   *  suffix sections' `content` in order reproduces `prefix` and `suffix`
   *  byte-for-byte; the 'turn' sections are the parts inside `turn`'s frame. */
  sections: ContextSection[]
  /**
   * The per-message turn block: the clock and what EYAS recalled for this
   * message, in one <turn-context> frame. It is attached to the current user
   * message (assemble-system.ts attachTurnContext), never flattened into the
   * system prompt, so the system prompt stays stable across turns and the
   * stored user message is never modified.
   */
  turn?: string
  /** Who the prompt was sized for; set by the assembler. */
  delivery?: PromptDelivery
}

/** Why a turn block carries no recall. */
export type RecallWithheld =
  /** The answer goes to someone other than the owner (A2A peer, external-voice channel). */
  | 'external'
  /** The model's window leaves the recall block no room. */
  | 'no-budget'
  /** No conversation to recall for, or no memory module. */
  | 'unavailable'
  /** The recall service threw; the turn carries the time only. */
  | 'failed'

/** What reached the model as recalled memory this turn. */
export interface RecallDelivery {
  /** Every id in the block, in block order (standing, then retrieved). */
  ids: string[]
  /** Ids retrieved for this message. */
  retrieved: string[]
  /** Ids (retrieved, or standing lines this message matched) whose full text was attached. */
  expanded: string[]
  /** Length of the recall block. */
  chars: number
  /** The recall block's cap for this model's window. */
  budgetChars: number
  /** The turn the access-log rows carry (memory_access_log rank_detail_json.turnId). */
  turnId: string
  withheld?: RecallWithheld
}

/** The model a prompt was assembled for, and the budget that gave it. */
export interface PromptDelivery {
  profile: import('./delivery-profile.js').DeliveryProfile
  /** Sum of the section caps (token-budget.ts) the prompt was built under. */
  budgetTotalTokens: number
  /** The recall part of the turn block; absent when the assembler had no turn to build. */
  recall?: RecallDelivery
}
