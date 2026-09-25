// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B2: a memory-path violation is a policy verdict, not a probe signal. A
// model that retries a forbidden path three times must not lock the green
// tools out for the streak cooldown (the rate-limit lockout seen with Grok
// reading ~/.claude skills was exactly that, not a policy).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { join } from 'node:path'
import { createDeterministicGate } from '@modules/security-gate/deterministic-gate'
import { DEFAULT_CONFIG, type SecurityGateConfig } from '@modules/security-gate/types'
import { installPathPolicy, resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture'

let fx: SovereigntyFixture
beforeAll(() => {
  fx = createSovereigntyFixture()
  installPathPolicy(fx.policy)
})
afterAll(() => {
  resetPathPolicyForTests()
  fx.cleanup()
})

describe('memory-path denies and the denial streak', () => {
  let config: SecurityGateConfig
  beforeEach(() => {
    config = { ...DEFAULT_CONFIG }
  })

  it('(+) three memory-path denies in a row do not lock a following green Read', () => {
    const gate = createDeterministicGate(config)
    expect(config.rateLimits.streak).toBe(3)
    expect(gate.check('Read', { file_path: fx.claudeMemory }).decision).toBe('deny')
    expect(gate.check('Glob', { pattern: `${fx.vault}/**` }).decision).toBe('deny')
    expect(gate.check('Write', { file_path: fx.eyasVaultNote, content: 'x' }).decision).toBe('deny')
    expect(gate.check('Read', { file_path: fx.vaultNote }).decision).toBe('deny')

    const next = gate.check('Read', { file_path: join(fx.repo, 'src', 'a.ts') })
    expect(next.decision).toBe('allow')
    expect(next.reason).not.toMatch(/consecutive denials/)
  })

  it('(+) a memory-path deny does not reset a streak either', () => {
    const gate = createDeterministicGate(config)
    gate.recordDenial()
    gate.recordDenial()
    gate.check('Read', { file_path: fx.claudeMemory })
    gate.recordDenial()
    const locked = gate.check('search_memory', { query: 'x' })
    expect(locked.decision).toBe('deny')
    expect(locked.reason).toContain('consecutive denials')
  })

  it('(+) a memory-path deny still wins while the streak is locked, with its own reason', () => {
    const gate = createDeterministicGate(config)
    gate.recordDenial()
    gate.recordDenial()
    gate.recordDenial()
    expect(gate.check('Read', { file_path: fx.claudeMemory }).reason).toMatch(/^Memory outside EYAS/)
  })

  it('(−) a sensitive-path deny still bumps the streak (negative control)', () => {
    const gate = createDeterministicGate(config)
    gate.check('Read', { file_path: 'data/master.key' })
    gate.check('Read', { file_path: 'data/master.key' })
    gate.check('Read', { file_path: 'data/master.key' })
    const locked = gate.check('Read', { file_path: join(fx.repo, 'src', 'a.ts') })
    expect(locked.decision).toBe('deny')
    expect(locked.reason).toContain('consecutive denials')
  })
})
