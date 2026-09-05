import { describe, it, expect, afterEach } from 'vitest'
import { configSchema, defaultConfig } from '@core/config/schema'
import { loadConfig } from '@core/config/loader'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Config Schema', () => {
  it('validates a complete config', () => {
    const result = configSchema.safeParse(defaultConfig)
    expect(result.success).toBe(true)
  })

  it('rejects invalid port', () => {
    const result = configSchema.safeParse({
      ...defaultConfig,
      server: { ...defaultConfig.server, port: -1 },
    })
    expect(result.success).toBe(false)
  })

  it('applies defaults for missing fields', () => {
    const result = configSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.server.port).toBe(3100)
      expect(result.data.log.level).toBe('info')
    }
  })

  it('defaults ops.kubectl to disabled and ops.pr to unconfigured', () => {
    const result = configSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.ops.kubectl.enabled).toBe(false)
      expect(result.data.ops.kubectl.kubeconfigPath).toBeNull()
      expect(result.data.ops.kubectl.binary).toBe('kubectl')
      expect(result.data.ops.pr.provider).toBeNull()
      expect(result.data.ops.pr.baseUrl).toBeNull()
      expect(result.data.ops.pr.owner).toBeNull()
      expect(result.data.ops.pr.repo).toBeNull()
      expect(result.data.ops.pr.baseBranch).toBe('main')
    }
  })

  it('accepts an explicit ops config', () => {
    const result = configSchema.safeParse({
      ops: {
        kubectl: { enabled: true, kubeconfigPath: '/etc/kube/config', binary: '/usr/local/bin/kubectl' },
        pr: { provider: 'gitea', baseUrl: 'https://gitea.internal', owner: 'infra', repo: 'gitops', baseBranch: 'develop' },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.ops.kubectl.enabled).toBe(true)
      expect(result.data.ops.pr.provider).toBe('gitea')
      expect(result.data.ops.pr.baseBranch).toBe('develop')
    }
  })

  it('defaults pipelines.ticketToCode to disabled and unconfigured, with the review approval gate on (pauses before pr-open opens a PR)', () => {
    const result = configSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.pipelines.ticketToCode.enabled).toBe(false)
      expect(result.data.pipelines.ticketToCode.prProvider).toBeNull()
      expect(result.data.pipelines.ticketToCode.prBaseUrl).toBeNull()
      expect(result.data.pipelines.ticketToCode.prOwner).toBeNull()
      expect(result.data.pipelines.ticketToCode.prRepo).toBeNull()
      expect(result.data.pipelines.ticketToCode.prBaseBranch).toBe('main')
      expect(result.data.pipelines.ticketToCode.approvalGates).toEqual({ review: true })
    }
  })

  it('defaults proactive.heartbeat to disabled (Task 10 schema fix)', () => {
    const result = configSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.proactive.heartbeat.enabled).toBe(false)
      expect(result.data.proactive.heartbeat.quietHours).toBeUndefined()
    }
  })

  it('does not strip an explicit proactive.heartbeat config (Task 10 regression: was silently dropped)', () => {
    const result = configSchema.safeParse({
      proactive: { heartbeat: { enabled: true, quietHours: { startHour: 22, endHour: 7 } } },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.proactive.heartbeat.enabled).toBe(true)
      expect(result.data.proactive.heartbeat.quietHours).toEqual({ startHour: 22, endHour: 7 })
    }
  })

  it('does not strip an explicit forge config (Task 10 regression: was silently dropped)', () => {
    const result = configSchema.safeParse({
      forge: { autoApproveConfidence: 0.99, maxProposalsPerRun: 3 },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.forge.autoApproveConfidence).toBe(0.99)
      expect(result.data.forge.maxProposalsPerRun).toBe(3)
    }
  })

  it('keeps a memory.capture block instead of stripping it', () => {
    const parsed = configSchema.parse({ memory: { capture: { enabled: false, minUserChars: 80 } } })
    expect(parsed.memory.capture.enabled).toBe(false)
    expect(parsed.memory.capture.minUserChars).toBe(80)
  })

  it('defaults capture to on, because an opt-in reproduces the bug this fixes', () => {
    expect(configSchema.parse({}).memory.capture.enabled).toBe(true)
  })

  it('accepts an explicit pipelines.ticketToCode config', () => {
    const result = configSchema.safeParse({
      pipelines: {
        ticketToCode: {
          enabled: true,
          prProvider: 'github',
          prBaseUrl: null,
          prOwner: 'acme',
          prRepo: 'widgets',
          prBaseBranch: 'develop',
          approvalGates: { review: true, 'pr-open': false },
        },
      },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.pipelines.ticketToCode.enabled).toBe(true)
      expect(result.data.pipelines.ticketToCode.prProvider).toBe('github')
      expect(result.data.pipelines.ticketToCode.prBaseBranch).toBe('develop')
      expect(result.data.pipelines.ticketToCode.approvalGates).toEqual({ review: true, 'pr-open': false })
    }
  })
})

describe('Config Loader', () => {
  const testDir = join(tmpdir(), 'eyas-test-config-' + Date.now())

  it('loads config from YAML file', () => {
    mkdirSync(testDir, { recursive: true })
    const configPath = join(testDir, 'test.yaml')
    writeFileSync(configPath, 'server:\n  port: 4000\nlog:\n  level: debug\n')
    const config = loadConfig(configPath)
    expect(config.server.port).toBe(4000)
    expect(config.log.level).toBe('debug')
    rmSync(testDir, { recursive: true })
  })

  it('returns defaults when file does not exist', () => {
    const config = loadConfig('/nonexistent/path.yaml')
    expect(config.server.port).toBe(3100)
  })
})

describe('loadResolvedConfig + merge + env', () => {
  const testDir = join(tmpdir(), 'eyas-test-resolved-' + Date.now())
  const prevPort = process.env.EYAS_PORT
  const prevHost = process.env.EYAS_HOST

  afterEach(() => {
    if (prevPort === undefined) delete process.env.EYAS_PORT
    else process.env.EYAS_PORT = prevPort
    if (prevHost === undefined) delete process.env.EYAS_HOST
    else process.env.EYAS_HOST = prevHost
    try { rmSync(testDir, { recursive: true }) } catch {}
  })

  it('merges local.yaml over primary', async () => {
    const { loadResolvedConfig } = await import('@core/config/loader')
    mkdirSync(testDir, { recursive: true })
    const primary = join(testDir, 'default.yaml')
    const local = join(testDir, 'local.yaml')
    writeFileSync(primary, 'server:\n  port: 3100\nlog:\n  level: info\n')
    writeFileSync(local, 'server:\n  port: 3200\nlog:\n  level: debug\n')
    const config = loadResolvedConfig({
      configPath: primary,
      localConfigPath: local,
      applyEnv: false,
    })
    expect(config.server.port).toBe(3200)
    expect(config.log.level).toBe('debug')
  })

  it('lets EYAS_PORT override merged files', async () => {
    const { loadResolvedConfig } = await import('@core/config/loader')
    mkdirSync(testDir, { recursive: true })
    const primary = join(testDir, 'default.yaml')
    writeFileSync(primary, 'server:\n  port: 3100\n')
    process.env.EYAS_PORT = '3300'
    const config = loadResolvedConfig({
      configPath: primary,
      applyEnv: true,
    })
    expect(config.server.port).toBe(3300)
  })

  it('resolves relative database path under instance home', async () => {
    const { loadResolvedConfig } = await import('@core/config/loader')
    mkdirSync(testDir, { recursive: true })
    const primary = join(testDir, 'default.yaml')
    writeFileSync(primary, 'server:\n  port: 3100\ndatabase:\n  path: data/sqlite/eyas.db\n')
    const home = join(testDir, 'home')
    const dataDir = join(home, 'data')
    const config = loadResolvedConfig({
      configPath: primary,
      applyEnv: false,
      instance: {
        home,
        dataDir,
        databasePath: join(dataDir, 'sqlite', 'eyas.db'),
      },
    })
    expect(config.database.path).toBe(join(home, 'data/sqlite/eyas.db'))
  })
})

describe('deepMerge', () => {
  it('merges nested objects without wiping siblings', async () => {
    const { deepMerge } = await import('@core/config/merge')
    const out = deepMerge(
      { server: { host: '0.0.0.0', port: 3100 }, log: { level: 'info' } },
      { server: { port: 3200 } },
    )
    expect(out).toEqual({ server: { host: '0.0.0.0', port: 3200 }, log: { level: 'info' } })
  })
})

describe('memory.engine / memory.l0 (plan p1a)', () => {
  const dir = join(tmpdir(), `eyas-config-memory-${Date.now()}`)
  afterEach(() => { try { rmSync(dir, { recursive: true }) } catch {} })

  it('defaults to the legacy engine with L0 capture on and tool results off', () => {
    const result = configSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.memory.engine).toBe('legacy')
      expect(result.data.memory.l0).toEqual({
        enabled: true,
        captureToolResults: false,
        toolResultMaxBytes: 8192,
        idleFlushMinutes: 30,
        chunkTokens: 8000,
        extractInLegacy: true,
      })
    }
  })

  it('keeps YAML-provided keys instead of stripping them (z.object drops unknown keys)', () => {
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'config.yaml')
    writeFileSync(path, [
      'memory:',
      '  engine: v2',
      '  l0:',
      '    captureToolResults: true',
      '    chunkTokens: 4000',
    ].join('\n'))
    const config = loadConfig(path)
    expect(config.memory?.engine).toBe('v2')
    expect(config.memory?.l0).toEqual({
      enabled: true,
      captureToolResults: true,
      toolResultMaxBytes: 8192,
      idleFlushMinutes: 30,
      chunkTokens: 4000,
      extractInLegacy: true,
    })
    // Siblings in the same block keep their defaults.
    expect(config.memory?.reflection.enabled).toBe(false)
  })

  it('rejects an unknown engine and a non-positive byte cap', () => {
    expect(configSchema.safeParse({ memory: { engine: 'v3' } }).success).toBe(false)
    expect(configSchema.safeParse({ memory: { l0: { toolResultMaxBytes: 0 } } }).success).toBe(false)
    expect(configSchema.safeParse({ memory: { l0: { idleFlushMinutes: 1.5 } } }).success).toBe(false)
  })

  it('config/default.yaml documents exactly the schema defaults for memory', () => {
    const shipped = loadConfig('config/default.yaml')
    const defaults = configSchema.parse({})
    expect(shipped.memory?.engine).toBe(defaults.memory.engine)
    expect(shipped.memory?.l0).toEqual(defaults.memory.l0)
  })
})
