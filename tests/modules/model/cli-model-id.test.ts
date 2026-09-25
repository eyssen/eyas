// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 — the model a CLI runs comes from the persisted catalog or the id itself,
// never from a process-local map, and never silently from the CLI's default.

import { describe, it, expect } from 'vitest'
import { CliModelIdError, isRuntimeVerifiedModel, resolveCliModel } from '@modules/model/cli-model-id.js'

const grok = { prefix: 'grok-cli-', defaultId: 'grok-cli-default' }

describe('resolveCliModel', () => {
  it('a persisted realModelId wins over the id (positive)', () => {
    const lookup = (id: string) => (id === 'grok-cli-fast' ? { realModelId: 'grok-4.6-fast-reasoning' } : null)
    expect(resolveCliModel({ ...grok, eyasModelId: 'grok-cli-fast', lookup })).toBe('grok-4.6-fast-reasoning')
  })

  it('without a persisted row the id minus its prefix is the model — a restart changes nothing (MISSED-R1A-M3)', () => {
    expect(resolveCliModel({ ...grok, eyasModelId: 'grok-cli-grok-4.6' })).toBe('grok-4.6')
    expect(resolveCliModel({ ...grok, eyasModelId: 'grok-cli-grok-4.6', lookup: () => null })).toBe('grok-4.6')
  })

  it('a raw CLI model name passes through', () => {
    expect(resolveCliModel({ ...grok, eyasModelId: 'grok-4.7' })).toBe('grok-4.7')
    expect(resolveCliModel({ prefix: 'claude-code-', eyasModelId: 'claude-opus-4-8', field: 'alias' })).toBe('claude-opus-4-8')
    expect(resolveCliModel({ prefix: 'claude-code-', eyasModelId: 'opus[1m]', field: 'alias' })).toBe('opus[1m]')
  })

  it('the default id and no id send no model: the CLI default is chosen, not substituted', () => {
    const lookup = () => ({ realModelId: 'grok-4.6' })
    expect(resolveCliModel({ ...grok, eyasModelId: 'grok-cli-default', lookup })).toBeUndefined()
    expect(resolveCliModel({ ...grok, eyasModelId: undefined })).toBeUndefined()
    expect(resolveCliModel({ ...grok, eyasModelId: '  ' })).toBeUndefined()
  })

  it('Claude Code selects by the persisted alias, not the concrete model', () => {
    const lookup = () => ({ alias: 'opus', realModelId: 'claude-opus-4-8' })
    expect(resolveCliModel({ prefix: 'claude-code-', eyasModelId: 'claude-code-opus', field: 'alias', lookup })).toBe('opus')
  })

  it('a bare prefix names no model and throws; it never falls back to a default (negative)', () => {
    expect(() => resolveCliModel({ ...grok, eyasModelId: 'grok-cli-' })).toThrow(CliModelIdError)
    expect(() => resolveCliModel({ ...grok, eyasModelId: 'grok-cli' })).toThrow(CliModelIdError)
  })

  it('never produces a hard-coded model: an unknown id is sent as itself, not as grok-4.5 (negative)', () => {
    const resolved = resolveCliModel({ ...grok, eyasModelId: 'grok-cli-something-new' })
    expect(resolved).toBe('something-new')
    expect(resolved).not.toBe('grok-4.5')
  })

  it('refuses a name a CLI must not receive, including a persisted one (negative)', () => {
    expect(() => resolveCliModel({ ...grok, eyasModelId: 'grok-cli---dangerous' })).toThrow(CliModelIdError)
    expect(() => resolveCliModel({ ...grok, eyasModelId: 'grok model' })).toThrow(CliModelIdError)
    expect(() => resolveCliModel({ ...grok, eyasModelId: 'grok-cli-x', lookup: () => ({ realModelId: '--help' }) })).toThrow(CliModelIdError)
  })

  it('a throwing lookup counts as "nothing persisted" (negative)', () => {
    const lookup = () => { throw new Error('db locked') }
    expect(resolveCliModel({ ...grok, eyasModelId: 'grok-cli-grok-4.6', lookup })).toBe('grok-4.6')
  })
})

// F5 — a background (auxiliary) call pins a CLI to a model only when the CLI's
// own runtime discovery offered that model.
describe('isRuntimeVerifiedModel', () => {
  const at = '2026-09-23T10:00:00.000Z'
  const catalog = (rows: Array<{ modelId: string; enabled?: boolean; metadata?: Record<string, unknown> | null }>) => ({
    listModels: (providerId: string) => (providerId === 'claude-code' ? rows.map((r) => ({ enabled: true, ...r })) : []),
  })

  it('an enabled row the latest discovery offered is verified (positive)', () => {
    const c = catalog([{ modelId: 'claude-code-haiku', metadata: { alias: 'haiku', realModelId: 'claude-haiku-4-5', discoveredAt: at } }])
    expect(isRuntimeVerifiedModel(c as any, 'claude-code', 'claude-code-haiku')).toBe(true)
  })

  it('a seed row, a missing, switched-off or unknown row, another provider or a failing catalog is not (negative)', () => {
    const c = catalog([
      { modelId: 'claude-code-fable', metadata: { alias: 'fable' } },
      { modelId: 'claude-code-opus', metadata: { discoveredAt: at, missingSince: at } },
      { modelId: 'claude-code-sonnet', enabled: false, metadata: { discoveredAt: at } },
      { modelId: 'claude-code-bare', metadata: null },
    ])
    for (const id of ['claude-code-fable', 'claude-code-opus', 'claude-code-sonnet', 'claude-code-bare', 'claude-code-nope']) {
      expect(isRuntimeVerifiedModel(c as any, 'claude-code', id)).toBe(false)
    }
    expect(isRuntimeVerifiedModel(c as any, 'grok-cli', 'claude-code-haiku')).toBe(false)
    const broken = { listModels: () => { throw new Error('db locked') } }
    expect(isRuntimeVerifiedModel(broken, 'claude-code', 'claude-code-haiku')).toBe(false)
  })
})
