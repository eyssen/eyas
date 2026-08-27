// Part of eYssen. See LICENSE file for full copyright and licensing details.

const APPROX_CHARS_PER_TOKEN = 4

export interface SectionBudget {
  coreIdentity: number
  coreRules: number
  personality: number
  projectCascade: number
  identityMd: number
  soulMd: number
  agentsMd: number
  toolsMd: number
  skillsList: number
  toolsList: number
  teamContext: number
  memoryContext: number
  runtime: number
  activeVoice: number
}

export const DEFAULT_BUDGET_FULL: SectionBudget = {
  coreIdentity: 200,
  coreRules: 500,
  personality: 200,
  projectCascade: 3000,
  identityMd: 600,
  soulMd: 500,
  agentsMd: 800,
  toolsMd: 400,
  skillsList: 400,
  toolsList: 500,
  teamContext: 400,
  memoryContext: 600,
  runtime: 200,
  activeVoice: 100,
}

export function totalBudget(b: SectionBudget): number {
  return Object.values(b).reduce((sum, v) => sum + v, 0)
}

export function shrinkForContextWindow(effectiveCtx: number, override?: Partial<SectionBudget>): SectionBudget {
  // Reserve 40% of context for system prompt; suffix is folded inside
  const target = Math.min(8800, Math.floor(effectiveCtx * 0.4))
  const baseTotal = totalBudget(DEFAULT_BUDGET_FULL)
  if (baseTotal <= target) return { ...DEFAULT_BUDGET_FULL, ...override }
  const ratio = target / baseTotal
  const scaled: SectionBudget = {
    coreIdentity: DEFAULT_BUDGET_FULL.coreIdentity,  // never shrink locked sections
    coreRules: DEFAULT_BUDGET_FULL.coreRules,
    personality: DEFAULT_BUDGET_FULL.personality,
    activeVoice: DEFAULT_BUDGET_FULL.activeVoice,
    runtime: DEFAULT_BUDGET_FULL.runtime,
    projectCascade: Math.max(0, Math.floor(DEFAULT_BUDGET_FULL.projectCascade * ratio)),
    identityMd: Math.max(200, Math.floor(DEFAULT_BUDGET_FULL.identityMd * ratio)),
    soulMd: Math.max(200, Math.floor(DEFAULT_BUDGET_FULL.soulMd * ratio)),
    agentsMd: Math.max(0, Math.floor(DEFAULT_BUDGET_FULL.agentsMd * ratio)),
    toolsMd: Math.max(0, Math.floor(DEFAULT_BUDGET_FULL.toolsMd * ratio)),
    skillsList: Math.max(100, Math.floor(DEFAULT_BUDGET_FULL.skillsList * ratio)),
    toolsList: Math.max(150, Math.floor(DEFAULT_BUDGET_FULL.toolsList * ratio)),
    teamContext: Math.max(0, Math.floor(DEFAULT_BUDGET_FULL.teamContext * ratio)),
    memoryContext: Math.max(0, Math.floor(DEFAULT_BUDGET_FULL.memoryContext * ratio)),
  }
  return { ...scaled, ...override }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN)
}

export function clipToBudget(
  text: string,
  tokenBudget: number,
): { content: string; truncated: boolean; droppedChars: number } {
  const charBudget = tokenBudget * APPROX_CHARS_PER_TOKEN
  if (text.length <= charBudget) return { content: text, truncated: false, droppedChars: 0 }
  return {
    content: text.slice(0, charBudget) + '\n\n[truncated — section budget]',
    truncated: true,
    droppedChars: text.length - charBudget,
  }
}
