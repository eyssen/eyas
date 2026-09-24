// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, afterEach } from 'vitest'
import { rmSync } from 'node:fs'
import { sql } from 'drizzle-orm'
import { createPolicyStore } from '@modules/privacy/policy-store'
import { BUILT_IN_DEFAULTS, PrivacyPolicySchema } from '@modules/privacy/policy'
import { createPrivacyFixture, type PrivacyFixture } from '../../helpers/privacy-service'

let fx: PrivacyFixture
afterEach(() => fx?.cleanup())

describe('privacy policy store', () => {
  it('seeds from the YAML on first boot', () => {
    fx = createPrivacyFixture({ actions: { iban: 'mask' }, localHosts: ['gpu.lan'] })
    const s = fx.store.current()
    expect(s).toMatchObject({ source: 'yaml', version: 1, seedError: null })
    expect(s.policy.actions.iban).toBe('mask')
    expect(s.policy.localHosts).toEqual(['gpu.lan'])
    expect(s.yamlHash).toMatch(/^[0-9a-f]{64}$/)
    expect(fx.logger.error).not.toHaveBeenCalled()
  })

  it('re-imports a changed YAML while the policy comes from the YAML', () => {
    fx = createPrivacyFixture({})
    fx.writeYaml({ actions: { email: 'off' } })
    expect(fx.store.syncFromYaml()).toBe(true)
    expect(fx.store.current()).toMatchObject({ source: 'yaml', version: 2 })
    expect(fx.store.current().policy.actions.email).toBe('off')
  })

  it('does not bump the version for an unchanged or comment-only YAML', () => {
    fx = createPrivacyFixture({})
    expect(fx.store.syncFromYaml()).toBe(false)
    const hashBefore = fx.store.current().yamlHash
    fx.writeYaml('# just a comment\nprivacy: {}\n')
    expect(fx.store.syncFromYaml()).toBe(false)
    expect(fx.store.current().version).toBe(1)
    expect(fx.store.current().yamlHash).not.toBe(hashBefore)
  })

  it('ignores YAML changes with one warning after a UI save', () => {
    fx = createPrivacyFixture({})
    const saved = fx.store.save(PrivacyPolicySchema.parse({ actions: { iban: 'warn' } }), 'ui')
    expect(saved).toMatchObject({ source: 'ui', version: 2 })

    fx.writeYaml({ actions: { iban: 'off' } })
    expect(fx.store.syncFromYaml()).toBe(false)
    expect(fx.store.current().policy.actions.iban).toBe('warn')
    expect(fx.store.current().version).toBe(2)
    expect(fx.logger.warn).toHaveBeenCalledTimes(1)
    expect(fx.logger.warn.mock.calls[0][0]).toMatchObject({ path: fx.yamlPath })

    // The same (ignored) content does not warn again.
    expect(fx.store.syncFromYaml()).toBe(false)
    expect(fx.logger.warn).toHaveBeenCalledTimes(1)
  })

  it('keeps the last good policy, logs the path and records seed_error for an invalid YAML', () => {
    fx = createPrivacyFixture({ actions: { iban: 'mask' } })
    const good = fx.store.current()
    fx.writeYaml({ actions: { iban: 'explode' } })

    expect(fx.store.syncFromYaml()).toBe(false)
    expect(fx.logger.error).toHaveBeenCalledTimes(1)
    const [detail] = fx.logger.error.mock.calls[0]
    expect(detail).toMatchObject({ path: fx.yamlPath })
    expect(detail.issues[0].path).toBe('actions.iban')

    const now = fx.store.current()
    expect(now.policy).toEqual(good.policy)
    expect(now.version).toBe(good.version)
    expect(now.seedError).toContain('actions.iban')

    // Restoring the previous content clears the error without a version bump.
    fx.writeYaml({ actions: { iban: 'mask' } })
    expect(fx.store.syncFromYaml()).toBe(false)
    expect(fx.store.current()).toMatchObject({ seedError: null, version: good.version })
  })

  it('uses the built-in defaults and records an error when the YAML is missing on first boot', () => {
    fx = createPrivacyFixture(null)
    const s = fx.store.current()
    expect(s).toMatchObject({ source: 'defaults', version: 1 })
    expect(s.policy).toEqual(BUILT_IN_DEFAULTS)
    expect(s.seedError).toContain(fx.yamlPath)
    expect(fx.logger.error.mock.calls[0][0]).toMatchObject({ path: fx.yamlPath })

    // A valid YAML appearing later is imported.
    fx.writeYaml({ actions: { phone: 'warn' } })
    expect(fx.store.syncFromYaml()).toBe(true)
    expect(fx.store.current()).toMatchObject({ source: 'yaml', version: 2, seedError: null })
  })

  it('keeps the last good policy when the YAML disappears later', () => {
    fx = createPrivacyFixture({ actions: { iban: 'mask' } })
    rmSync(fx.yamlPath)
    expect(fx.store.syncFromYaml()).toBe(false)
    expect(fx.store.current().policy.actions.iban).toBe('mask')
    expect(fx.store.current().seedError).toContain('not found')
  })

  it('increments the version on every save and persists across a restart', () => {
    fx = createPrivacyFixture({})
    fx.store.save(PrivacyPolicySchema.parse({ audit: false }), 'ui')
    fx.store.save(PrivacyPolicySchema.parse({ audit: true, enabled: false }), 'ui')
    expect(fx.store.current().version).toBe(3)

    const reopened = createPolicyStore({ db: fx.db, logger: fx.logger as any, yamlPath: fx.yamlPath })
    expect(reopened.current()).toMatchObject({ source: 'ui', version: 3 })
    expect(reopened.current().policy.enabled).toBe(false)
  })

  it('falls back to the defaults, loudly, when the stored row is unreadable', () => {
    fx = createPrivacyFixture({})
    fx.store.save(PrivacyPolicySchema.parse({ actions: { iban: 'off' } }), 'ui')
    fx.db.run(sql`UPDATE privacy_policy SET json = '{"actions":{"iban":"explode"}}'`)
    fx.logger.error.mockClear()
    const reopened = createPolicyStore({ db: fx.db, logger: fx.logger as any, yamlPath: fx.yamlPath })
    expect(reopened.current().policy).toEqual(BUILT_IN_DEFAULTS)
    expect(fx.logger.error).toHaveBeenCalled()
  })
})
