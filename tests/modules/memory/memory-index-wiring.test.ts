// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The standing memory index reaches the model through the one recall service
// (ctx.memoryRecall), inside the per-message turn block — on the BACKGROUND
// path as much as in interactive chat (delivery-entry-paths.test.ts covers
// every path). The legacy accessors (ctx.memoryIndex, ctx.relatedWork) and
// their system-prompt appends are gone: nothing here may put memory in the
// system prompt. Fictive notes throughout.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { runConversation } from '@modules/agent/conversation-runner'
import { createMemoryTables } from '@modules/memory/schema'
import { createMemoryV2Tables } from '@modules/memory/v2/schema'
import { createMemoryRecall, MEMORY_RECALL_SECTION_KEY, type MemoryRecall } from '@modules/memory/v2/assemble'
import { createPromptAssembler } from '@modules/prompt-wizard/assembler'
import type { DeliveryProfile } from '@modules/prompt-wizard/delivery-profile'
import { probeSqliteCapabilities } from '@core/db/sqlite-capabilities'
import { createTestDb, getRawFromDrizzle } from '../../helpers/test-db'
import { silentLogger } from './v2/helpers'

const testDb = createTestDb('memory-index-wiring')

const PROFILE: DeliveryProfile = {
  providerId: 'p1', modelId: 'm1', contextWindow: 100_000, supportsTools: true,
  toolAddressing: { kind: 'native' }, drillDown: true, resolved: true, windowSource: 'catalog',
}

function file(name: string, body: string) {
  return { name, path: '', exists: true, frontmatter: null, body, byteSize: 0, truncated: false }
}

describe('standing memory reaches a background run through ctx.memoryRecall', () => {
  let db: any
  let runs: any[]
  let recorded: any[]

  function seedNote(path: string, summary: string, tags = '[]') {
    db.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, kind, summary, file_hash, indexed_at)
      VALUES (${path}, 'N', 'semantic', ${tags}, 'body', 'user', ${summary}, 'h', '2026-08-27T00:00:00Z')`)
  }

  function assemblerWith(recall: MemoryRecall | undefined) {
    const ws = {
      agentId: 'agent-1', rootPath: '/tmp/agent-1',
      identity: file('IDENTITY.md', '## My mission\nhelp'), soulMd: file('SOUL.md', ''), soulStyleJson: file('SOUL.style.json', '{}'),
      agentsMd: file('AGENTS.md', ''), toolsMd: file('TOOLS.md', ''), memoryMd: file('MEMORY.md', ''), dailyMemory: [],
    }
    return createPromptAssembler({
      workspaceLoader: { load: async () => ws as never, invalidate: () => {}, invalidateAll: () => {} },
      projectContextLoader: { cascade: async () => ({ projectAgents: null, projectTypeAgents: null, projectId: null, projectTypeId: null }) },
      resolveSkillsFor: async () => [],
      resolveToolsFor: async () => [],
      resolveTeamContext: async () => null,
      resolveMemoryContext: async () => null,
      resolveActiveVoice: async () => ({ scope: 'internal', reason: 'owner DM', profile: { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'nincs', emoji: 'soha', blockedPhrases: [], signature: '' } }),
      resolveRuntime: () => ({ channel: 'unknown', os: 'linux' }),
      resolveMasterSections: async () => ({ identity: 'identity', coreRules: 'rules', personality: 'personality' }),
      resolveDeliveryProfile: () => PROFILE,
      ...(recall ? { resolveRecall: (input: Parameters<MemoryRecall>[0]) => recall(input) } : {}),
    })
  }

  async function run(recall: MemoryRecall | undefined): Promise<{ turn: string; system: string }> {
    await runConversation('conv-1', {
      db,
      agentRunner: {
        run: (opts: any) => {
          runs.push(opts)
          return (async function* () { yield { type: 'turn_complete', turn: 1, tokensUsed: 1 } })()
        },
      },
      agentRegistry: {
        get: () => ({ id: 'agent-1', name: 'A', enabled: true, systemPrompt: 'base prompt', tools: [], maxTurns: 2, model: 'm1' }),
        isWithinBudget: () => true,
        addTokenUsage: () => {},
      },
      toolRegistry: { toToolDefinitions: () => [] },
      logger: silentLogger,
      promptAssembler: assemblerWith(recall),
      contextRecorder: { record: (input: any) => { recorded.push(input); return 'comp-1' }, sectionsFor: () => null } as any,
    })
    const opts = runs.at(-1)
    return { turn: String(opts.systemPrompt?.turn ?? opts.turn ?? ''), system: String(opts.system ?? '') + String(opts.systemPrompt?.prefix ?? '') + String(opts.systemPrompt?.suffix ?? '') }
  }

  const recallFor = (includeSecrets: boolean) => createMemoryRecall({ db, logger: silentLogger, includeSecrets: () => includeSecrets })

  beforeEach(() => {
    db = testDb.open()
    createMemoryTables(db)
    createMemoryV2Tables(db, probeSqliteCapabilities(getRawFromDrizzle(db)))
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, goal_description, user_id, provider_id, model_id, created_at, updated_at)
      VALUES ('conv-1', 'C', 'waiting', 'autonomous', 'agent-1', 'do the thing', 'owner-1', 'p1', 'm1', ${now}, ${now})`)
    runs = []
    recorded = []
  })

  afterEach(() => testDb.cleanup())

  it('(+) a standing note is in the turn block, never in the system prompt', async () => {
    seedNote('semantic/owner.md', 'Answers in Hungarian')
    const { turn, system } = await run(recallFor(false))
    expect(turn).toContain('Answers in Hungarian')
    expect(turn).toContain('<eyas-memory')
    expect(system).not.toContain('Answers in Hungarian')
    expect(system).toContain('base prompt')
  })

  it('(+) recorded as its own turn section, not "skill"', async () => {
    // The context recorder derives skills.use_count from the 'skill' key.
    seedNote('semantic/owner.md', 'Answers in Hungarian')
    await run(recallFor(false))
    const section = recorded[0].sections.find((s: any) => s.key === MEMORY_RECALL_SECTION_KEY)
    expect(section).toMatchObject({ zone: 'turn', key: 'memory-recall' })
    expect(MEMORY_RECALL_SECTION_KEY).not.toBe('skill')
  })

  // D-7 / P-19 — recall is the widest model-facing consumer there is.
  it('(−) keeps a contains-secrets note out by default', async () => {
    seedNote('semantic/alpha-key.md', 'Alpha deploy key is alphabravocharlie0001', '["contains-secrets"]')
    seedNote('semantic/owner.md', 'Answers in Hungarian')
    const { turn } = await run(recallFor(false))
    expect(turn).toContain('Answers in Hungarian')
    expect(turn).not.toContain('alphabravocharlie0001')
  })

  it('(+) shows it once the owner opened memory.recall.includeSecrets', async () => {
    seedNote('semantic/alpha-key.md', 'Alpha deploy key is alphabravocharlie0001', '["contains-secrets"]')
    const { turn } = await run(recallFor(true))
    expect(turn).toContain('alphabravocharlie0001')
  })

  it('(−) no recall service (no memory module): the turn carries the clock only', async () => {
    seedNote('semantic/owner.md', 'Answers in Hungarian')
    const { turn } = await run(undefined)
    expect(turn).toContain('Current date and time')
    expect(turn).not.toContain('Answers in Hungarian')
  })

  it('(−) still runs when recall throws: the turn carries the clock only', async () => {
    seedNote('semantic/owner.md', 'Answers in Hungarian')
    const { turn } = await run(async () => { throw new Error('vault_index is gone') })
    expect(runs).toHaveLength(1)
    expect(turn).toContain('Current date and time')
    expect(turn).not.toContain('<eyas-memory')
  })
})
