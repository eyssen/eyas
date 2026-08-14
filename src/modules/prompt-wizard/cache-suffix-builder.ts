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

export interface CodeSearchContextSummary {
  reason: string
  pinned: boolean
  needsPin: boolean
  sources: Array<{
    id: string
    name: string
    label?: string
    version?: string
    edition?: string
    status: string
  }>
}

export interface WorkingDirectoriesContext {
  primary: string | null
  extra: string[]
}

export interface CacheSuffixInput {
  team: TeamContextSummary | null
  memory: MemoryContextSummary | null
  codeSearch?: CodeSearchContextSummary | null
  workingDirectories?: WorkingDirectoriesContext | null
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

  if (input.codeSearch) {
    const lines: string[] = []
    lines.push(`Resolution: ${input.codeSearch.reason}`)
    lines.push(`Pinned: ${input.codeSearch.pinned ? 'yes' : 'no'}`)
    if (input.codeSearch.needsPin) {
      lines.push(
        'WARNING: multiple Odoo/versioned sources are ready — call set_search_context before search_indexed / odoo_search_*.',
      )
    }
    if (input.codeSearch.sources.length) {
      lines.push('Active sources (MUST use for search_indexed / odoo_search_*):')
      for (const s of input.codeSearch.sources) {
        const bits = [
          s.label ? `label=${s.label}` : null,
          s.version ? `v=${s.version}` : null,
          s.edition ? s.edition : null,
          s.status,
        ].filter(Boolean)
        lines.push(`- ${s.name} [${s.id}] ${bits.join(', ')}`)
      }
    } else if (!input.codeSearch.needsPin) {
      lines.push('No ready code sources pinned or indexed.')
    }
    lines.push('To switch Odoo version: set_search_context({ labels: ["18c"] }) or ask the owner.')
    // Reuse memoryContext budget bucket when no dedicated slot exists
    const budget = (input.budget as any).codeSearchContext ?? input.budget.memoryContext
    parts.push(tag('code-search-context', clipToBudget(lines.join('\n'), budget).content))
  }

  if (input.workingDirectories) {
    const wd = input.workingDirectories
    const lines: string[] = []
    if (wd.primary) {
      lines.push(`Primary working directory (cwd for relative paths, git, tests): ${wd.primary}`)
      if (wd.extra.length) {
        lines.push('Additional allowed roots (read/write):')
        for (const p of wd.extra) lines.push(`- ${p}`)
      }
      lines.push('Write and edit ONLY under these directories. Indexed search sources are read-only.')
    } else {
      lines.push('No working directory is configured. Do not write files until the owner sets Folders on the conversation or project.')
    }
    const budget = (input.budget as any).workingDirectoriesContext ?? input.budget.memoryContext
    parts.push(tag('working-directories', clipToBudget(lines.join('\n'), budget).content))
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
