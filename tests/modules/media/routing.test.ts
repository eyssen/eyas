// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { defaultMediaSettings, resolveProviders, suggestedProviderId } from '@modules/media/routing'
import { assertBudget } from '@modules/media/budget'
import type { MediaSettings } from '@modules/media/types'

function settings(over: Partial<MediaSettings> = {}): MediaSettings {
  return { ...defaultMediaSettings(), ...over, routing: { ...defaultMediaSettings().routing, ...(over.routing ?? {}) } }
}

describe('resolveProviders', () => {
  it('uses providers[] when set', () => {
    expect(resolveProviders({
      kind: 'image', providers: ['fal', 'magnific'], settings: settings(), configuredIds: ['fal', 'magnific'],
    })).toEqual(['fal', 'magnific'])
  })

  it('rejects an unconfigured pin', () => {
    expect(resolveProviders({
      kind: 'image', provider: 'magnific', settings: settings(), configuredIds: ['fal'],
    })).toEqual([])
  })

  it('falls back to the only configured provider that supports the kind', () => {
    expect(resolveProviders({
      kind: 'image', settings: settings(), configuredIds: ['fal'],
    })).toEqual(['fal'])
  })

  it('uses the suggestion when that provider is configured and nothing is pinned', () => {
    expect(suggestedProviderId('upscale')).toBe('magnific')
    expect(resolveProviders({
      kind: 'upscale', settings: settings(), configuredIds: ['magnific', 'fal'],
    })).toEqual(['magnific'])
  })

  it('includes alsoRunOn', () => {
    const s = settings()
    s.routing.image.defaultProviderId = 'magnific'
    s.routing.image.alsoRunOn = ['fal']
    expect(resolveProviders({
      kind: 'image', settings: s, configuredIds: ['magnific', 'fal'],
    })).toEqual(['magnific', 'fal'])
  })
})

describe('assertBudget', () => {
  it('throws when daily cap would be exceeded', () => {
    expect(() => assertBudget({
      providerId: 'fal',
      settings: { ...defaultMediaSettings(), budget: { fal: { dailyCredits: 10, monthlyCredits: null } } },
      spentDaily: 10,
      spentMonthly: 10,
    })).toThrow(/budget:/)
  })

  it('allows unknown spend (null credits do not block — caller passes 0)', () => {
    expect(() => assertBudget({
      providerId: 'fal',
      settings: defaultMediaSettings(),
      spentDaily: 999,
      spentMonthly: 999,
    })).not.toThrow()
  })
})
