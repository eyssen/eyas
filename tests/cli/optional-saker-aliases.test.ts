import { describe, it, expect, afterEach } from 'vitest'
import { optionalSakerAliases, type OptionalAlias } from '../../src/web/optional-aliases'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { detectInstallRoot } from '../../src/core/instance'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Rollup/Vite string aliases are prefix matches; regex aliases are exact. */
function resolveWithAliases(id: string, aliases: OptionalAlias[]): string {
  for (const alias of aliases) {
    if (alias.find instanceof RegExp) {
      if (alias.find.test(id)) return id.replace(alias.find, alias.replacement)
      continue
    }
    if (id === alias.find || id.startsWith(`${alias.find}/`)) {
      return alias.replacement + id.slice(alias.find.length)
    }
  }
  return id
}

function stubWeb(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  mkdirSync(join(dir, 'src', 'lib'), { recursive: true })
  writeFileSync(join(dir, 'src', 'lib', 'saker-stub.tsx'), 'export {}')
  writeFileSync(join(dir, 'src', 'lib', 'saker-stub.css'), '')
  return dir
}

describe('optionalSakerAliases', () => {
  it('is empty when @saker/react is resolvable (dev machine / bun link)', () => {
    const web = join(detectInstallRoot(), 'src', 'web')
    const aliases = optionalSakerAliases(web)
    const react = resolveWithAliases('@saker/react', aliases)
    if (aliases.length === 0) {
      expect(react).toBe('@saker/react')
    } else {
      expect(react).toMatch(/saker-stub\.tsx$/)
    }
  })

  it('aliases @saker/* to the stub when the package is absent', () => {
    const dir = stubWeb('eyas-saker-alias-')
    const aliases = optionalSakerAliases(dir)
    const stub = join(dir, 'src', 'lib', 'saker-stub.tsx')
    const stubCss = join(dir, 'src', 'lib', 'saker-stub.css')
    expect(resolveWithAliases('@saker/react', aliases)).toBe(stub)
    expect(resolveWithAliases('@saker/core', aliases)).toBe(stub)
    expect(resolveWithAliases('@saker/ui', aliases)).toBe(stub)
    expect(resolveWithAliases('@saker/ui/styles/editor.css', aliases)).toBe(stubCss)
  })

  it('does not rewrite the editor CSS via a @saker/ui prefix match', () => {
    const dir = stubWeb('eyas-saker-css-')
    const aliases = optionalSakerAliases(dir)
    const resolved = resolveWithAliases('@saker/ui/styles/editor.css', aliases)
    expect(resolved).toMatch(/saker-stub\.css$/)
    expect(resolved).not.toMatch(/saker-stub\.tsx/)
  })

  it('stubs when package.json exists but the entry file does not (failed link leftover)', () => {
    const dir = stubWeb('eyas-saker-leftover-')
    const reactDir = join(dir, 'node_modules', '@saker', 'react')
    mkdirSync(reactDir, { recursive: true })
    writeFileSync(
      join(reactDir, 'package.json'),
      JSON.stringify({ name: '@saker/react', main: './dist/index.js' }) + '\n',
    )
    const aliases = optionalSakerAliases(dir)
    expect(resolveWithAliases('@saker/react', aliases)).toMatch(/saker-stub\.tsx$/)
  })
})
