// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { setupTestEyas } from '../../helpers/test-eyas.js'
import { createProjectContextLoader } from '@modules/prompt-wizard/project-context-loader.js'
import { createPromptAssembler } from '@modules/prompt-wizard/assembler.js'
import { CORE_IDENTITY } from '@modules/prompt-wizard/core-identity.js'
import { CORE_RULES } from '@modules/prompt-wizard/core-rules.js'
import { DEFAULT_PERSONALITY } from '@modules/prompt-wizard/master-prompt.js'
import { createMemoryDb } from '../../helpers/test-db.js'
import { createContextTables } from '@modules/observability/context-schema.js'
import { createContextRecorder } from '@modules/observability/context-recorder.js'
import { GENERAL_BRIEF } from '@modules/board'
import { effectiveProjectId } from '@modules/memory/types.js'

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} } as any

describe('project-context reaches a recorded composition', () => {
  let harness: ReturnType<typeof setupTestEyas>

  afterEach(async () => {
    await harness?.shutdown()
  })

  it('puts the form sentence in the project-context section of the composition', async () => {
    harness = setupTestEyas()
    const agentId = await harness.api.createAgent({ template: 'primary-assistant', name: 'Jarvis' })

    const typeId = 'type-a'
    const projectId = 'alpha'
    const sentence = 'Unlike bravo, code is local; the pod is diagnosis only.'

    const loader = createProjectContextLoader({
      dataDir: harness.dataDir,
      resolveProjectType: async (id) => (id === projectId ? { id: typeId } : null),
      resolveTypePrompt: async () => 'Type brief. Never copy the closed edition.',
      resolveProjectPrompt: async () => `+ ${sentence}`,
    })

    const assembler = createPromptAssembler({
      workspaceLoader: harness.workspaceLoader,
      projectContextLoader: loader,
      resolveSkillsFor: async () => [],
      resolveToolsFor: async () => [],
      resolveTeamContext: async () => null,
      resolveMemoryContext: async () => null,
      resolveActiveVoice: async () => ({
        scope: 'internal' as const,
        reason: 'owner DM (test)',
        profile: {
          address: 'tegező',
          tone: 'baráti',
          verbosity: 'kiegyensúlyozott',
          directness: 'direkt + udvarias',
          humor: 'száraz/szellemes',
          emoji: 'funkcionálisan',
          blockedPhrases: [],
          signature: '',
        },
      }),
      resolveRuntime: () => ({ date: '2026-08-30', time: '10:00 CET', channel: 'owner_dm', os: 'macOS' }),
      resolveContextWindow: async () => 200_000,
      resolveMasterSections: async () => ({ identity: CORE_IDENTITY, coreRules: CORE_RULES, personality: DEFAULT_PERSONALITY }),
    })

    const prompt = await assembler.buildForPrimary({
      agentId,
      agentName: 'Jarvis',
      conversationId: 'conv-alpha-1',
      projectId,
      channelContext: null,
    })

    const section = prompt.sections.find((s) => s.key === 'project-context')
    expect(section).toBeTruthy()
    expect(section!.content).toContain(sentence)
    expect(section!.content).toContain('Type brief. Never copy the closed edition.')
    expect(prompt.prefix).toContain(sentence)

    const db = createMemoryDb()
    createContextTables(db)
    const recorder = createContextRecorder(db, silentLogger)
    const compositionId = recorder.record({
      sections: prompt.sections,
      entryPoint: 'conversation',
      conversationId: 'conv-alpha-1',
      agentId,
    })
    expect(compositionId).toBeTruthy()
    const rows = db.all(sql`SELECT section_key, content FROM context_sections WHERE composition_id = ${compositionId} AND section_key = 'project-context'`) as any[]
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toContain(sentence)
  })

  it('sends GENERAL_BRIEF for general-general without granting project memory', async () => {
    harness = setupTestEyas()
    const agentId = await harness.api.createAgent({ template: 'primary-assistant', name: 'Jarvis' })

    const loader = createProjectContextLoader({
      dataDir: harness.dataDir,
      resolveProjectType: async () => ({ id: 'general' }),
      resolveTypePrompt: async () => 'General-purpose workspace.',
      resolveProjectPrompt: async () => GENERAL_BRIEF,
    })

    const assembler = createPromptAssembler({
      workspaceLoader: harness.workspaceLoader,
      projectContextLoader: loader,
      resolveSkillsFor: async () => [],
      resolveToolsFor: async () => [],
      resolveTeamContext: async () => null,
      resolveMemoryContext: async () => null,
      resolveActiveVoice: async () => ({
        scope: 'internal' as const,
        reason: 'owner DM (test)',
        profile: {
          address: 'tegező',
          tone: 'baráti',
          verbosity: 'kiegyensúlyozott',
          directness: 'direkt + udvarias',
          humor: 'száraz/szellemes',
          emoji: 'funkcionálisan',
          blockedPhrases: [],
          signature: '',
        },
      }),
      resolveRuntime: () => ({ date: '2026-08-30', time: '10:00 CET', channel: 'owner_dm', os: 'macOS' }),
      resolveContextWindow: async () => 200_000,
      resolveMasterSections: async () => ({ identity: CORE_IDENTITY, coreRules: CORE_RULES, personality: DEFAULT_PERSONALITY }),
    })

    const prompt = await assembler.buildForPrimary({
      agentId,
      agentName: 'Jarvis',
      conversationId: 'conv-general',
      projectId: 'general-general',
      channelContext: null,
    })

    expect(prompt.prefix).toContain("default home for everyday conversations")
    // Override (no +): type brief is not in the prefix — GENERAL_BRIEF is the workspace brief.
    expect(prompt.prefix).not.toContain('General-purpose workspace.')
    expect(effectiveProjectId('general-general')).toBeNull()
  })
})
