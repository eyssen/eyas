// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { createHash } from 'node:crypto'
import type { WorkspaceLoader } from './workspace-loader.js'
import type { AssembledPrompt, VoiceProfile, VoiceScope } from './types.js'
import type { SectionBudget } from './token-budget.js'
import { buildCachePrefix } from './cache-prefix-builder.js'
import {
  buildCacheSuffix,
  type RuntimeContext,
  type TeamContextSummary,
  type MemoryContextSummary,
  type CodeSearchContextSummary,
  type WorkingDirectoriesContext,
} from './cache-suffix-builder.js'
import { shrinkForContextWindow, estimateTokens } from './token-budget.js'

export interface AssemblerDeps {
  workspaceLoader: WorkspaceLoader
  projectContextLoader: ReturnType<typeof import('./project-context-loader.js').createProjectContextLoader>
  resolveSkillsFor: (agentId: string) => Promise<{ name: string; oneLine: string }[]>
  resolveToolsFor: (agentId: string) => Promise<{ name: string; oneLine: string }[]>
  resolveTeamContext: (conversationId: string | null) => Promise<TeamContextSummary | null>
  resolveMemoryContext: (conversationId: string | null, agentId: string) => Promise<MemoryContextSummary | null>
  resolveCodeSearchContext?: (conversationId: string | null) => Promise<CodeSearchContextSummary | null>
  resolveWorkingDirectoriesContext?: (conversationId: string | null) => Promise<WorkingDirectoriesContext | null>
  resolveActiveVoice: (params: { agentId: string; channelContext: unknown; conversationId: string | null }) => Promise<{ scope: VoiceScope; reason: string; profile: VoiceProfile }>
  resolveRuntime: () => RuntimeContext
  resolveContextWindow: (agentId: string) => Promise<number>
  resolveMasterSections: () => Promise<{ identity: string; coreRules: string; personality: string }>
}

export interface BuildOptions {
  agentId: string
  agentName: string
  conversationId: string | null
  projectId: string | null
  channelContext: unknown
  budgetOverride?: Partial<SectionBudget>
}

export function createPromptAssembler(deps: AssemblerDeps) {
  async function buildForPrimary(opts: BuildOptions): Promise<AssembledPrompt> {
    const ws = await deps.workspaceLoader.load(opts.agentId)
    const cascade = await deps.projectContextLoader.cascade({ projectId: opts.projectId })
    const ctx = await deps.resolveContextWindow(opts.agentId)
    const budget = shrinkForContextWindow(ctx, opts.budgetOverride)

    const [skills, tools, team, memory, codeSearch, workingDirectories, voice, master] = await Promise.all([
      deps.resolveSkillsFor(opts.agentId),
      deps.resolveToolsFor(opts.agentId),
      deps.resolveTeamContext(opts.conversationId),
      deps.resolveMemoryContext(opts.conversationId, opts.agentId),
      deps.resolveCodeSearchContext?.(opts.conversationId) ?? Promise.resolve(null),
      deps.resolveWorkingDirectoriesContext?.(opts.conversationId) ?? Promise.resolve(null),
      deps.resolveActiveVoice({ agentId: opts.agentId, channelContext: opts.channelContext, conversationId: opts.conversationId }),
      deps.resolveMasterSections(),
    ])

    const prefixResult = buildCachePrefix({
      coreIdentity: master.identity,
      coreRules: master.coreRules,
      personality: master.personality,
      workspace: ws,
      cascade,
      skillsList: skills,
      toolsList: tools,
      budget,
    })

    const suffixResult = buildCacheSuffix({
      team,
      memory,
      codeSearch,
      workingDirectories,
      runtime: deps.resolveRuntime(),
      activeVoice: voice,
      budget,
    })

    const prefix = prefixResult.content
    const suffix = suffixResult.content
    const prefixHash = createHash('sha256').update(prefix).digest('hex')

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
      },
      sections: [...prefixResult.sections, ...suffixResult.sections],
    }
  }

  return { buildForPrimary }
}

export type PromptAssembler = ReturnType<typeof createPromptAssembler>
