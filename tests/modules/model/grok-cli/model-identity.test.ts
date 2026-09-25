// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// F2 — Grok model identity: discovery records which model each row runs, a
// failed discovery is never mistaken for "no models", and a turn runs the
// model its row names even after a restart (MISSED-R1A-M3), never a
// hard-coded default.

import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider.js'
import { createAcpProfile } from '@modules/model/submodules/grok-cli/acp-profiles.js'
import { clearAcpPreflightCache } from '@modules/model/submodules/grok-cli/acp-verify.js'
import { resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import type { StreamEvent } from '@modules/model/types.js'
import { fakeAcpProfile, type FakeAcpProfileOptions } from '../../../helpers/fake-acp.js'

// Discovery runs over ACP (F10): initialize + session/new + model switches,
// never a prompt. See probe.test.ts for the probe itself.
describe.skipIf(process.platform === 'win32')('Grok CLI discovery (fetchModels)', () => {
  let root: string
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    resetIsolationStatuses()
  })

  function providerWith(fake: Partial<FakeAcpProfileOptions> = {}) {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-grok-models-')))
    clearAcpPreflightCache()
    const scratch = join(root, 'scratch')
    mkdirSync(scratch)
    const profile = fakeAcpProfile({ homesDir: join(root, 'cli-homes'), dir: root, log: join(root, 'grok.log'), models: 'recorded', ...fake })
    async function* fakeRun(opts: { onPromptCapabilities?: (c: { image: boolean }) => void }) {
      opts.onPromptCapabilities?.({ image: true })
      return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
    }
    return createGrokCliProvider({ profile, runPrompt: fakeRun as any, probeCwd: () => scratch })
  }

  it('lists a default row plus one row per model, each naming its concrete model (positive)', async () => {
    const provider = providerWith()
    const models = await provider.fetchModels!()
    expect(models.map((m) => m.id)).toEqual(['grok-cli-default', 'grok-cli-grok-4.7', 'grok-cli-grok-4.6', 'grok-cli-grok-4.5', 'grok-cli-grok-code-fast'])
    expect(models.map((m) => (m.metadata as any).realModelId)).toEqual(['grok-4.7', 'grok-4.7', 'grok-4.6', 'grok-4.5', 'grok-code-fast'])
    expect((models[0].metadata as any).alias).toBe('default')
    expect(models.every((m) => typeof (m.metadata as any).discoveredAt === 'string')).toBe(true)
  })

  it('a refresh keeps the Vision flag the CLI reported', async () => {
    const provider = providerWith()
    for await (const _ of provider.stream({ messages: [{ role: 'user', content: 'hi' }] })) { /* drain */ }
    expect((await provider.fetchModels!()).every((m) => m.supportsImages === true)).toBe(true)
  })

  it('a CLI whose check cannot run rejects, never answering with the static list (negative)', async () => {
    await expect(providerWith({ inspect: 'fail' }).fetchModels!()).rejects.toThrow()
  })

  it('a session that would approve on its own rejects (negative)', async () => {
    await expect(providerWith({ sessionMode: 'yolo' }).fetchModels!()).rejects.toThrow()
  })
})

describe('Grok CLI turn model', () => {
  function capture(lookup?: (id: string) => { realModelId?: string } | null) {
    const seen: Array<Record<string, unknown>> = []
    async function* fakeRun(opts: Record<string, unknown>) {
      seen.push(opts)
      return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
    }
    const profile = createAcpProfile('grok-cli', { homesDir: '/nonexistent/cli-homes' })
    return { seen, provider: createGrokCliProvider({ profile, runPrompt: fakeRun as any, lookupModelMetadata: lookup }) }
  }
  async function drain(gen: AsyncIterable<StreamEvent>) { for await (const _ of gen) { /* consume */ } }

  it('a fresh instance runs a refreshed model by its persisted realModelId (MISSED-R1A-M3 regression)', async () => {
    const { seen, provider } = capture((id) => (id === 'grok-cli-grok-4.6' ? { realModelId: 'grok-4.6' } : null))
    await drain(provider.stream({ messages: [{ role: 'user', content: 'x' }], model: 'grok-cli-grok-4.6' }))
    expect(seen[0].model).toBe('grok-4.6')
  })

  it('without the catalog the id still names the model', async () => {
    const { seen, provider } = capture()
    await drain(provider.stream({ messages: [{ role: 'user', content: 'x' }], model: 'grok-cli-grok-4.7' }))
    expect(seen[0].model).toBe('grok-4.7')
  })

  it('the default row and no model send no --model (the CLI default is chosen, not assumed)', async () => {
    const { seen, provider } = capture(() => ({ realModelId: 'grok-4.6' }))
    await drain(provider.stream({ messages: [{ role: 'user', content: 'x' }], model: 'grok-cli-default' }))
    await drain(provider.stream({ messages: [{ role: 'user', content: 'x' }] }))
    expect(seen.map((o) => o.model)).toEqual([undefined, undefined])
  })

  it('an id naming no model fails loudly before anything runs, never as grok-4.5 (negative)', async () => {
    const { seen, provider } = capture()
    await expect(drain(provider.stream({ messages: [{ role: 'user', content: 'x' }], model: 'grok-cli-' }))).rejects.toThrow(/names no model/)
    expect(seen).toHaveLength(0)
  })
})
