// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { tryServePublicAsset, PUBLIC_ASSET_PREFIX } from '../../src/cli/utils/public-assets'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'eyas-public-'))
  mkdirSync(join(root, 'brand', 'b1'), { recursive: true })
  writeFileSync(join(root, 'brand', 'b1', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(root, 'brand', 'b1', 'evil.html'), '<script>alert(1)</script>')
  writeFileSync(join(root, 'brand', 'b1', 'mark.svg'), '<svg onload="alert(1)"/>')
  writeFileSync(join(root, 'secret.txt'), 'nope')
})

afterAll(() => { rmSync(root, { recursive: true, force: true }) })

describe('tryServePublicAsset', () => {
  it('returns null for paths outside the prefix', () => {
    expect(tryServePublicAsset('/api/v1/health', root)).toBeNull()
    expect(tryServePublicAsset('/', root)).toBeNull()
  })

  it('serves an existing image with its mime type', () => {
    const res = tryServePublicAsset(`${PUBLIC_ASSET_PREFIX}brand/b1/logo.png`, root)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    expect(res!.headers.get('content-type')).toBe('image/png')
  })

  it('sets cross-origin CORP so the asset can load in an email or export', () => {
    const res = tryServePublicAsset(`${PUBLIC_ASSET_PREFIX}brand/b1/logo.png`, root)!
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toContain('max-age=')
  })

  it('refuses extensions that are not in the asset allow-list', () => {
    expect(tryServePublicAsset(`${PUBLIC_ASSET_PREFIX}brand/b1/evil.html`, root)).toBeNull()
  })

  it('refuses SVG — this origin holds the session cookie', () => {
    expect(tryServePublicAsset(`${PUBLIC_ASSET_PREFIX}brand/b1/mark.svg`, root)).toBeNull()
  })

  it('refuses path traversal out of the root', () => {
    expect(tryServePublicAsset(`${PUBLIC_ASSET_PREFIX}../secret.txt`, root)).toBeNull()
    expect(tryServePublicAsset(`${PUBLIC_ASSET_PREFIX}brand/../../secret.txt`, root)).toBeNull()
  })

  it('refuses encoded traversal', () => {
    expect(tryServePublicAsset(`${PUBLIC_ASSET_PREFIX}%2e%2e/secret.txt`, root)).toBeNull()
  })

  it('returns null for a missing file rather than throwing', () => {
    expect(tryServePublicAsset(`${PUBLIC_ASSET_PREFIX}brand/b1/absent.png`, root)).toBeNull()
  })

  it('returns null for a directory', () => {
    expect(tryServePublicAsset(`${PUBLIC_ASSET_PREFIX}brand/b1`, root)).toBeNull()
  })
})
