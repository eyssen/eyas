// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Task 51d — Cascade merge test.
// Verifies that project-type AGENTS.md, project AGENTS.md, and agent's own
// AGENTS.md all appear in the correct order in the assembled prefix.

import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setupTestEyas } from '../helpers/test-eyas.js'
import { createProjectContextLoader } from '@modules/prompt-wizard/project-context-loader.js'
import { createPromptAssembler } from '@modules/prompt-wizard/assembler.js'
import { CORE_IDENTITY } from '@modules/prompt-wizard/core-identity.js'
import { CORE_RULES } from '@modules/prompt-wizard/core-rules.js'
import { DEFAULT_PERSONALITY } from '@modules/prompt-wizard/master-prompt.js'

describe('cascade merge — project-type + project + agent AGENTS.md', () => {
  let harness: ReturnType<typeof setupTestEyas>

  afterEach(async () => {
    await harness?.shutdown()
  })

  it('all three AGENTS.md sources appear in prefix in correct order', async () => {
    harness = setupTestEyas()

    const agentId = await harness.api.createAgent({ template: 'primary-assistant', name: 'Jarvis' })

    // Set up project-type and project AGENTS.md files under the tmpdir
    const projectTypeId = 'test-project-type'
    const projectId = 'test-project'

    const ptDir = join(harness.dataDir, 'project-types', projectTypeId)
    const projDir = join(harness.dataDir, 'projects', projectId)
    mkdirSync(ptDir, { recursive: true })
    mkdirSync(projDir, { recursive: true })

    writeFileSync(join(ptDir, 'AGENTS.md'), '## project-type-level rule\nAlways follow the project type convention.')
    writeFileSync(join(projDir, 'AGENTS.md'), '## project-level rule\nKeep the project context in mind.')

    // Write a custom AGENTS.md for the agent
    await harness.workspaceWriter.write({
      agentId,
      file: 'AGENTS.md',
      body: '## agent-level notes\nThese are agent-specific notes.',
    })
    harness.workspaceLoader.invalidate(agentId)

    // Create a project context loader that knows about the project's type
    const projectContextLoader = createProjectContextLoader({
      dataDir: harness.dataDir,
      resolveProjectType: async (pId: string) => {
        if (pId === projectId) return { id: projectTypeId }
        return null
      },
    })

    // Build assembler with the project-aware context loader
    const assembler = createPromptAssembler({
      workspaceLoader: harness.workspaceLoader,
      projectContextLoader,
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
      resolveRuntime: () => ({ date: '2026-04-27', time: '10:00 CET', channel: 'owner_dm', os: 'macOS' }),
      resolveContextWindow: async () => 200_000,
      resolveMasterSections: async () => ({ identity: CORE_IDENTITY, coreRules: CORE_RULES, personality: DEFAULT_PERSONALITY }),
    })

    const prompt = await assembler.buildForPrimary({
      agentId,
      agentName: 'Jarvis',
      conversationId: null,
      projectId,
      channelContext: null,
    })

    // All three sources must appear in the prefix
    expect(prompt.prefix).toContain('project-type-level rule')
    expect(prompt.prefix).toContain('project-level rule')
    expect(prompt.prefix).toContain('agent-level notes')

    // Order: project-context (type then project) comes before agent-identity
    const ptPos = prompt.prefix.indexOf('project-type-level rule')
    const projPos = prompt.prefix.indexOf('project-level rule')
    const agentPos = prompt.prefix.indexOf('agent-level notes')

    expect(ptPos).toBeLessThan(projPos)     // project-type before project
    expect(projPos).toBeLessThan(agentPos)  // project before agent
  })
})
