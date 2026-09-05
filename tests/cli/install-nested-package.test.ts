import { describe, it, expect, afterEach } from 'vitest'
import {
  isUnresolvedPackageError,
  isUnlinkedPackageError,
  listLinkDependencies,
  stripLinkDependencies,
  nestedPackageReady,
  isWebFrontendReady,
  installNestedPackage,
} from '../../scripts/install-nested-package'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readFileSync as readRepo } from 'fs'

const dirs: string[] = []
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('isUnresolvedPackageError', () => {
  it('matches the Vite missing-plugin error from a native one-line install', () => {
    const log = [
      "failed to load config from /Users/adelbenus/eyas/src/web/vite.config.ts",
      'error during build:',
      "ResolveMessage: Cannot find package '@vitejs/plugin-react' imported from /Users/adelbenus/eyas/node_modules/.vite-temp/vite.config.ts.timestamp-1.mjs",
      'error: script "build:web" exited with code 1',
    ].join('\n')
    expect(isUnresolvedPackageError(log)).toBe(true)
  })

  it('matches bun link failures', () => {
    expect(isUnlinkedPackageError('error: Package "@saker/core" is not linked')).toBe(true)
    expect(isUnlinkedPackageError('error: @saker/core@link:@saker/core failed to resolve')).toBe(true)
    expect(isUnresolvedPackageError('error: @saker/core@link:@saker/core failed to resolve')).toBe(true)
  })

  it('does not match unrelated errors', () => {
    expect(isUnresolvedPackageError('TypeScript error TS2304')).toBe(false)
    expect(isUnlinkedPackageError('ECONNRESET')).toBe(false)
  })
})

describe('stripLinkDependencies', () => {
  it('removes only link: specs and reports their names', () => {
    const { pkg, stripped } = stripLinkDependencies({
      name: '@eyas/web',
      dependencies: {
        react: '^19.0.0',
        '@saker/core': 'link:@saker/core',
        '@saker/react': 'link:@saker/react',
      },
      devDependencies: {
        vite: '^6.0.0',
        '@saker/ui': 'link:@saker/ui',
      },
    })
    expect(stripped.sort()).toEqual(['@saker/core', '@saker/react', '@saker/ui'].sort())
    const deps = pkg.dependencies as Record<string, string>
    const dev = pkg.devDependencies as Record<string, string>
    expect(deps.react).toBe('^19.0.0')
    expect(deps['@saker/core']).toBeUndefined()
    expect(dev.vite).toBe('^6.0.0')
    expect(dev['@saker/ui']).toBeUndefined()
  })

  it('listLinkDependencies finds the same names', () => {
    expect(listLinkDependencies({
      dependencies: { '@saker/core': 'link:@saker/core', react: '19' },
    })).toEqual(['@saker/core'])
  })
})

describe('nestedPackageReady / isWebFrontendReady', () => {
  it('is false when markers are missing', () => {
    const dir = tempDir('eyas-web-ready-')
    mkdirSync(join(dir, 'src', 'web'), { recursive: true })
    writeFileSync(join(dir, 'src', 'web', 'package.json'), '{"name":"@eyas/web"}\n')
    expect(isWebFrontendReady(dir)).toBe(false)
    expect(nestedPackageReady(join(dir, 'src', 'web'), ['vite'])).toBe(false)
  })

  it('is true when each marker package.json exists', () => {
    const dir = tempDir('eyas-web-ready-ok-')
    const web = join(dir, 'src', 'web')
    mkdirSync(join(web, 'node_modules', 'vite'), { recursive: true })
    mkdirSync(join(web, 'node_modules', '@vitejs', 'plugin-react'), { recursive: true })
    writeFileSync(join(web, 'package.json'), '{"name":"@eyas/web"}\n')
    writeFileSync(join(web, 'node_modules', 'vite', 'package.json'), '{"name":"vite"}\n')
    writeFileSync(join(web, 'node_modules', '@vitejs', 'plugin-react', 'package.json'), '{"name":"@vitejs/plugin-react"}\n')
    expect(isWebFrontendReady(dir)).toBe(true)
  })
})

describe('installNestedPackage', () => {
  it('is a no-op when package.json is missing', async () => {
    const dir = tempDir('eyas-nested-none-')
    const r = await installNestedPackage(dir)
    expect(r.ok).toBe(true)
    expect(r.message).toMatch(/No package.json/)
  })

  it('skips bun install when skipIfReady markers are present', async () => {
    const dir = tempDir('eyas-nested-skip-')
    mkdirSync(join(dir, 'node_modules', 'vite'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), '{"name":"t"}\n')
    writeFileSync(join(dir, 'node_modules', 'vite', 'package.json'), '{"name":"vite"}\n')
    const r = await installNestedPackage(dir, { skipIfReady: ['vite'] })
    expect(r.ok).toBe(true)
    expect(r.message).toMatch(/Already installed/)
  })

  it('installs remaining deps when link: packages are not bun-linked', async () => {
    const dir = tempDir('eyas-nested-link-')
    const bunRoot = tempDir('eyas-bun-root-')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      name: 't',
      private: true,
      dependencies: {
        '@saker/core': 'link:@saker/core',
      },
    }, null, 2) + '\n')
    const env = { ...process.env, BUN_INSTALL: bunRoot, HOME: bunRoot }
    const r = await installNestedPackage(dir, { env, frozen: false })
    expect(r.ok).toBe(true)
    expect(r.skippedLinks).toContain('@saker/core')
    // Original package.json must be restored so the checkout is not mutated.
    const restored = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    expect(restored.dependencies['@saker/core']).toBe('link:@saker/core')
  })
})

describe('installer scripts know about the nested frontend package', () => {
  it('install.sh installs src/web and retries a missing-package Vite failure', () => {
    const sh = readRepo('scripts/install.sh', 'utf8')
    expect(sh).toContain('src/web')
    expect(sh).toMatch(/install-nested-package|install_nested_package/)
    expect(sh).toMatch(/build:web/)
  })

  it('install.ps1 installs src/web nested deps', () => {
    const ps = readRepo('scripts/install.ps1', 'utf8')
    expect(ps).toContain('src/web')
    expect(ps).toMatch(/install-nested-package/)
  })

  it('Dockerfile installs src/web before build:web', () => {
    const df = readRepo('Dockerfile', 'utf8')
    expect(df).toMatch(/install-nested-package/)
    expect(df).toMatch(/src\/web/)
  })

  it('build:web uses the nested package script, not a transient bunx vite', () => {
    const pkg = JSON.parse(readRepo('package.json', 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts['build:web']).toMatch(/src\/web/)
    expect(pkg.scripts['build:web']).not.toMatch(/bunx vite/)
  })
})
