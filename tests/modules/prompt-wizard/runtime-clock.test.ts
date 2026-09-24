// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The clock EYAS tells a model: one zone for date and time (i18n.timezone,
// else the server's), the zone named in the time, no owner locale baked in.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { formatNow, hostTimeZone, isValidTimeZone, resolveTimeZone } from '@shared/clock'
import { configSchema } from '@core/config/schema'
import { createPromptAssembler } from '@modules/prompt-wizard/assembler'
import { flattenAssembled } from '@modules/prompt-wizard/assemble-system'

// 2026-03-15 03:30 UTC is still 14 March, 23:30 in New York (EDT, UTC-4):
// a date taken from UTC and a time taken from the zone would disagree here.
const NEAR_MIDNIGHT_UTC = new Date(Date.UTC(2026, 2, 15, 3, 30, 0))

describe('formatNow', () => {
  it('computes date and time in the same zone near midnight UTC', () => {
    const now = formatNow('America/New_York', NEAR_MIDNIGHT_UTC)
    expect(now.date).toBe('2026-03-14')
    expect(now.time).toBe('23:30 (America/New_York, UTC-04:00)')
    expect(now.timeZone).toBe('America/New_York')
    expect(now.offsetMinutes).toBe(-240)
  })

  it('handles zones east of UTC and half-hour offsets', () => {
    expect(formatNow('Asia/Kolkata', NEAR_MIDNIGHT_UTC)).toMatchObject({
      date: '2026-03-15', time: '09:00 (Asia/Kolkata, UTC+05:30)', offsetMinutes: 330,
    })
    expect(formatNow('UTC', NEAR_MIDNIGHT_UTC)).toMatchObject({ date: '2026-03-15', time: '03:30 (UTC, UTC+00:00)' })
  })

  it('prints midnight as 00, never 24', () => {
    const midnight = new Date(Date.UTC(2026, 5, 1, 0, 5, 0))
    expect(formatNow('UTC', midnight).time).toBe('00:05 (UTC, UTC+00:00)')
  })

  it('uses the server zone when no zone is configured', () => {
    const host = hostTimeZone()
    expect(isValidTimeZone(host)).toBe(true)
    expect(resolveTimeZone(undefined)).toBe(host)
    expect(formatNow(undefined, NEAR_MIDNIGHT_UTC).timeZone).toBe(host)
    expect(formatNow(null, NEAR_MIDNIGHT_UTC)).toEqual(formatNow(host, NEAR_MIDNIGHT_UTC))
  })

  it('falls back to the server zone for an invalid zone instead of throwing', () => {
    expect(resolveTimeZone('Mars/Olympus_Mons')).toBe(hostTimeZone())
    expect(() => formatNow('Mars/Olympus_Mons', NEAR_MIDNIGHT_UTC)).not.toThrow()
  })
})

describe('i18n.timezone config', () => {
  it('accepts an IANA zone and leaves the key unset by default', () => {
    expect(configSchema.parse({ i18n: { timezone: 'America/New_York' } }).i18n.timezone).toBe('America/New_York')
    expect(configSchema.parse({ i18n: { timezone: 'UTC' } }).i18n.timezone).toBe('UTC')
    expect(configSchema.parse({}).i18n.timezone).toBeUndefined()
  })

  it('rejects a value that is not a time zone', () => {
    for (const bad of ['Mars/Olympus_Mons', 'GMT+99', '', '   ']) {
      const parsed = configSchema.safeParse({ i18n: { timezone: bad } })
      expect(parsed.success, bad).toBe(false)
    }
    expect(configSchema.safeParse({ i18n: { timezone: 42 } }).success).toBe(false)
  })
})

describe('prompt-wizard runtime section', () => {
  it('bakes in no owner locale or time zone', () => {
    const dir = resolve('src/modules/prompt-wizard')
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8')
      expect(text, f).not.toMatch(/Europe\/Budapest|['"]hu-HU['"]/)
      expect(text, f).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/)
    }
  })

  it('reads the clock from i18n.timezone, into the turn block', () => {
    const index = readFileSync(resolve('src/modules/prompt-wizard/index.ts'), 'utf8')
    expect(index).toMatch(/resolveClock: \(\) => formatNow\(ctx\.config\?\.i18n\?\.timezone\)/)
  })
})

// I4 — the clock is told once per message, in the turn block attached to the
// user message; the system prompt carries no date or time.
describe('the turn block carries the clock', () => {
  const file = (name: string) => ({ name, path: '', exists: true, frontmatter: null, body: '', byteSize: 0, truncated: false })
  const assembler = createPromptAssembler({
    workspaceLoader: {
      load: async () => ({
        agentId: 'a1', rootPath: '/tmp/a1',
        identity: file('IDENTITY.md'), soulMd: file('SOUL.md'), soulStyleJson: { ...file('SOUL.style.json'), body: '{}' },
        agentsMd: file('AGENTS.md'), toolsMd: file('TOOLS.md'), memoryMd: file('MEMORY.md'), dailyMemory: [],
      }) as never,
      invalidate: () => {},
      invalidateAll: () => {},
    },
    projectContextLoader: { cascade: async () => ({ projectAgents: null, projectTypeAgents: null, projectId: null, projectTypeId: null }) },
    resolveSkillsFor: async () => [],
    resolveToolsFor: async () => [],
    resolveTeamContext: async () => null,
    resolveMemoryContext: async () => null,
    resolveActiveVoice: async () => ({ scope: 'internal', reason: 'owner DM', profile: { address: 'tegező', tone: 'baráti', verbosity: 'lényegre törő', directness: 'direkt + udvarias', humor: 'nincs', emoji: 'soha', blockedPhrases: [], signature: '' } }),
    resolveRuntime: () => ({ channel: 'owner_dm', os: 'linux' }),
    // What index.ts wires, with a fixed instant: the configured zone.
    resolveClock: () => formatNow('America/New_York', NEAR_MIDNIGHT_UTC),
    resolveMasterSections: async () => ({ identity: 'identity', coreRules: 'rules', personality: 'personality' }),
  })

  it('(+) the formatNow reading for the configured zone is in the turn block', async () => {
    const a = await assembler.buildForPrimary({ agentId: 'a1', agentName: 'a1', conversationId: null, projectId: null, channelContext: null })
    expect(a.turn).toContain('Current date and time: 2026-03-14 23:30 (America/New_York, UTC-04:00)')
  })

  it('(−) the system prompt carries no date or time', async () => {
    const a = await assembler.buildForPrimary({ agentId: 'a1', agentName: 'a1', conversationId: null, projectId: null, channelContext: null })
    const system = flattenAssembled(a)
    expect(system).not.toContain('2026-03-14')
    expect(system).not.toContain('23:30')
    expect(system).not.toMatch(/Current date|Current time/)
  })
})
