// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createProviderConfigService } from '@modules/model/provider-config-service'

const testDb = createTestDb('provider-defaults')
let db: ReturnType<typeof testDb.open>

beforeEach(() => { db = testDb.open() })
afterEach(() => testDb.cleanup())

describe('default provider/model', () => {
  it('getDefault returns null when no default set', () => {
    const svc = createProviderConfigService(db)
    svc.ensureProvider('anthropic')
    expect(svc.getDefault()).toBeNull()
  })

  it('setDefault marks a provider as default', () => {
    const svc = createProviderConfigService(db)
    svc.ensureProvider('anthropic')
    svc.ensureProvider('openai')
    svc.setDefault('anthropic', 'claude-sonnet-4-5-20250514')
    const def = svc.getDefault()
    expect(def).toEqual({ providerId: 'anthropic', modelId: 'claude-sonnet-4-5-20250514' })
  })

  it('setDefault clears previous default', () => {
    const svc = createProviderConfigService(db)
    svc.ensureProvider('anthropic')
    svc.ensureProvider('openai')
    svc.setDefault('anthropic', 'claude-sonnet-4-5-20250514')
    svc.setDefault('openai', 'gpt-4o')
    const def = svc.getDefault()
    expect(def).toEqual({ providerId: 'openai', modelId: 'gpt-4o' })
    const anthropic = svc.getProvider('anthropic')
    expect(anthropic!.isDefault).toBe(false)
  })
})
