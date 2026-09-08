import { describe, it, expect } from 'vitest'
import {
  compareVersions,
  isNewerVersion,
  normalizeVersion,
  parseVersion,
} from '../../../src/modules/system-update/version-compare'

describe('version-compare', () => {
  it('normalizes v prefix', () => {
    expect(normalizeVersion('v0.8.3-beta')).toBe('0.8.3-beta')
  })

  it('parses core and pre', () => {
    expect(parseVersion('0.8.2-beta')).toEqual({
      core: [0, 8, 2],
      pre: 'beta',
    })
  })

  it('orders betas and releases', () => {
    expect(isNewerVersion('0.8.3-beta', '0.8.2-beta')).toBe(true)
    expect(isNewerVersion('0.8.2-beta', '0.8.3-beta')).toBe(false)
    expect(isNewerVersion('1.0.0', '1.0.0-beta')).toBe(true)
    expect(isNewerVersion('1.0.0-beta', '1.0.0')).toBe(false)
    expect(compareVersions('0.8.2-beta', '0.8.2-beta')).toBe(0)
  })
})
