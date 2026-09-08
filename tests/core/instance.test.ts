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
