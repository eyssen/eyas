import { describe, it, expect } from 'vitest'
import { ensureDocsDist, isDocsDistStale } from '../../src/cli/utils/ensure-docs-dist'
import { detectInstallRoot, resolveDocsDistDir } from '../../src/core/instance'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { resolveStaticFile, tryServeDocs } from '../../src/cli/utils/static-files'

describe('ensureDocsDist', () => {
  it('reports up to date when dist exists (skipBuild avoids spawn)', async () => {
    const root = detectInstallRoot()
    const before = resolveDocsDistDir(root)
    if (!before) {
      // Docs not built in this tree — still assert skip path
      const result = await ensureDocsDist({
        installRoot: root,
        verbose: false,
        skipBuild: true,
        rebuildIfStale: false,
      })
      expect(result.built).toBe(false)
      return
    }
    const result = await ensureDocsDist({
      installRoot: root,
      verbose: false,
      skipBuild: true,
      rebuildIfStale: false,
    })
    expect(result.docsDistDir).toBe(before)
    expect(result.built).toBe(false)
  })

  it('skipBuild leaves missing dist as null without spawning', async () => {
    const result = await ensureDocsDist({
      installRoot: '/tmp/eyas-no-such-install-root-docs-xyz',
      skipBuild: true,
      verbose: false,
    })
    expect(result.docsDistDir).toBeNull()
    expect(result.built).toBe(false)
    expect(result.message).toMatch(/No product docs|skip|will not be served/i)
  })

  it('isDocsDistStale is true when a markdown source is newer than dist index', () => {
    const dir = join(tmpdir(), `eyas-docs-stale-${Date.now()}`)
    const dist = join(dir, 'packages', 'docs', 'dist')
    const src = join(dir, 'packages', 'docs', 'src', 'content', 'docs', 'en')
    mkdirSync(dist, { recursive: true })
    mkdirSync(src, { recursive: true })
    writeFileSync(join(dist, 'index.html'), '<html></html>')
    writeFileSync(join(src, 'index.md'), '# hi')
    const old = new Date('2020-01-01')
    const neu = new Date('2030-01-01')
    utimesSync(join(dist, 'index.html'), old, old)
    utimesSync(join(src, 'index.md'), neu, neu)
    expect(isDocsDistStale(dir, dist)).toBe(true)
    utimesSync(join(dist, 'index.html'), neu, neu)
    utimesSync(join(src, 'index.md'), old, old)
    expect(isDocsDistStale(dir, dist)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('static-files docs serving', () => {
  it('tryServeDocs returns null for non-docs paths', () => {
    expect(tryServeDocs('/agents', '/tmp/any')).toBeNull()
    expect(tryServeDocs('/api/v1/health', '/tmp/any')).toBeNull()
  })

  it('resolveStaticFile maps directory to index.html and rejects traversal', () => {
    const dir = join(tmpdir(), `eyas-static-${Date.now()}`)
    mkdirSync(join(dir, 'en'), { recursive: true })
    writeFileSync(join(dir, 'index.html'), '<html>root</html>')
    writeFileSync(join(dir, 'en', 'index.html'), '<html>en</html>')
    expect(resolveStaticFile(dir, 'index.html')).toBe(join(dir, 'index.html'))
    expect(resolveStaticFile(dir, 'en')).toBe(join(dir, 'en', 'index.html'))
    expect(resolveStaticFile(dir, 'en/')).toBe(join(dir, 'en', 'index.html'))
    expect(resolveStaticFile(dir, '../outside')).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('tryServeDocs serves /docs/en/ from dist/en/index.html', () => {
    const dir = join(tmpdir(), `eyas-docs-serve-${Date.now()}`)
    mkdirSync(join(dir, 'en'), { recursive: true })
    writeFileSync(join(dir, 'index.html'), '<html>root</html>')
    writeFileSync(join(dir, 'en', 'index.html'), '<html>en welcome</html>')
    const res = tryServeDocs('/docs/en/', dir)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    rmSync(dir, { recursive: true, force: true })
  })
})
