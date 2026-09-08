// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The local backup provider already blocks `..` traversal, but an ABSOLUTE
// restore target (e.g. /etc) would let an extracted archive overwrite files
// anywhere on the host. Restore must reject absolute targets up front.

import { describe, it, expect, afterEach } from 'vitest'
import { createLocalBackupProvider } from '@modules/disaster-recovery/providers/local.js'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'

describe('local backup provider — restore path safety', () => {
  it('rejects an absolute restore target', async () => {
    const provider = createLocalBackupProvider()
    await expect(provider.restoreBackup('any', '/etc')).rejects.toThrow(/absolute|not allowed|traversal/i)
  })

  it('rejects a traversal restore target', async () => {
    const provider = createLocalBackupProvider()
    await expect(provider.restoreBackup('any', '../../etc')).rejects.toThrow(/traversal|absolute|not allowed/i)
  })
})

describe('local backup provider — full data coverage', () => {
  const root = join(tmpdir(), `eyas-backup-full-${Date.now()}`)
  const prevCwd = process.cwd()

  afterEach(() => {
    process.chdir(prevCwd)
    try {
      rmSync(root, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('packs everything needed for empty-system restore (data + config + .env + version)', async () => {
    mkdirSync(join(root, 'data', 'sqlite'), { recursive: true })
    mkdirSync(join(root, 'data', 'agents', 'a1'), { recursive: true })
    mkdirSync(join(root, 'data', 'vault', 'semantic'), { recursive: true })
    mkdirSync(join(root, 'data', 'voice'), { recursive: true })
    mkdirSync(join(root, 'data', 'backups'), { recursive: true })
    mkdirSync(join(root, 'data', 'tmp'), { recursive: true })
    mkdirSync(join(root, 'config'), { recursive: true })

    writeFileSync(join(root, 'data', 'master.key'), 'deadbeef')
    writeFileSync(join(root, 'data', 'sqlite', 'eyas.db'), 'db')
    writeFileSync(join(root, 'data', 'agents', 'a1', 'IDENTITY.md'), '# agent')
    writeFileSync(join(root, 'data', 'vault', 'semantic', 'n.md'), 'note')
    writeFileSync(join(root, 'data', 'voice', 'x.wav'), 'audio')
    writeFileSync(join(root, 'data', 'backups', 'old.tar.gz'), 'nested-should-not-appear')
    writeFileSync(join(root, 'data', 'tmp', 'scratch'), 'tmp')
    writeFileSync(join(root, 'data', 'eyas.pid'), '1')
    writeFileSync(join(root, 'config', 'local.yaml'), 'server:\n  port: 3100\n')
    writeFileSync(join(root, '.env'), 'ANTHROPIC_API_KEY=sk-test\n')
    writeFileSync(join(root, 'version.json'), JSON.stringify({ version: '0.8.3-beta' }))
    writeFileSync(join(root, 'docker-compose.override.yml'), 'services: {}\n')

    process.chdir(root)
    const provider = createLocalBackupProvider()
    const meta = await provider.createBackup(
      ['data', 'config', '.env', 'docker-compose.override.yml', 'version.json'],
      '',
    )

    expect(meta.paths).toEqual([
      'data',
      'config',
      '.env',
      'docker-compose.override.yml',
      'version.json',
    ])
    expect(meta.sizeBytes).toBeGreaterThan(0)
    const archive = join(root, 'data', 'backups', meta.filename)
    expect(existsSync(archive)).toBe(true)
    expect(existsSync(`${archive}.json`)).toBe(true)

    const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf-8' })
    expect(listing).toMatch(/data\/master\.key/)
    expect(listing).toMatch(/data\/agents\/a1\/IDENTITY\.md/)
    expect(listing).toMatch(/data\/sqlite\/eyas\.db/)
    expect(listing).toMatch(/data\/voice\/x\.wav/)
    expect(listing).toMatch(/config\/local\.yaml/)
    expect(listing).toMatch(/\.env/)
    expect(listing).toMatch(/version\.json/)
    expect(listing).toMatch(/docker-compose\.override\.yml/)
    expect(listing).not.toMatch(/data\/backups\/old/)
    expect(listing).not.toMatch(/data\/tmp\/scratch/)
    expect(listing).not.toMatch(/data\/eyas\.pid/)

    // Manifest must document empty-system restore
    const manifest = JSON.parse(readFileSync(`${archive}.json`, 'utf-8'))
    expect(manifest.paths).toContain('data')
    expect(manifest.eyasVersion).toBe('0.8.3-beta')
    expect(manifest.restore?.length).toBeGreaterThan(3)
    expect(meta.eyasVersion).toBe('0.8.3-beta')
  })
})
