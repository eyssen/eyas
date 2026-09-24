// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A6 — Grok and Kimi advertise the isolated-completion contract only while
// their isolation is verified, and honour ModelRequest.isolated: no EYAS
// bridge, no gate callback (every request refused), the runner told to run
// isolated. The jail roots and the verifier reach the runner.

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider.js'
import { createKimiCliProvider } from '@modules/model/submodules/kimi-cli/provider.js'
import { createAcpProfile } from '@modules/model/submodules/grok-cli/acp-profiles.js'
import { resetIsolationStatuses, setIsolationStatus } from '@modules/model/cli-runtime/isolation.js'
import { canRunIsolated } from '@modules/model/binding.js'
import type { StreamEvent } from '@modules/model/types.js'

afterEach(() => resetIsolationStatuses())

function capture() {
  const seen: Array<Record<string, any>> = []
  async function* fakeRun(opts: Record<string, any>) {
    seen.push(opts)
    yield { type: 'text', text: 'ok' } satisfies StreamEvent
    return { text: 'ok', inputTokens: 1, outputTokens: 1, stopReason: 'end' as const }
  }
  return { seen, fakeRun }
}

const governance = () => ({
  securityGate: { validateToolCall: () => ({ decision: 'allow' as const, reason: 'ok', riskTier: 'green' as const }) },
})

const factories = {
  'grok-cli': (opts: Record<string, any>) => createGrokCliProvider(opts as any),
  'kimi-cli': (opts: Record<string, any>) => createKimiCliProvider(opts as any),
} as const

for (const id of ['grok-cli', 'kimi-cli'] as const) {
  describe(`${id} — isolated-completion contract`, () => {
    it('is not advertised before verification, is while verified, and is withdrawn after a violation', () => {
      const provider = factories[id]({})
      expect(provider.supportsIsolatedCompletion).toBe(false)
      expect(canRunIsolated(provider)).toBe(false)
      setIsolationStatus(id, { status: 'verified', checks: [], runtime: null })
      expect(provider.supportsIsolatedCompletion).toBe(true)
      expect(canRunIsolated(provider)).toBe(true)
      setIsolationStatus(id, { status: 'violation', checks: [{ check: 'mcpServers', detail: 'x' }], runtime: null })
      expect(provider.supportsIsolatedCompletion).toBe(false)
      setIsolationStatus(id, { status: 'auth-required', checks: [], runtime: null })
      expect(provider.supportsIsolatedCompletion).toBe(false)
    })

    it('an isolated request runs with no bridge, no gate callback and the isolated flag', async () => {
      const { seen, fakeRun } = capture()
      const provider = factories[id]({ runPrompt: fakeRun, getGovernance: governance, mcpBridge: { baseUrl: 'http://127.0.0.1:1' } })
      for await (const _ of provider.stream({ messages: [{ role: 'user', content: 'title this' }], isolated: true })) { /* drain */ }
      expect(seen[0].isolated).toBe(true)
      expect(seen[0].mcpServers).toBeUndefined()
      expect(seen[0].canUseTool).toBeUndefined()
    })

    it('an ordinary request keeps the bridge and the gate (negative control)', async () => {
      const { seen, fakeRun } = capture()
      const provider = factories[id]({ runPrompt: fakeRun, getGovernance: governance, mcpBridge: { baseUrl: 'http://127.0.0.1:1' } })
      for await (const _ of provider.stream({ messages: [{ role: 'user', content: 'hi' }], metadata: { origin: 'interactive' } } as any)) { /* drain */ }
      expect(seen[0].isolated).toBe(false)
      expect(seen[0].mcpServers).toHaveLength(1)
      expect(typeof seen[0].canUseTool).toBe('function')
    })

    it('hands the runner the jail roots (the valid folders and the cwd) and the verifier', async () => {
      const folder = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-acp-roots-')))
      try {
        const { seen, fakeRun } = capture()
        const profile = createAcpProfile(id, { homesDir: '/nonexistent/cli-homes' })
        const provider = factories[id]({ runPrompt: fakeRun, profile })
        for await (const _ of provider.stream({ messages: [{ role: 'user', content: 'x' }], metadata: { workingDirectories: [folder] } } as any)) { /* drain */ }
        expect(seen[0].cwd).toBe(folder)
        expect(seen[0].roots).toEqual([folder])
        expect(seen[0].verifier.providerId).toBe(id)
        expect(typeof seen[0].verifier.preflight).toBe('function')
      } finally {
        rmSync(folder, { recursive: true, force: true })
      }
    })
  })
}
