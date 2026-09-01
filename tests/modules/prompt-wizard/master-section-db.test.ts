// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createWizardService } from '../../../src/modules/prompt-wizard/wizard-service.js'
import { createPromptAssembler } from '../../../src/modules/prompt-wizard/assembler.js'

function makeTable(db: any) {
  db.run(sql`CREATE TABLE IF NOT EXISTS prompt_templates (
    id TEXT PRIMARY KEY, level TEXT NOT NULL, target_id TEXT, name TEXT NOT NULL,
    content TEXT NOT NULL, section TEXT, locked INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
}

describe('wizardService.getMasterSection', () => {
  it('reads a master section by its (hyphenated) section name', () => {
    const db = createMemoryDb()
    makeTable(db)
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO prompt_templates (id, level, target_id, name, content, section, locked, is_active, created_by, created_at, updated_at)
      VALUES ('master-core-rules', 'master', NULL, 'Core Rules', 'EDITED RULES', 'core-rules', 1, 1, 'system', ${now}, ${now})`)
    const svc = createWizardService(db)
    expect(svc.getMasterSection('core-rules')).toBe('EDITED RULES')
    expect(svc.getMasterSection('identity')).toBeNull()
  })
})

const fakeWs = {
  agentId: 'a', rootPath: '/tmp/a',
  identity: { name: 'IDENTITY.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
  soulMd: { name: 'SOUL.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
  soulStyleJson: { name: 'SOUL.style.json', path: '', exists: true, frontmatter: null, body: '{}', byteSize: 0, truncated: false },
  agentsMd: { name: 'AGENTS.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
  toolsMd: { name: 'TOOLS.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
  memoryMd: { name: 'MEMORY.md', path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false },
  dailyMemory: [],
}

it('assembler prefix reflects an edited master identity row', async () => {
  const db = createMemoryDb(); makeTable(db)
  const now = new Date().toISOString()
  db.run(sql`INSERT INTO prompt_templates (id, level, target_id, name, content, section, locked, is_active, created_by, created_at, updated_at)
    VALUES ('master-identity', 'master', NULL, 'System Identity', 'MY EDITED IDENTITY', 'identity', 1, 1, 'system', ${now}, ${now})`)
  const svc = createWizardService(db)
  const assembler = createPromptAssembler({
    workspaceLoader: { load: async () => fakeWs as never, invalidate: () => {}, invalidateAll: () => {} },
    projectContextLoader: { cascade: async () => ({ projectAgents: null, projectTypeAgents: null, projectId: null, projectTypeId: null }) },
    resolveSkillsFor: async () => [], resolveToolsFor: async () => [],
    resolveTeamContext: async () => null, resolveMemoryContext: async () => null,
    resolveActiveVoice: async () => ({ scope: 'internal', reason: 'x', profile: { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'nincs', emoji: 'soha', blockedPhrases: [], signature: '' } }),
    resolveRuntime: () => ({ date: '2026-07-11', time: '10:00 CET', channel: 'owner_dm', os: 'darwin' }),
    resolveContextWindow: async () => 200_000,
    resolveMasterSections: async () => ({ identity: svc.getMasterSection('identity') ?? 'FALLBACK', coreRules: svc.getMasterSection('core-rules') ?? 'FALLBACK RULES', personality: svc.getMasterSection('personality') ?? 'FALLBACK PERSONALITY' }),
  })
  const a = await assembler.buildForPrimary({ agentId: 'a', agentName: 'a', conversationId: null, projectId: null, channelContext: null })
  expect(a.prefix).toContain('MY EDITED IDENTITY')
})
