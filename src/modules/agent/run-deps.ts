// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * I10 — the ONE dependency bundle every background conversation run shares,
 * and the one runner entry built on it.
 *
 * Board bot runs (stage automation, assign_task), scheduled agent_run jobs,
 * colleague hand-offs, retry/refresh, the approval resume, the auto-retry
 * sweep, boot recovery and God Mode all drive a conversation through
 * runConversation/resumeRun with THIS bundle. A caller that assembles its own
 * partial bundle silently loses whatever it forgot (designs, documents,
 * durable-memory capture, the critic, the context recorder) — which is how the
 * bot-executor ran without capture while a retry of the same card had it.
 *
 * Everything another module publishes is read per access (getters), because
 * module registration order is not guaranteed: a by-value read taken while
 * the agent module registers could stay undefined for the life of the process.
 */

import type { ModuleContext } from '@core/types'
import type { CaptureInput } from '@modules/memory/capture/index.js'
import type { ModelPair } from '@modules/model/binding.js'
import {
  runConversation,
  type ConversationCriticDeps,
  type ConversationVerifyDeps,
  type ResumeRunDeps,
  type RunConversationOverrides,
  type RunConversationResult,
} from './conversation-runner.js'

export interface RunDepsSources {
  ctx: ModuleContext
  agentRunner: ResumeRunDeps['agentRunner']
  agentRegistry: ResumeRunDeps['agentRegistry']
  supervisor: ResumeRunDeps['supervisor']
  critic: ConversationCriticDeps
  verify: ConversationVerifyDeps
  budgetEngine: ResumeRunDeps['budgetEngine']
  getCheckpoint: ResumeRunDeps['getCheckpoint']
}

/** Runs one conversation's goal as a supervised background run. */
export type RunConversationEntry = (
  conversationId: string,
  overrides?: RunConversationOverrides,
) => Promise<RunConversationResult>

export function createRunDeps(src: RunDepsSources): ResumeRunDeps {
  const c = src.ctx as any
  return {
    db: src.ctx.db,
    agentRunner: src.agentRunner,
    agentRegistry: src.agentRegistry,
    get toolRegistry() { return c.tools?.registry },
    supervisor: src.supervisor,
    logger: src.ctx.logger,
    // The prompt assembler builds the turn block (clock + recall from
    // ctx.memoryRecall); the runner attaches it to the run's message.
    get promptAssembler() { return c.promptAssembler },
    // F2 T7 — the completeness critic (and the feedback resume it can start)
    // and P1's deterministic verify commands.
    critic: src.critic,
    verify: src.verify,
    // The event-store module exposes its service in its own onStart.
    get eventStore() { return c.eventStore?.events },
    getCheckpoint: src.getCheckpoint,
    // F2 T8 — threshold-band alert emission on token tracking.
    budgetEngine: src.budgetEngine,
    // F2 T9 — config `model.pricing` override, read fresh (config reload).
    get pricingOverrides() { return c.config?.model?.pricing },
    // Task 11 — records what actually reached the model on each run.
    get contextRecorder() { return c.contextRecorder },
    // F7 — designs attached to the conversation, and the documents service so
    // what a background run writes is findable rather than only on disk.
    getDesigns: () => c.designs,
    getDocuments: () => c.documents,
    // F1 — durable-memory capture. A build without the memory module
    // captures nothing; it never fails the run.
    memoryCapture: (input: CaptureInput) => c.memoryCapture?.(input) ?? Promise.resolve(),
    // H4 — the run's provider and model come from one binding of its
    // conversation; the default is fixed on a conversation that has none.
    get modelBinding() { return src.ctx.modelBinding },
    materializeBinding: (conversationId: string, pair: ModelPair) =>
      c.conversations?.materializeBinding?.(conversationId, pair.providerId, pair.modelId) ?? null,
  }
}

/** The runner entry published as ctx.agents.runConversation. */
export function createRunConversationEntry(deps: ResumeRunDeps): RunConversationEntry {
  return (conversationId, overrides) => runConversation(conversationId, deps, overrides)
}
