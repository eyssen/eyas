// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Skill-generation types — Phase 3J (Hermes self-improvement).
 *
 * Flow:
 *   trace → candidate → SKILL.md + binding → A/B experiment → adopt/reject
 *
 * Types are intentionally narrow: we don't want to import the full agent/
 * event-store/skills surface to keep this module standalone and easy to test.
 */

// --- Trace surface -----------------------------------------------------------

/**
 * Minimal slice of an agent trace that the candidate-extractor needs. The
 * real trace comes from the event-store, but we depend on this narrow port
 * so tests can feed synthetic traces without standing up a DB.
 */
export interface AgentTrace {
  sessionId: string
  /** Agent/persona that produced the trace — optional for provenance. */
  agentId?: string
  /** User intent / opening prompt of the session, used to mine triggers. */
  userGoal?: string
  toolCalls: TraceToolCall[]
  outcome: 'success' | 'failure' | 'aborted'
  /** Total turns (LLM↔tool loops). */
  turns: number
  /** USD cost if known. */
  costUsd?: number
  /** Start/end ms timestamps. */
  startedAt: number
  endedAt: number
}

export interface TraceToolCall {
  seq: number
  toolName: string
  input: Record<string, unknown>
  success: boolean
  durationMs: number
}

// --- Candidate ---------------------------------------------------------------

export interface ToolBinding {
  toolName: string
  /** JSON-schema-ish describing the input shape. */
  schema: Record<string, unknown>
}

export interface SkillCandidate {
  id: string
  fromSessionIds: string[]
  pattern: {
    name: string // slug, e.g. "odoo-module-scaffold"
    description: string // one-liner
    triggers: string[] // phrases/intents that should invoke
    toolChain: ToolBinding[]
  }
  observations: {
    timesObserved: number
    averageTurns: number
    averageCost: number
    successRate: number
  }
  proposedBy: 'sleep-time-consolidator' | 'operator'
  createdAt: number
}

// --- Generated skill artifact ------------------------------------------------

export interface GeneratedSkillMetadata {
  version: string
  candidateId: string
  experimentId?: string
  /** pending-experiment | adopted | rejected | rolled-back */
  adoptionStatus: 'pending-experiment' | 'running-experiment' | 'adopted' | 'rejected' | 'rolled-back'
  createdAt: number
  updatedAt: number
}

export interface GeneratedSkill {
  slug: string
  /** Absolute path to generated-skills/<slug>/ directory. */
  directory: string
  /** Absolute path to SKILL.md. */
  skillMdPath: string
  /** Absolute path to metadata.json. */
  metadataPath: string
  /** Full SKILL.md content (frontmatter + body). */
  skillMdContent: string
  metadata: GeneratedSkillMetadata
}

// --- SKILL.md frontmatter ----------------------------------------------------

export interface SkillFrontmatter {
  name: string
  description: string
  /** Conditions / trigger phrases that invoke the skill. */
  whenToInvoke: string[]
  /** Tools the skill coordinates. */
  tools: string[]
  /** MIT in this project — other values forbidden. */
  license: 'MIT'
  version: string
}

// --- A/B runner --------------------------------------------------------------

export type ABRecommendation = 'adopt' | 'reject' | 'more-data'

export interface ABResult {
  experimentId: string
  candidateSkillId: string
  baselineSuccessRate: number
  candidateSuccessRate: number
  /** Two-sided p-value. */
  pValue: number
  /**
   * True iff candidate > baseline by ≥5 percentage points AND p < 0.05.
   * False otherwise (including when pValue is NaN due to degenerate inputs).
   */
  significantImprovement: boolean
  tasksRun: number
  /** Total trials per arm — not tasks × variations. */
  trialsPerArm: number
  durationMs: number
  recommendation: ABRecommendation
  /** Human-readable note (why 'more-data', why rejected, etc.). */
  note: string
  /** Statistical method applied — z-test or fisher. */
  method: 'two-proportion-z' | 'fisher-exact'
}

export interface ABExperimentRecord {
  id: string
  candidateSkillId: string
  startedAt: number
  finishedAt: number
  result: ABResult
}

// --- Adoption ----------------------------------------------------------------

export type AdoptionAction =
  | 'adopted'
  | 'rejected'
  | 'queued-more-data'
  | 'noop-already-adopted'
  /** Task 9 (gated apply): 'adopt' recommendation was enqueued for owner approval instead of registered immediately — set only when the adopter is given an approvalQueue. */
  | 'pending-approval'

export interface AdoptionEvent {
  id: string
  candidateSkillId: string
  experimentId: string
  action: AdoptionAction
  timestamp: number
  /** Human-readable reason — especially useful for reject/rollback entries. */
  reason: string
}

// --- Rollback ----------------------------------------------------------------

export interface RollbackTrigger {
  candidateSkillId: string
  /** Baseline success rate at adoption time. */
  baselineSuccessRate: number
  /** Observed success rate in production over monitoring window. */
  observedSuccessRate: number
  /** N production invocations observed. */
  observedN: number
  /** Reason for rollback (e.g. "success rate dropped 12 points below baseline"). */
  reason: string
  detectedAt: number
}

// --- Ports -------------------------------------------------------------------

/** Narrow trace port — keeps the module independent of event-store internals. */
export interface TraceSource {
  /** Return successful traces in a window. */
  listSuccessfulTraces(sinceTs: number): AgentTrace[]
}

/**
 * Placeholder registry port. This module does NOT touch the real skills
 * module — on adoption we log the intended registration via this port and
 * leave actual wiring to a later phase.
 */
export interface SkillRegistryPort {
  register(skill: GeneratedSkill): Promise<void>
  unregister(slug: string): Promise<void>
  isRegistered(slug: string): Promise<boolean>
}

// --- Config / thresholds -----------------------------------------------------

/**
 * Adoption thresholds. Exposed so tests and operators can tune.
 */
export interface AdoptionThresholds {
  /** Minimum absolute improvement in success rate (0..1). Default 0.05 (5pp). */
  minImprovement: number
  /** Two-sided alpha level. Default 0.05. */
  alpha: number
  /** Minimum trials per arm before a z-test is trusted. Below this → Fisher. */
  zTestMinN: number
}

export const DEFAULT_ADOPTION_THRESHOLDS: AdoptionThresholds = {
  minImprovement: 0.05,
  alpha: 0.05,
  zTestMinN: 10,
}
