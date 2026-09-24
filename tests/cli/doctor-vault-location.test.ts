// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// `eyas doctor` reports where the memory vault is and whether notes are still
// sitting in the legacy <home>/data/vault beside a moved data dir.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkVaultLocation } from '../../src/cli/commands/doctor'

let root: string
let home: string

function note(dir: string, rel: string): void {
  mkdirSync(join(dir, rel, '..'), { recursive: true })
  writeFileSync(join(dir, rel), 'note', 'utf-8')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eyas-doctor-vault-'))
  home = join(root, 'home')
  mkdirSync(home, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('checkVaultLocation', () => {
  it('is ok with the default data dir, even when the vault has notes', async () => {
    const vaultDir = join(home, 'data', 'vault')
    note(vaultDir, 'semantic/a.md')
    const result = await checkVaultLocation({ home, vaultDir })
    expect(result).toMatchObject({ name: 'Vault', status: 'ok' })
    expect(result.message).toContain(vaultDir)
  })

  it('is ok when the data dir moved and no legacy vault is left behind', async () => {
    const result = await checkVaultLocation({ home, vaultDir: join(root, 'volume', 'vault') })
    expect(result.status).toBe('ok')
  })

  it('warns that legacy notes will be copied when the moved vault is still empty', async () => {
    note(join(home, 'data', 'vault'), 'semantic/a.md')
    const vaultDir = join(root, 'volume', 'vault')
    const result = await checkVaultLocation({ home, vaultDir })
    expect(result.status).toBe('warn')
    expect(result.message).toMatch(/copied there on the next start/)
    // Read-only: doctor never performs the copy itself.
    expect(existsSync(vaultDir)).toBe(false)
  })

  it('warns with a remedy when both the legacy and the moved vault hold notes', async () => {
    note(join(home, 'data', 'vault'), 'semantic/a.md')
    const vaultDir = join(root, 'volume', 'vault')
    note(vaultDir, 'semantic/b.md')
    const result = await checkVaultLocation({ home, vaultDir })
    expect(result.status).toBe('warn')
    expect(result.message).toMatch(/is not used/)
    expect(result.message).toMatch(/Remedy/)
  })
})
