import { describe, it, expect } from 'vitest'
import { ensureWebDist, isWebDistStale, newestMtimeMs } from '../../src/cli/utils/ensure-web-dist'
import { detectInstallRoot, resolveWebDistDir } from '../../src/core/instance'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'fs'
import { tmpdir } from 'os'

describe('ensureWebDist', () => {
  it('reports up to date when dist is newer than sources (skipBuild avoids spawn)', async () => {
    const root = detectInstallRoot()
    const before = resolveWebDistDir(root)
    if (!before) {
      expect(existsSync(join(root, 'package.json'))).toBe(true)
      return
    }
    // skipBuild: we only assert the presence path; full rebuild is integration-level
    const result = await ensureWebDist({
      installRoot: root,
      verbose: false,
      skipBuild: true,
      rebuildIfStale: false,
    })
    expect(result.webDistDir).toBe(before)
    expect(result.built).toBe(false)
  })

  it('skipBuild leaves missing dist as null without spawning', async () => {
    const result = await ensureWebDist({
      installRoot: '/tmp/eyas-no-such-install-root-xyz',
      skipBuild: true,
      verbose: false,
    })
    expect(result.webDistDir).toBeNull()
    expect(result.built).toBe(false)
    expect(result.message).toMatch(/skip|No frontend/i)
  })

  it('isWebDistStale is true when a source file is newer than dist index', () => {
    const dir = join(tmpdir(), `eyas-stale-${Date.now()}`)
    const dist = join(dir, 'dist')
    const src = join(dir, 'src', 'web', 'src')
    mkdirSync(dist, { recursive: true })
    mkdirSync(src, { recursive: true })
    writeFileSync(join(dist, 'index.html'), '<html></html>')
    writeFileSync(join(src, 'App.tsx'), 'export {}')
    // dist old, source new
    const old = new Date('2020-01-01')
    const neu = new Date('2030-01-01')
    utimesSync(join(dist, 'index.html'), old, old)
    utimesSync(join(src, 'App.tsx'), neu, neu)
    // installRoot layout: src/web/src under installRoot
    // isWebDistStale(installRoot, distDir) looks at installRoot/src/web/src
    // so structure is dir/src/web/src — installRoot = dir, distDir = dir/dist
    // Wait: isWebDistStale joins installRoot + 'src/web/src'
    // Our src is dir/src/web/src — installRoot = dir ✓
    expect(isWebDistStale(dir, dist)).toBe(true)
    // dist newer than source
    utimesSync(join(dist, 'index.html'), neu, neu)
    utimesSync(join(src, 'App.tsx'), old, old)
    expect(isWebDistStale(dir, dist)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('newestMtimeMs returns 0 for missing dir', () => {
    expect(newestMtimeMs('/tmp/eyas-no-such-mtime-dir-xyz')).toBe(0)
  })
})
