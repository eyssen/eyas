import { describe, it, expect, afterEach } from 'vitest'
import { resolveInstance, resolveWebDistDir, detectInstallRoot } from '@core/instance'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('resolveInstance', () => {
  const prevHome = process.env.EYAS_HOME
  const prevPort = process.env.EYAS_PORT
  const prevConfig = process.env.EYAS_CONFIG
  const home = join(tmpdir(), `eyas-instance-${Date.now()}`)

  afterEach(() => {
    if (prevHome === undefined) delete process.env.EYAS_HOME
    else process.env.EYAS_HOME = prevHome
    if (prevPort === undefined) delete process.env.EYAS_PORT
    else process.env.EYAS_PORT = prevPort
    if (prevConfig === undefined) delete process.env.EYAS_CONFIG
    else process.env.EYAS_CONFIG = prevConfig
    try { rmSync(home, { recursive: true }) } catch {}
  })

  it('uses EYAS_HOME for data/pid and creates dirs', () => {
    process.env.EYAS_HOME = home
    const inst = resolveInstance({ ensureDirs: true })
    expect(inst.home).toBe(home)
    expect(inst.dataDir).toBe(join(home, 'data'))
    expect(inst.pidFile).toBe(join(home, 'data', 'eyas.pid'))
    expect(existsSync(join(home, 'data', 'sqlite'))).toBe(true)
    expect(existsSync(join(home, 'config'))).toBe(true)
  })

  it('exposes the workspaces root and the CLI homes dir', () => {
    const prevWs = process.env.EYAS_WORKSPACES_DIR
    process.env.EYAS_HOME = home
    try {
      delete process.env.EYAS_WORKSPACES_DIR
      const plain = resolveInstance({ ensureDirs: false })
      expect(plain.cliHomesDir).toBe(join(home, 'data', 'cli-homes'))
      // tmpdir has no git work tree above it: the workspaces stay in the data dir.
      expect(plain.workspacesDir).toBe(join(home, 'data', 'workspaces'))

      process.env.EYAS_WORKSPACES_DIR = join(home, 'elsewhere')
      expect(resolveInstance({ ensureDirs: false }).workspacesDir).toBe(join(home, 'elsewhere'))
    } finally {
      if (prevWs === undefined) delete process.env.EYAS_WORKSPACES_DIR
      else process.env.EYAS_WORKSPACES_DIR = prevWs
    }
  })

  it('keeps the vault in the data dir, so it follows EYAS_DATA_DIR', () => {
    const prevData = process.env.EYAS_DATA_DIR
    process.env.EYAS_HOME = home
    try {
      delete process.env.EYAS_DATA_DIR
      expect(resolveInstance({ ensureDirs: false }).vaultDir).toBe(join(home, 'data', 'vault'))

      process.env.EYAS_DATA_DIR = join(home, 'volume')
      const moved = resolveInstance({ ensureDirs: false })
      expect(moved.vaultDir).toBe(join(home, 'volume', 'vault'))
      // Never the old home-relative folder once the data dir has moved.
      expect(moved.vaultDir).not.toBe(join(home, 'data', 'vault'))
    } finally {
      if (prevData === undefined) delete process.env.EYAS_DATA_DIR
      else process.env.EYAS_DATA_DIR = prevData
    }
  })

  it('moves the workspaces root out of a data dir inside a git checkout, and never creates it', () => {
    const prevWs = process.env.EYAS_WORKSPACES_DIR
    process.env.EYAS_HOME = home
    mkdirSync(join(home, '.git'), { recursive: true })
    try {
      delete process.env.EYAS_WORKSPACES_DIR
      const inst = resolveInstance({ ensureDirs: true })
      expect(inst.workspacesDir.startsWith(home)).toBe(false)
      expect(existsSync(inst.workspacesDir)).toBe(false)
    } finally {
      if (prevWs === undefined) delete process.env.EYAS_WORKSPACES_DIR
      else process.env.EYAS_WORKSPACES_DIR = prevWs
    }
  })

  it('picks up $EYAS_HOME/config/local.yaml as overlay when default is install config', () => {
    process.env.EYAS_HOME = home
    mkdirSync(join(home, 'config'), { recursive: true })
    writeFileSync(join(home, 'config', 'local.yaml'), 'server:\n  port: 3200\n')
    const inst = resolveInstance({ ensureDirs: false })
    // primary may be install default.yaml; local should be the home overlay
    expect(inst.localConfigPath).toBe(join(home, 'config', 'local.yaml'))
  })

  it('detectInstallRoot finds this repo', () => {
    const root = detectInstallRoot()
    expect(existsSync(join(root, 'package.json'))).toBe(true)
  })

  it('resolveWebDistDir finds built frontend when present', () => {
    const dir = resolveWebDistDir(detectInstallRoot())
    // May be null if not built in CI; only assert type when present
    if (dir) {
      expect(existsSync(join(dir, 'index.html'))).toBe(true)
    } else {
      expect(dir).toBeNull()
    }
  })
})
