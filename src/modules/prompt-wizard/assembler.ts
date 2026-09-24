// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { createHash } from 'node:crypto'
import type { WorkspaceLoader } from './workspace-loader.js'
import type { AssembledPrompt, ContextSection, PromptDelivery, RecallDelivery, RecallWithheld, VoiceProfile, VoiceScope } from './types.js'
import type { SectionBudget } from './token-budget.js'
import type { MemoryRecallInput, RecallResult } from '@modules/memory/v2/assemble.js'
import { MEMORY_RECALL_SECTION_KEY } from '@modules/memory/v2/assemble.js'
import { formatNow } from '@shared/clock.js'
import { generateId } from '@shared/crypto.js'
import { renderFence } from '@shared/untrusted.js'
import { TURN_CONTEXT_TAG } from './assemble-system.js'
import { buildCachePrefix } from './cache-prefix-builder.js'
import { selectBridgeTools } from '@modules/tools/cli-exposure.js'
import { nativeCapabilitiesFor, requestToolScope } from '@modules/agent/tool-scope.js'
import {
  buildCacheSuffix,
  type RuntimeContext,
  type TeamContextSummary,
  type MemoryContextSummary,
  type CodeSearchContextSummary,
  type WorkingDirectoriesContext,
  type ConversationTagLine,
} from './cache-suffix-builder.js'
import { budgetForWindow, estimateTokens, totalBudget, tokensToChars } from './token-budget.js'
import { masterVariantFor, renderMasterSections } from './master-variant.js'
import {
  budgetWindowOf,
  unresolvedDeliveryProfile,
  type DeliveryProfile,
  type DeliveryTarget,
} from './delivery-profile.js'

export interface AssemblerDeps {
  workspaceLoader: WorkspaceLoader
  projectContextLoader: ReturnType<typeof import('./project-context-loader.js').createProjectContextLoader>
  resolveSkillsFor: (agentId: string) => Promise<{ name: string; oneLine: string }[]>
  /** The tools the run is offered (agent/tool-scope.ts), for the inventory section. */
  resolveToolsFor: (agentId: string, conversationId?: string | null) => Promise<{ name: string; oneLine: string }[]>
  resolveAgentsFor?: (agentId: string) => Promise<{ name: string; oneLine: string }[]>
  resolveTeamContext: (conversationId: string | null) => Promise<TeamContextSummary | null>
  resolveMemoryContext: (conversationId: string | null, agentId: string) => Promise<MemoryContextSummary | null>
  resolveCodeSearchContext?: (conversationId: string | null) => Promise<CodeSearchContextSummary | null>
  resolveWorkingDirectoriesContext?: (conversationId: string | null) => Promise<WorkingDirectoriesContext | null>
  resolveConversationTags?: (conversationId: string | null) => Promise<ConversationTagLine[] | null>
  resolveActiveVoice: (params: { agentId: string; channelContext: unknown; conversationId: string | null }) => Promise<{ scope: VoiceScope; reason: string; profile: VoiceProfile }>
  resolveRuntime: () => RuntimeContext
  /**
   * The model the prompt is for (delivery-profile.ts). Absent or throwing →
   * an unresolved profile: the 100k baseline budget and native tool names.
   */
  resolveDeliveryProfile?: (target: DeliveryTarget) => DeliveryProfile | Promise<DeliveryProfile>
  /** memory.index.budgetChars: the recall cap at the baseline window (token-budget.ts). */
  resolveMemoryRecallChars?: () => number | undefined
  /**
   * ctx.memoryRecall — the one recall service (memory/v2/assemble.ts). Absent
   * (no memory module) → the turn block carries the time only.
   */
  resolveRecall?: (input: MemoryRecallInput) => Promise<RecallResult | null>
  /** The one clock (shared/clock.ts formatNow in i18n.timezone). Absent → the server's zone. */
  resolveClock?: () => { date: string; time: string }
  resolveMasterSections: () => Promise<{ identity: string; coreRules: string; personality: string }>
}

export interface BuildOptions {
  agentId: string
  agentName: string
  conversationId: string | null
  projectId: string | null
  channelContext: unknown
  budgetOverride?: Partial<SectionBudget>
  /**
   * The provider/model that will answer. Sizes the budget and names EYAS tools
   * the way that provider lists them. Absent: the install default. Every entry
   * path passes the pair it will call: the chat route its D3 binding, every
   * other path (specialists, team members, background cards, channel
   * replies) the pair model/binding.ts resolveRunBinding gave it.
   */
  target?: DeliveryTarget
  /** The current message; recall composes its query from it (J6). Empty: the last stored user message. */
  turnText?: string | null
  /**
   * Who reads the answer. 'external' (an A2A peer, an external-voice channel
   * reply) gets no recalled owner memory; the turn block then carries the
   * time only and the delivery record says why.
   */
  audience?: 'owner' | 'external'
  /** The turn's id for the access log; generated when absent. */
  turnId?: string | null
}

/** What the turn block needs: no agent, no workspace — only the message and the model. */
export type TurnOptions = Pick<BuildOptions, 'conversationId' | 'target' | 'turnText' | 'audience' | 'turnId'>

/** The turn block on its own (buildTurnOnly). */
export interface TurnOnly {
  turn: string
  /** The 'turn' zone sections inside `turn`'s frame. */
  sections: ContextSection[]
  delivery: PromptDelivery
}

export { TURN_CONTEXT_TAG }
/** Context section key of the turn block's clock line. */
export const TURN_TIME_SECTION_KEY = 'turn-time'
/** First line inside the turn frame: the model must not take it for the sender's words. */
const TURN_INTRO = 'Added by EYAS to this message — not written by its sender.'

export function createPromptAssembler(deps: AssemblerDeps) {
  async function buildForPrimary(opts: BuildOptions): Promise<AssembledPrompt> {
    const ws = await deps.workspaceLoader.load(opts.agentId)
    const cascade = await deps.projectContextLoader.cascade({ projectId: opts.projectId })
    const profile = await resolveProfile(opts.target)
    const budget = budgetForWindow(budgetWindowOf(profile), {
      memoryRecallChars: safe(() => deps.resolveMemoryRecallChars?.()),
      override: opts.budgetOverride,
    })
    // Recall (retrieval + a query embedding) runs alongside the other
    // resolvers; buildTurn never rejects.
    const turnPending = buildTurn(opts, profile, budget)

    const [skills, tools, agents, team, memory, codeSearch, workingDirectories, conversationTags, voice, master] = await Promise.all([
      deps.resolveSkillsFor(opts.agentId),
      deps.resolveToolsFor(opts.agentId, opts.conversationId),
      deps.resolveAgentsFor?.(opts.agentId) ?? Promise.resolve([]),
      deps.resolveTeamContext(opts.conversationId),
      deps.resolveMemoryContext(opts.conversationId, opts.agentId),
      deps.resolveCodeSearchContext?.(opts.conversationId) ?? Promise.resolve(null),
      deps.resolveWorkingDirectoriesContext?.(opts.conversationId) ?? Promise.resolve(null),
      deps.resolveConversationTags?.(opts.conversationId) ?? Promise.resolve(null),
      deps.resolveActiveVoice({ agentId: opts.agentId, channelContext: opts.channelContext, conversationId: opts.conversationId }),
      deps.resolveMasterSections(),
    ])

    // A model that cannot call tools is sent none (agent-runner), so nothing
    // in its prompt asks it to call one: the shipped tool paragraphs of the
    // identity and core rules get their tool-less wording (master-variant.ts;
    // owner-edited paragraphs are kept as written), and it gets no tool,
    // skill or agent inventory — skills load through skill_load and the
    // roster is for run_specialist / handoff_to_colleague, all tool calls.
    const toolLess = !profile.supportsTools
    const masterText = renderMasterSections(master, masterVariantFor(profile))

    const prefixResult = buildCachePrefix({
      coreIdentity: masterText.identity,
      coreRules: masterText.coreRules,
      personality: masterText.personality,
      workspace: ws,
      cascade,
      skillsList: toolLess ? [] : skills,
      // A CLI reaches EYAS tools over its EYAS bridge (any addressing but
      // native), which never offers the tools the CLI's own granted
      // built-ins stand in for — so neither does its inventory. The grant
      // follows the offered tools, as the CLI providers read it from the
      // request (git_status is listed when run_command is not offered).
      toolsList: toolLess
        ? []
        : profile.toolAddressing.kind === 'native'
          ? tools
          : selectBridgeTools(tools, null, nativeCapabilitiesFor(requestToolScope({ tools }))),
      agentsList: toolLess ? [] : agents,
      budget,
      toolAddressing: profile.toolAddressing,
    })

    const suffixResult = buildCacheSuffix({
      team,
      memory,
      codeSearch,
      workingDirectories,
      conversationTags,
      runtime: deps.resolveRuntime(),
      activeVoice: voice,
      budget,
    })

    const prefix = prefixResult.content
    const suffix = suffixResult.content
    const prefixHash = createHash('sha256').update(prefix).digest('hex')
    const turn = await turnPending

    return {
      prefix,
      suffix,
      reminders: [],
      cacheBoundaryHint: prefix.length,
      prefixHash,
      tokenEstimate: {
        prefix: estimateTokens(prefix),
        suffix: estimateTokens(suffix),
        reminders: 0,
        turn: estimateTokens(turn.content),
      },
      sections: [...prefixResult.sections, ...suffixResult.sections, ...turn.sections],
      turn: turn.content,
      delivery: { profile, budgetTotalTokens: totalBudget(budget), recall: turn.recall },
    }
  }

  /**
   * The per-message turn block: the clock, then what EYAS recalled for this
   * message, in one <turn-context> frame. Both change every turn, so neither
   * sits in the system prompt. Never throws: a failing recall leaves the
   * time alone and the delivery record says so.
   */
  async function buildTurn(
    opts: TurnOptions,
    profile: DeliveryProfile,
    budget: SectionBudget,
  ): Promise<{ content: string; sections: ContextSection[]; recall: RecallDelivery }> {
    const clock = safe(() => deps.resolveClock?.()) ?? formatNow()
    const timeLine = `Current date and time: ${clock.date} ${clock.time}`
    const turnId = opts.turnId || generateId()
    const budgetChars = tokensToChars(budget.memoryRecall)

    let recall: RecallResult | null = null
    let withheld: RecallWithheld | undefined
    if (opts.audience === 'external') withheld = 'external'
    else if (budgetChars <= 0) withheld = 'no-budget'
    else if (!deps.resolveRecall || !opts.conversationId) withheld = 'unavailable'
    else {
      try {
        recall = await deps.resolveRecall({
          conversationId: opts.conversationId,
          turnText: opts.turnText ?? '',
          budgetChars,
          profile,
          turnId,
          audience: 'owner',
        })
      } catch {
        withheld = 'failed'
      }
    }

    const sections: ContextSection[] = [turnSection(TURN_TIME_SECTION_KEY, timeLine)]
    if (recall?.content) {
      sections.push(turnSection(MEMORY_RECALL_SECTION_KEY, recall.content, budget.memoryRecall, recall.ids.join(',')))
    }
    const content = renderFence(TURN_CONTEXT_TAG, undefined, [TURN_INTRO, ...sections.map((s) => s.content)].join('\n'))
    return {
      content,
      sections,
      recall: {
        ids: recall?.ids ?? [],
        retrieved: recall?.retrieved ?? [],
        expanded: recall?.expanded ?? [],
        chars: recall?.chars ?? 0,
        budgetChars,
        turnId,
        ...(withheld ? { withheld } : {}),
      },
    }
  }

  /**
   * The turn block alone, for a prompt that cannot be assembled — no agent
   * resolved (a conversation with no colleague in a project without a default
   * one), or an assembly that failed. The system prompt is then missing, but
   * the clock and what EYAS recalled for the message still reach the model.
   */
  async function buildTurnOnly(opts: TurnOptions): Promise<TurnOnly> {
    const profile = await resolveProfile(opts.target)
    const budget = budgetForWindow(budgetWindowOf(profile), {
      memoryRecallChars: safe(() => deps.resolveMemoryRecallChars?.()),
    })
    const turn = await buildTurn(opts, profile, budget)
    return {
      turn: turn.content,
      sections: turn.sections,
      delivery: { profile, budgetTotalTokens: totalBudget(budget), recall: turn.recall },
    }
  }

  async function resolveProfile(target: DeliveryTarget | undefined): Promise<DeliveryProfile> {
    if (!deps.resolveDeliveryProfile) return unresolvedDeliveryProfile(target)
    try {
      return await deps.resolveDeliveryProfile(target ?? {})
    } catch {
      return unresolvedDeliveryProfile(target)
    }
  }

  return { buildForPrimary, buildTurnOnly }
}

export type PromptAssembler = ReturnType<typeof createPromptAssembler>

function turnSection(key: string, content: string, budgetTokens?: number, sourceRef?: string): ContextSection {
  return {
    zone: 'turn',
    key,
    ...(sourceRef ? { sourceRef } : {}),
    content,
    chars: content.length,
    estimatedTokens: estimateTokens(content),
    ...(budgetTokens !== undefined ? { budgetTokens } : {}),
    truncated: false,
    droppedChars: 0,
  }
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}
