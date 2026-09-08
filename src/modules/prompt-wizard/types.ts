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
  zone: 'prefix' | 'suffix' | 'reminder' | 'append'
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
  tokenEstimate: { prefix: number; suffix: number; reminders: number }
  /** Per-section manifest of everything above. Concatenating `content` in order
   *  reproduces `prefix` and `suffix` byte-for-byte. */
  sections: ContextSection[]
}
