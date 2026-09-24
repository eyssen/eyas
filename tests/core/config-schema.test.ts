// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { configSchema } from '@core/config/schema'
import { loadConfig, loadResolvedConfig } from '@core/config/loader'

describe('security config — memory outside EYAS', () => {
  it('defaults to no extra stores and the auto sandbox', () => {
    const parsed = configSchema.parse({})
    expect(parsed.security.foreignMemoryPaths).toEqual([])
    expect(parsed.security.cliSandbox).toBe('auto')
    expect(parsed.security.approvalTtlHours).toBe(72)
  })

  it('accepts extra stores and the required sandbox', () => {
    const parsed = configSchema.parse({
      security: { foreignMemoryPaths: ['/srv/notes', '~/journal'], cliSandbox: 'required' },
    })
    expect(parsed.security.foreignMemoryPaths).toEqual(['/srv/notes', '~/journal'])
    expect(parsed.security.cliSandbox).toBe('required')
  })

  it("rejects cliSandbox 'off' — there is no off switch", () => {
    expect(configSchema.safeParse({ security: { cliSandbox: 'off' } }).success).toBe(false)
  })

  it('an unknown cliSandbox value in local.yaml is a configuration error: the config does not load', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eyas-cfg-sandbox-'))
    try {
      const configPath = join(dir, 'default.yaml')
      const localConfigPath = join(dir, 'local.yaml')
      writeFileSync(configPath, 'security:\n  cliSandbox: auto\n')
      // (+) a known value loads
      writeFileSync(localConfigPath, 'security:\n  cliSandbox: required\n')
      expect(loadResolvedConfig({ configPath, localConfigPath, applyEnv: false }).security?.cliSandbox).toBe('required')
      // (−) an unknown one stops the load, naming the setting — it is never read as 'auto'
      for (const value of ['off', 'sandbox', 'Required']) {
        writeFileSync(localConfigPath, `security:\n  cliSandbox: ${value}\n`)
        expect(() => loadResolvedConfig({ configPath, localConfigPath, applyEnv: false })).toThrow(/Invalid config: security\.cliSandbox/)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects an empty-string path and a non-array', () => {
    expect(configSchema.safeParse({ security: { foreignMemoryPaths: [''] } }).success).toBe(false)
    expect(configSchema.safeParse({ security: { foreignMemoryPaths: '/srv/notes' } }).success).toBe(false)
  })

  it('config/default.yaml documents exactly the schema defaults', () => {
    const shipped = loadConfig('config/default.yaml')
    const defaults = configSchema.parse({})
    expect(shipped.security?.foreignMemoryPaths).toEqual(defaults.security.foreignMemoryPaths)
    expect(shipped.security?.cliSandbox).toBe(defaults.security.cliSandbox)
  })
})

describe('model config — CLI turn timeouts (G8)', () => {
  it('defaults: 10 minutes idle, 20 minutes while a tool runs', () => {
    const parsed = configSchema.parse({})
    expect(parsed.model.cli).toEqual({ idleTimeoutMs: 600_000, toolTimeoutMs: 1_200_000 })
    // A partial model block still gets both defaults, and pricing keeps its own.
    const partial = configSchema.parse({ model: { cli: { idleTimeoutMs: 120_000 } } })
    expect(partial.model.cli).toEqual({ idleTimeoutMs: 120_000, toolTimeoutMs: 1_200_000 })
    expect(partial.model.pricing).toEqual({})
  })

  it('rejects a negative, zero or fractional timeout', () => {
    expect(configSchema.safeParse({ model: { cli: { idleTimeoutMs: -1 } } }).success).toBe(false)
    expect(configSchema.safeParse({ model: { cli: { toolTimeoutMs: 0 } } }).success).toBe(false)
    expect(configSchema.safeParse({ model: { cli: { idleTimeoutMs: 1.5 } } }).success).toBe(false)
    expect(configSchema.safeParse({ model: { cli: { toolTimeoutMs: '20m' } } }).success).toBe(false)
  })

  it('config/default.yaml documents exactly the schema defaults', () => {
    const shipped = loadConfig('config/default.yaml') as { model?: { cli?: unknown } }
    expect(shipped.model?.cli).toEqual(configSchema.parse({}).model.cli)
  })
})
