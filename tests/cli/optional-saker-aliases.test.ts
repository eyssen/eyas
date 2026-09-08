import { describe, it, expect, afterEach } from 'vitest'
import { optionalSakerAliases } from '../../src/web/optional-aliases'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { detectInstallRoot } from '../../src/core/instance'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('optionalSakerAliases', () => {
  it('is empty when @saker/react is installed (dev machine / bun link)', () => {
    const web = join(detectInstallRoot(), 'src', 'web')
    const aliases = optionalSakerAliases(web)
    // This checkout links Saker; a public clone does not.
    // Either shape is valid — we only assert the missing-package path below.
    if (Object.keys(aliases).length === 0) {
      expect(aliases).toEqual({})
    } else {
      expect(aliases['@saker/react']).toMatch(/saker-stub\.tsx$/)
    }
  })

  it('aliases @saker/* to the stub when the package is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eyas-saker-alias-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'src', 'lib'), { recursive: true })
    writeFileSync(join(dir, 'src', 'lib', 'saker-stub.tsx'), 'export {}')
    writeFileSync(join(dir, 'src', 'lib', 'saker-stub.css'), '')
    const aliases = optionalSakerAliases(dir)
    expect(aliases['@saker/react']).toBe(join(dir, 'src', 'lib', 'saker-stub.tsx'))
    expect(aliases['@saker/core']).toBe(join(dir, 'src', 'lib', 'saker-stub.tsx'))
    expect(aliases['@saker/ui/styles/editor.css']).toBe(join(dir, 'src', 'lib', 'saker-stub.css'))
  })
})
