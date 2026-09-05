// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it } from 'vitest'
import { buildCachePrefix } from '../../../src/modules/prompt-wizard/cache-prefix-builder.js'
import { DEFAULT_BUDGET_FULL } from '../../../src/modules/prompt-wizard/token-budget.js'
import { DEFAULT_PERSONALITY, getMasterPrompt } from '../../../src/modules/prompt-wizard/master-prompt.js'
import { CORE_IDENTITY } from '../../../src/modules/prompt-wizard/core-identity.js'
import { buildCacheSuffix } from '../../../src/modules/prompt-wizard/cache-suffix-builder.js'

const ws: any = {
  identity: { body: '' }, soulMd: { body: '' }, agentsMd: { body: '' }, toolsMd: { body: '' },
}
const cascade: any = { projectAgents: null, projectTypeAgents: null, projectId: null, projectTypeId: null }

describe('personality in prefix', () => {
  it('emits a <default-personality> tag from the personality input', () => {
    const { content: out } = buildCachePrefix({ coreIdentity: 'ID', coreRules: 'RULES', personality: DEFAULT_PERSONALITY, workspace: ws, cascade, skillsList: [], toolsList: [], budget: DEFAULT_BUDGET_FULL })
    expect(out).toContain('<default-personality>')
    expect(out).toContain('sharp, warm teammate')
  })
  it('identity seed is static (no per-install EYAS header)', () => {
    const m = getMasterPrompt()
    expect(m.identity).toBe(CORE_IDENTITY)
    expect(m.identity).not.toMatch(/owner:/)
    expect(m.identity).toMatch(/reflect on what worked/i) // self-improvement clause present
    expect(m.personality).toBe(DEFAULT_PERSONALITY)
  })
  it('version + owner render in the <runtime> suffix', () => {
    const { content: s } = buildCacheSuffix({ team: null, memory: null, activeVoice: { scope: 'internal', reason: '', profile: { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'nincs', emoji: 'soha', blockedPhrases: [], signature: '' } }, runtime: { date: '2026-07-11', time: '10:00', channel: 'owner_dm', os: 'darwin', version: '9.9.9', ownerName: 'Ada' }, budget: DEFAULT_BUDGET_FULL })
    expect(s).toContain('9.9.9')
    expect(s).toContain('Ada')
  })
})
