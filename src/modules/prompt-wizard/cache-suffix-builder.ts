// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type { VoiceProfile, VoiceScope } from './types.js'
import type { SectionBudget } from './token-budget.js'
import { clipToBudget } from './token-budget.js'

export interface RuntimeContext {
  date: string         // ISO date
  time: string         // HH:MM with timezone
  channel: string      // e.g. 'owner_dm', 'telegram_group'
  os: string
  gitStatus?: string
  tokensUsedMonth?: number
  monthlyTokenBudget?: number
  version?: string
  ownerName?: string
}

export interface TeamContextSummary {
  teamSessionId: string
  members: { name: string; tier: string; status: string }[]
  sharedMemoryEntryCount: number
}

export interface MemoryContextSummary {
  workingMemory: { content: string }[]
  goalAncestry: string | null
}

export interface CacheSuffixInput {
  team: TeamContextSummary | null
  memory: MemoryContextSummary | null
  runtime: RuntimeContext
  activeVoice: { scope: VoiceScope; reason: string; profile: VoiceProfile }
  budget: SectionBudget
}

function tag(name: string, content: string): string {
  if (!content.trim()) return ''
  return `<${name}>\n${content.trim()}\n</${name}>\n\n`
}

function renderActiveVoice(scope: VoiceScope, reason: string, p: VoiceProfile): string {
  const lines: string[] = []
  lines.push(`Voice scope: ${scope.toUpperCase()}`)
  lines.push(`Reason: ${reason}`)
  lines.push(`Effective profile (from your SOUL.md):`)
  lines.push(`- Address: ${p.address}`)
  lines.push(`- Tone: ${p.tone}`)
  lines.push(`- Verbosity: ${p.verbosity}`)
  lines.push(`- Directness: ${p.directness}`)
  lines.push(`- Humor: ${p.humor}`)
  lines.push(`- Emoji: ${p.emoji}`)
  if (p.blockedPhrases.length > 0) {
    lines.push(`- Blocked phrases: ${JSON.stringify(p.blockedPhrases)}`)
  }
  return lines.join('\n')
}

export function buildCacheSuffix(input: CacheSuffixInput): string {
  const parts: string[] = []

  if (input.team) {
    const lines = [`You are operating in team session "${input.team.teamSessionId}".`]
    lines.push('Active members:')
    for (const m of input.team.members) lines.push(`- ${m.name} (${m.tier}, ${m.status})`)
    lines.push(`Shared memory keys: ${input.team.sharedMemoryEntryCount} entries (use read_team_memory to load)`)
    parts.push(tag('team-context', clipToBudget(lines.join('\n'), input.budget.teamContext).content))
  }

  if (input.memory && (input.memory.workingMemory.length > 0 || input.memory.goalAncestry)) {
    const lines: string[] = []
    if (input.memory.workingMemory.length > 0) {
      lines.push('Working memory:')
      input.memory.workingMemory.forEach((w, i) => lines.push(`${i + 1}. ${w.content}`))
    }
    if (input.memory.goalAncestry) lines.push(`Goal ancestry: ${input.memory.goalAncestry}`)
    parts.push(tag('memory-context', clipToBudget(lines.join('\n'), input.budget.memoryContext).content))
  }

  const runtimeLines = [
    `- Current date: ${input.runtime.date}`,
    `- Current time: ${input.runtime.time}`,
    `- Channel: ${input.runtime.channel}`,
    `- OS: ${input.runtime.os}`,
  ]
  if (input.runtime.gitStatus) runtimeLines.push(`- Git status: ${input.runtime.gitStatus}`)
  if (input.runtime.tokensUsedMonth !== undefined && input.runtime.monthlyTokenBudget) {
    runtimeLines.push(`- Tokens used this month: ${input.runtime.tokensUsedMonth} / ${input.runtime.monthlyTokenBudget}`)
  }
  if (input.runtime.version) runtimeLines.unshift(`- EYAS version: ${input.runtime.version}`)
  if (input.runtime.ownerName) runtimeLines.unshift(`- Owner: ${input.runtime.ownerName}`)
  parts.push(tag('runtime', clipToBudget(runtimeLines.join('\n'), input.budget.runtime).content))

  parts.push(tag('active-voice', clipToBudget(renderActiveVoice(input.activeVoice.scope, input.activeVoice.reason, input.activeVoice.profile), input.budget.activeVoice).content))

  return parts.join('').trimEnd() + '\n'
}
