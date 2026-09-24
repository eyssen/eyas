// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyLicense, extensionRegistry } from '@modules/extensions/registry'

describe('extension registry', () => {
  const recordly = extensionRegistry.find((p) => p.id === 'recordly')

  it('lists Recordly as a manual AGPL companion, never auto-install', () => {
    expect(recordly).toBeDefined()
    expect(recordly!.installType).toBe('manual')
    expect(recordly!.license).toBe('AGPL-3.0')
    expect(recordly!.licenseCompat).toBe('copyleft')
    expect(recordly!.sha256).toBeUndefined()
    expect(recordly!.skillCount).toBe(0)
    expect(recordly!.downloadUrl).toBe('https://github.com/webadderallorg/Recordly')
    expect(recordly!.licenseNotice).toMatch(/does NOT download, vendor, link/i)
    expect(recordly!.setupGuide).toMatch(/will not install it/i)
    expect(recordly!.setupGuide).toMatch(/no CLI/i)
  })

  it('classifies AGPL-3.0 as copyleft', () => {
    expect(classifyLicense('AGPL-3.0')).toBe('copyleft')
  })

  it('does not add Recordly as a package dependency', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    const names = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ]
    expect(names.some((n) => n.toLowerCase().includes('recordly'))).toBe(false)
  })

  it('keeps every manual pack off the auto-download path', () => {
    for (const pack of extensionRegistry.filter((p) => p.installType === 'manual')) {
      expect(pack.setupGuide, pack.id).toBeTruthy()
      expect(pack.downloadUrl, pack.id).toMatch(/^https:\/\//)
      expect(pack.sha256, pack.id).toBeUndefined()
    }
  })
})
