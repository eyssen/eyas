// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { classifySkill, resolveClassifyConfig, DEFAULT_CLASSIFY_CONFIG as cfg } from '@modules/skills/classify-skill'

const now = new Date('2026-08-24T00:00:00Z')
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString()
const base = { source: 'bundled', createdAt: daysAgo(400), useCount: 0, lastUsedAt: null, isShadowed: false, isOrphan: false, situational: false }

describe('classifySkill', () => {
  it('calls a recently used skill healthy', () => {
    const r = classifySkill({ ...base, useCount: 5, lastUsedAt: daysAgo(2) }, cfg, now)
    expect(r).toMatchObject({ category: 'healthy', proposeDisable: false })
  })

  it('exempts a skill inside the grace period even with zero use', () => {
    const r = classifySkill({ ...base, createdAt: daysAgo(3) }, cfg, now)
    expect(r).toMatchObject({ category: 'new', proposeDisable: false })
  })

  it('proposes disabling an orphan', () => {
    const r = classifySkill({ ...base, isOrphan: true, useCount: 9, lastUsedAt: daysAgo(1) }, cfg, now)
    expect(r).toMatchObject({ category: 'orphan', proposeDisable: true })
  })

  it('proposes disabling a permanently shadowed duplicate', () => {
    const r = classifySkill({ ...base, isShadowed: true }, cfg, now)
    expect(r).toMatchObject({ category: 'shadowed', proposeDisable: true })
  })

  it('proposes disabling a never-used skill past the grace period', () => {
    const r = classifySkill({ ...base, createdAt: daysAgo(200) }, cfg, now)
    expect(r).toMatchObject({ category: 'never-used', proposeDisable: true })
  })

  it('proposes disabling a long-dormant skill', () => {
    const r = classifySkill({ ...base, useCount: 3, lastUsedAt: daysAgo(200) }, cfg, now)
    expect(r).toMatchObject({ category: 'dormant', proposeDisable: true })
  })

  it('NEVER proposes disabling a situational skill on time alone', () => {
    const r = classifySkill({ ...base, situational: true, useCount: 1, lastUsedAt: daysAgo(400) }, cfg, now)
    expect(r.proposeDisable).toBe(false)
  })

  it('still proposes disabling a situational skill that is orphaned', () => {
    const r = classifySkill({ ...base, situational: true, isOrphan: true }, cfg, now)
    expect(r.proposeDisable).toBe(true)
  })

  it('never proposes disabling a user-authored skill on time alone', () => {
    const r = classifySkill({ ...base, source: 'user', createdAt: daysAgo(500) }, cfg, now)
    expect(r.proposeDisable).toBe(false)
  })

  // Boundary pins (final review item 4) — every comparison in classifySkill is
  // a strict `<` except the dormant check, which is `>=`. These three cases
  // land exactly on each threshold so the boundary side is locked in by a
  // test, not left to be discovered later by whoever next touches the `<` vs
  // `<=` on one of these. PINS current behaviour only — does not judge it.
  describe('exact threshold boundaries (pinned, not asserted-correct)', () => {
    it('ageDays === graceDays (30): grace no longer applies at the boundary itself', () => {
      // ageDays < graceDays is false here, so the grace exemption ends exactly
      // AT graceDays, not after it — the boundary day already counts as "old
      // enough". It then falls through to the never-used check, which at 30
      // days (< neverUsedDays=90) still waits.
      const r = classifySkill({ ...base, createdAt: daysAgo(cfg.graceDays) }, cfg, now)
      expect(r).toMatchObject({ category: 'never-used', proposeDisable: false })
    })

    it('ageDays === neverUsedDays (90): the boundary day itself is proposed', () => {
      // ageDays < neverUsedDays is false here, so "still young enough to wait"
      // ends exactly AT neverUsedDays — the boundary day is treated as due.
      const r = classifySkill({ ...base, createdAt: daysAgo(cfg.neverUsedDays) }, cfg, now)
      expect(r).toMatchObject({ category: 'never-used', proposeDisable: true })
    })

    it('idleDays === dormantDays (180): the boundary day itself counts as dormant', () => {
      // idleDays >= dormantDays — the ONLY non-strict comparison in this
      // module — is true at the boundary, so exactly-180-days-idle already
      // counts as dormant (consistent with the two `<` cases above: in every
      // case, the threshold instant itself lands on the more-aggressive side).
      const r = classifySkill({ ...base, useCount: 3, lastUsedAt: daysAgo(cfg.dormantDays) }, cfg, now)
      expect(r).toMatchObject({ category: 'dormant', proposeDisable: true })
    })
  })
})

describe('resolveClassifyConfig', () => {
  it('falls back per-field: a config supplying only graceDays keeps the other defaults', () => {
    const resolved = resolveClassifyConfig({ skills: { classify: { graceDays: 14 } } })
    expect(resolved).toEqual({
      graceDays: 14,
      neverUsedDays: cfg.neverUsedDays,
      dormantDays: cfg.dormantDays,
      timeExemptSources: cfg.timeExemptSources,
    })
  })
})
