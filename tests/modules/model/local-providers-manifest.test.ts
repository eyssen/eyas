// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F9 — Ollama and LM Studio are never assumed to exist: a disabled provider
// is never contacted, an unreachable one is skipped, and discovery (Ollama
// /api/show thinking, LM Studio reasoning info) runs only for an enabled,
// reachable server. Ollama rediscovers on every load; a failed discovery
// leaves the stored rows alone.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { ollamaManifest } from '@modules/model/submodules/ollama/manifest'
import { lmstudioManifest } from '@modules/model/submodules/lmstudio/manifest'
import type { ModuleContext } from '@core/types'

function context(opts: { enabled: boolean; existingRows?: number }) {
  const registered: any[] = []
  const reconciled: any[][] = []
  const upserted: any[][] = []
  const invalidate = vi.fn()
  const noop = () => {}
  const logger = { info: noop, warn: noop, error: noop, debug: noop, child: () => logger } as any
  const ctx = {
    logger,
    providerReload: new Map(),
    providerConfig: {
      ensureProvider: noop,
      getProvider: () => ({ enabled: opts.enabled, settings: {} }),
      listModels: () => Array.from({ length: opts.existingRows ?? 0 }, (_, i) => ({ modelId: `row-${i}` })),
      upsertModels: (_id: string, models: any[]) => upserted.push(models),
      reconcileDiscoveredModels: (_id: string, models: any[]) => {
        reconciled.push(models)
        return { missing: [], restored: [] }
      },
    },
    model: {
      registerProvider: (p: any) => registered.push(p),
      unregisterProvider: noop,
      getProvider: () => registered[0],
    },
    reasoningRegistry: { invalidate, get: vi.fn() },
  } as unknown as ModuleContext
  return { ctx, registered, reconciled, upserted, invalidate }
}

const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body })

/**
 * A fake Ollama: /api/tags lists qwen3:8b, /api/show says it thinks.
 * `listingFails`: the ping (first /api/tags) answers, every later listing fails.
 */
function ollamaFetch(opts: { listingFails?: boolean } = {}) {
  let tagsCalls = 0
  return vi.fn(async (url: string) => {
    if (url.endsWith('/api/tags')) {
      tagsCalls++
      if (opts.listingFails && tagsCalls > 1) return { ok: false, status: 500, json: async () => ({}) }
      return json({ models: [{ name: 'qwen3:8b', size: 1, details: { parameter_size: '8B' } }] })
    }
    if (url.endsWith('/api/show')) return json({ capabilities: ['completion', 'tools', 'thinking'] })
    throw new Error(`unexpected ${url}`)
  })
}

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 5))
}

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('Ollama submodule load', () => {
  it('(−) a disabled provider is never contacted', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as any
    const { ctx, registered } = context({ enabled: false })
    await ollamaManifest.onStart!(ctx)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(registered).toHaveLength(0)
  })

  it('(−) an enabled but unreachable server is skipped: no provider, no discovery, no rows touched', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any
    const { ctx, registered, upserted, reconciled } = context({ enabled: true })
    await ollamaManifest.onStart!(ctx)
    expect(registered).toHaveLength(0)
    expect(upserted).toHaveLength(0)
    expect(reconciled).toHaveLength(0)
  })

  it('(+) a first load seeds the rows from discovery, thinking control included', async () => {
    globalThis.fetch = ollamaFetch() as any
    const { ctx, registered, upserted, invalidate } = context({ enabled: true })
    await ollamaManifest.onStart!(ctx)
    expect(registered).toHaveLength(1)
    expect(upserted).toHaveLength(1)
    expect(upserted[0][0].metadata.reasoning).toMatchObject({ param: 'toggle', levels: ['none', 'high'] })
    expect(invalidate).toHaveBeenCalledWith('ollama')
  })

  it('(+) a later load rediscovers in the background and reconciles', async () => {
    globalThis.fetch = ollamaFetch() as any
    const { ctx, reconciled, upserted, invalidate } = context({ enabled: true, existingRows: 2 })
    await ollamaManifest.onStart!(ctx)
    await until(() => reconciled.length > 0)
    expect(upserted).toHaveLength(0)
    expect(reconciled).toHaveLength(1)
    expect(reconciled[0][0].metadata.reasoning.param).toBe('toggle')
    expect(invalidate).toHaveBeenCalledWith('ollama')
  })

  it('(−) a failed rediscovery leaves the stored rows as they were', async () => {
    globalThis.fetch = ollamaFetch({ listingFails: true }) as any
    const { ctx, registered, reconciled, invalidate } = context({ enabled: true, existingRows: 2 })
    await ollamaManifest.onStart!(ctx)
    await new Promise((r) => setTimeout(r, 30))
    expect(registered).toHaveLength(1)
    expect(reconciled).toHaveLength(0)
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('LM Studio submodule load', () => {
  it('(−) a disabled provider is never contacted', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as any
    const { ctx } = context({ enabled: false })
    await lmstudioManifest.onStart!(ctx)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('(+) a first load seeds from discovery, with the reasoning setting LM Studio reports', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/api/v1/models')) {
        return json({ models: [{ key: 'qwen/qwen3-8b', capabilities: { reasoning: { allowed_options: ['off', 'on'], default: 'on' } } }] })
      }
      if (url.endsWith('/v1/models')) return json({ data: [{ id: 'qwen/qwen3-8b' }] })
      throw new Error(`unexpected ${url}`)
    }) as any
    const { ctx, upserted } = context({ enabled: true })
    await lmstudioManifest.onStart!(ctx)
    expect(upserted).toHaveLength(1)
    expect(upserted[0][0].metadata.runtimeReasoning).toEqual({ options: ['off', 'on'], default: 'on' })
    expect(upserted[0][0].metadata).not.toHaveProperty('reasoning')
  })
})
