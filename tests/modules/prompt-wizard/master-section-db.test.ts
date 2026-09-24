// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createWizardService } from '../../../src/modules/prompt-wizard/wizard-service.js'
import { createPromptAssembler } from '../../../src/modules/prompt-wizard/assembler.js'
import { unresolvedDeliveryProfile } from '../../../src/modules/prompt-wizard/delivery-profile.js'
import { renderMasterSections } from '../../../src/modules/prompt-wizard/master-variant.js'
import { PRIOR_CORE_RULES, PRIOR_IDENTITY_BODIES, refreshMasterSeedsFromKnownDefaults } from '../../../src/modules/prompt-wizard/seed-migration.js'
import { CORE_IDENTITY } from '../../../src/modules/prompt-wizard/core-identity.js'
import { CORE_RULES } from '../../../src/modules/prompt-wizard/core-rules.js'
import { DEFAULT_PERSONALITY } from '../../../src/modules/prompt-wizard/master-prompt.js'

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
    resolveMasterSections: async () => ({ identity: svc.getMasterSection('identity') ?? 'FALLBACK', coreRules: svc.getMasterSection('core-rules') ?? 'FALLBACK RULES', personality: svc.getMasterSection('personality') ?? 'FALLBACK PERSONALITY' }),
  })
  const a = await assembler.buildForPrimary({ agentId: 'a', agentName: 'a', conversationId: null, projectId: null, channelContext: null })
  expect(a.prefix).toContain('MY EDITED IDENTITY')
})

describe('K7 — the tool-less wording is render-time only (seed migration)', () => {
  const toolLess = () => ({ ...unresolvedDeliveryProfile(), resolved: true, windowSource: 'catalog' as const, providerId: 'p', modelId: 'm', supportsTools: false, drillDown: false })
  function seedRow(db: any, id: string, section: string, content: string) {
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO prompt_templates (id, level, target_id, name, content, section, locked, is_active, created_by, created_at, updated_at)
      VALUES (${id}, 'master', NULL, ${id}, ${content}, ${section}, 1, 1, 'system', ${now}, ${now})`)
  }
  function dbAssembler(db: any) {
    const svc = createWizardService(db)
    return createPromptAssembler({
      workspaceLoader: { load: async () => fakeWs as never, invalidate: () => {}, invalidateAll: () => {} },
      projectContextLoader: { cascade: async () => ({ projectAgents: null, projectTypeAgents: null, projectId: null, projectTypeId: null }) },
      resolveSkillsFor: async () => [], resolveToolsFor: async () => [],
      resolveTeamContext: async () => null, resolveMemoryContext: async () => null,
      resolveActiveVoice: async () => ({ scope: 'internal', reason: 'x', profile: { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'nincs', emoji: 'soha', blockedPhrases: [], signature: '' } }),
      resolveRuntime: () => ({ date: '2026-07-11', time: '10:00 CET', channel: 'owner_dm', os: 'darwin' }),
      resolveDeliveryProfile: toolLess,
      resolveMasterSections: async () => ({ identity: svc.getMasterSection('identity') ?? CORE_IDENTITY, coreRules: svc.getMasterSection('core-rules') ?? CORE_RULES, personality: svc.getMasterSection('personality') ?? DEFAULT_PERSONALITY }),
    })
  }
  const build = (db: any) => dbAssembler(db).buildForPrimary({ agentId: 'a', agentName: 'a', conversationId: null, projectId: null, channelContext: null })
  const CURRENT = { identity: CORE_IDENTITY, coreRules: CORE_RULES, personality: DEFAULT_PERSONALITY }

  it('(+) an upgraded row (known prior seed) is refreshed to the current seed and then swapped at assembly, never in the row', async () => {
    const db = createMemoryDb(); makeTable(db)
    seedRow(db, 'master-identity', 'identity', PRIOR_IDENTITY_BODIES[PRIOR_IDENTITY_BODIES.length - 1]!)
    seedRow(db, 'master-core-rules', 'core-rules', PRIOR_CORE_RULES[PRIOR_CORE_RULES.length - 1]!)
    refreshMasterSeedsFromKnownDefaults(db, CURRENT)
    const a = await build(db)
    expect(a.prefix).toMatch(/cannot call tools, so you cannot search\s+further/)
    expect(a.prefix).not.toMatch(/memory_search|memory_expand/)
    const svc = createWizardService(db)
    expect(svc.getMasterSection('identity')).toBe(CORE_IDENTITY)
    expect(svc.getMasterSection('core-rules')).toBe(CORE_RULES)
  })

  it('(+) the current seed is not stale, and neither tool-less wording is a known prior (it is never stored)', () => {
    const noTools = renderMasterSections(CURRENT, 'no-tools')
    expect(PRIOR_IDENTITY_BODIES).not.toContain(CORE_IDENTITY)
    expect(PRIOR_CORE_RULES).not.toContain(CORE_RULES)
    expect(PRIOR_IDENTITY_BODIES).not.toContain(noTools.identity)
    expect(PRIOR_CORE_RULES).not.toContain(noTools.coreRules)
  })

  it('(−) an owner-edited row is left untouched by the migration and reaches a tool-less model as written', async () => {
    const db = createMemoryDb(); makeTable(db)
    const own = 'MY RULES — always call memory_search before answering.'
    seedRow(db, 'master-core-rules', 'core-rules', own)
    refreshMasterSeedsFromKnownDefaults(db, CURRENT)
    const a = await build(db)
    expect(createWizardService(db).getMasterSection('core-rules')).toBe(own)
    expect(a.sections.find((s) => s.key === 'core-rules')?.content).toContain(own)
  })

  it('(−) a row holding the tool-less wording (pasted in by the owner) is owner text to the migration: kept as is', () => {
    const db = createMemoryDb(); makeTable(db)
    const noToolsRules = renderMasterSections(CURRENT, 'no-tools').coreRules
    seedRow(db, 'master-core-rules', 'core-rules', noToolsRules)
    refreshMasterSeedsFromKnownDefaults(db, CURRENT)
    expect(createWizardService(db).getMasterSection('core-rules')).toBe(noToolsRules)
  })
})
