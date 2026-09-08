// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import { buildCacheSuffix, formatConversationTagsLine } from '../../../src/modules/prompt-wizard/cache-suffix-builder.js'
import { DEFAULT_BUDGET_FULL } from '../../../src/modules/prompt-wizard/token-budget.js'
import type { VoiceProfile } from '../../../src/modules/prompt-wizard/types.js'
import type { RuntimeContext, TeamContextSummary, MemoryContextSummary } from '../../../src/modules/prompt-wizard/cache-suffix-builder.js'

function profile(overrides: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    address: 'tegező',
    tone: 'kiegyensúlyozott',
    verbosity: 'lényegre törő',
    directness: 'direkt + udvarias',
    humor: 'száraz/szellemes',
    emoji: 'funkcionálisan',
    blockedPhrases: [],
    signature: '',
    ...overrides,
  }
}

function runtime(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    date: '2026-04-26',
    time: '10:30 CEST',
    channel: 'owner_dm',
    os: 'darwin',
    ...overrides,
  }
}

describe('buildCacheSuffix', () => {
  it('suffix without team/memory still includes runtime + active-voice', () => {
    const { content: result } = buildCacheSuffix({
      team: null,
      memory: null,
      runtime: runtime(),
      activeVoice: { scope: 'internal', reason: 'default', profile: profile() },
      budget: DEFAULT_BUDGET_FULL,
    })

    expect(result).toContain('<runtime>')
    expect(result).toContain('<active-voice>')
    expect(result).not.toContain('<team-context>')
    expect(result).not.toContain('<memory-context>')
  })

  it('team context renders all members', () => {
    const team: TeamContextSummary = {
      teamSessionId: 'session-abc',
      members: [
        { name: 'Alice', tier: 'orchestrator', status: 'active' },
        { name: 'Bob', tier: 'worker', status: 'idle' },
        { name: 'Carol', tier: 'worker', status: 'active' },
      ],
      sharedMemoryEntryCount: 5,
    }

    const { content: result } = buildCacheSuffix({
      team,
      memory: null,
      runtime: runtime(),
      activeVoice: { scope: 'internal', reason: 'team mode', profile: profile() },
      budget: DEFAULT_BUDGET_FULL,
    })

    expect(result).toContain('<team-context>')
    expect(result).toContain('- Alice (orchestrator, active)')
    expect(result).toContain('- Bob (worker, idle)')
    expect(result).toContain('- Carol (worker, active)')
  })

  it('memory context renders working memory + ancestry', () => {
    const memory: MemoryContextSummary = {
      workingMemory: [
        { content: 'First working memory entry' },
        { content: 'Second working memory entry' },
      ],
      goalAncestry: 'root → sub-task A → current',
    }

    const { content: result } = buildCacheSuffix({
      team: null,
      memory,
      runtime: runtime(),
      activeVoice: { scope: 'internal', reason: 'recall', profile: profile() },
      budget: DEFAULT_BUDGET_FULL,
    })

    expect(result).toContain('<memory-context>')
    expect(result).toContain('1. First working memory entry')
    expect(result).toContain('2. Second working memory entry')
    expect(result).toContain('Goal ancestry: root → sub-task A → current')
  })

  it('<active-voice> always present and includes all profile fields', () => {
    const { content: result } = buildCacheSuffix({
      team: null,
      memory: null,
      runtime: runtime(),
      activeVoice: {
        scope: 'external',
        reason: 'client-facing channel',
        profile: profile({ address: 'magázó', tone: 'komoly' }),
      },
      budget: DEFAULT_BUDGET_FULL,
    })

    expect(result).toContain('<active-voice>')
    expect(result).toContain('Voice scope: EXTERNAL')
    expect(result).toContain('Reason: client-facing channel')
    expect(result).toContain('- Address: magázó')
    expect(result).toContain('- Tone: komoly')
    expect(result).toContain('- Verbosity: lényegre törő')
    expect(result).toContain('- Directness: direkt + udvarias')
    expect(result).toContain('- Humor: száraz/szellemes')
    expect(result).toContain('- Emoji: funkcionálisan')
  })

  it('blocked phrases line only present when non-empty', () => {
    const { content: withoutBlocked } = buildCacheSuffix({
      team: null,
      memory: null,
      runtime: runtime(),
      activeVoice: { scope: 'internal', reason: 'test', profile: profile({ blockedPhrases: [] }) },
      budget: DEFAULT_BUDGET_FULL,
    })

    expect(withoutBlocked).not.toContain('Blocked phrases')

    const { content: withBlocked } = buildCacheSuffix({
      team: null,
      memory: null,
      runtime: runtime(),
      activeVoice: {
        scope: 'internal',
        reason: 'test',
        profile: profile({ blockedPhrases: ['sajnos', 'természetesen'] }),
      },
      budget: DEFAULT_BUDGET_FULL,
    })

    expect(withBlocked).toContain('Blocked phrases')
    expect(withBlocked).toContain('["sajnos","természetesen"]')
  })
})

describe('buildCacheSuffix manifest', () => {
  const voice = {
    scope: 'internal' as const,
    reason: 'default',
    profile: profile(),
  }

  const baseInput = {
    team: null, memory: null, codeSearch: null, workingDirectories: null,
    runtime: runtime(),
    activeVoice: voice,
    budget: DEFAULT_BUDGET_FULL,
  }

  it('sections concatenate back to the prompt byte-for-byte', () => {
    const { content, sections } = buildCacheSuffix(baseInput)
    expect(sections.map((s) => s.content).join('').trimEnd() + '\n').toBe(content)
  })

  it('always emits runtime and active-voice', () => {
    const { sections } = buildCacheSuffix(baseInput)
    expect(sections.map((s) => s.key)).toEqual(['runtime', 'active-voice'])
    expect(sections.every((s) => s.zone === 'suffix')).toBe(true)
  })

  it('includes optional sections when present, in order', () => {
    const { content, sections } = buildCacheSuffix({
      ...baseInput,
      memory: { workingMemory: [{ content: 'remember this' }], goalAncestry: 'root > child' },
      workingDirectories: { primary: '/repo', extra: ['/other'] },
    })
    expect(sections.map((s) => s.key)).toEqual(['memory-context', 'working-directories', 'runtime', 'active-voice'])
    expect(sections.map((s) => s.content).join('').trimEnd() + '\n').toBe(content)
  })

  it('records no blank sections — join-neutrality is enforced, not assumed', () => {
    const { sections } = buildCacheSuffix(baseInput)
    expect(sections.every((s) => s.content.trim().length > 0)).toBe(true)
  })
})

describe('formatConversationTagsLine', () => {
  it('returns null for an empty list', () => {
    expect(formatConversationTagsLine([])).toBeNull()
  })

  it('renders one sorted category:name line from fictive tags', () => {
    expect(formatConversationTagsLine([
      { categoryName: 'module', name: 'bravo' },
      { categoryName: 'area', name: 'alpha' },
    ])).toBe('tags: area:alpha, module:bravo')
  })

  it('omits the category prefix when a tag has none', () => {
    expect(formatConversationTagsLine([{ categoryName: null, name: 'alpha' }])).toBe('tags: alpha')
  })
})

describe('buildCacheSuffix conversation tags', () => {
  const voice = {
    scope: 'internal' as const,
    reason: 'default',
    profile: profile(),
  }

  it('puts a single tags line in a suffix section, not as a prefix block', () => {
    const { content, sections } = buildCacheSuffix({
      team: null, memory: null, codeSearch: null, workingDirectories: null,
      conversationTags: [
        { categoryName: 'area', name: 'alpha' },
        { categoryName: 'module', name: 'bravo' },
      ],
      runtime: runtime(),
      activeVoice: voice,
      budget: DEFAULT_BUDGET_FULL,
    })
    const section = sections.find((s) => s.key === 'conversation-tags')
    expect(section?.zone).toBe('suffix')
    expect(section?.content).toContain('tags: area:alpha, module:bravo')
    expect(content).toContain('tags: area:alpha, module:bravo')
    expect(content.split('tags:').length - 1).toBe(1)
  })

  it('omits the section when there are no conversation tags', () => {
    const { content, sections } = buildCacheSuffix({
      team: null, memory: null, codeSearch: null, workingDirectories: null,
      conversationTags: null,
      runtime: runtime(),
      activeVoice: voice,
      budget: DEFAULT_BUDGET_FULL,
    })
    expect(sections.map((s) => s.key)).not.toContain('conversation-tags')
    expect(content).not.toContain('tags:')
  })
})
