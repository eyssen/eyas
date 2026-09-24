// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B5 — the Grok provider runs a turn with tools under its kernel sandbox
// profile: GROK_SANDBOX=eyas-<hash> (and GROK_SANDBOX_AUTO_ALLOW_BASH=false)
// on the spawn only, the profile in its GROK_HOME's sandbox.toml while the
// session lives. Without a sandbox, 'auto' runs with a one-time notice and
// 'required' refuses before anything is spawned. Driven through the real
// provider and the fake ACP agent over stdio.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { createGrokCliProvider } from '@modules/model/submodules/grok-cli/provider.js'
import { GROK_SANDBOX_FILE, resetGrokSandboxProfilesForTests } from '@modules/model/submodules/grok-cli/sandbox-profile.js'
import { resetCliSandboxForTests, type CliSandboxDeps } from '@modules/model/cli-runtime/sandbox/index.js'
import { clearAcpPreflightCache } from '@modules/model/submodules/grok-cli/acp-verify.js'
import { resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import { installPathPolicy, resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy.js'
import type { ModelRequest, StreamEvent } from '@modules/model/types.js'
import { fakeAcpProfile, readFakeAcpLog } from '../../../helpers/fake-acp.js'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../../helpers/memory-sovereignty-fixture'

const parseToml = (text: string): any => (globalThis as any).Bun.TOML.parse(text)

const AVAILABLE: CliSandboxDeps = { mode: () => 'auto', host: { platform: 'darwin' } }
const NONE_AUTO: CliSandboxDeps = { mode: () => 'auto', host: { platform: 'linux', which: () => null } }
const NONE_REQUIRED: CliSandboxDeps = { mode: () => 'required', host: { platform: 'linux', which: () => null } }

let fx: SovereigntyFixture
let homesDir: string

beforeEach(() => {
  fx = createSovereigntyFixture()
  fx.stubInstanceEnv()
  installPathPolicy(fx.policy)
  homesDir = join(fx.dataDir, 'cli-homes')
  mkdirSync(fx.ownWorkspace, { recursive: true })
})

afterEach(() => {
  resetCliSandboxForTests()
  resetGrokSandboxProfilesForTests()
  resetPathPolicyForTests()
  clearAcpPreflightCache()
  resetIsolationStatuses()
  fx.cleanup()
})

async function collect(stream: AsyncIterable<StreamEvent>): Promise<{ events: StreamEvent[]; error?: unknown }> {
  const events: StreamEvent[] = []
  try {
    for await (const e of stream) events.push(e)
    return { events }
  } catch (error) {
    return { events, error }
  }
}

function provider(sandbox: CliSandboxDeps, log: string) {
  const profile = fakeAcpProfile({ homesDir, dir: fx.root, log })
  return { profile, provider: createGrokCliProvider({ profile, sandbox }) }
}

const request = (extra: Partial<ModelRequest> = {}): ModelRequest => ({
  messages: [{ role: 'user', content: 'hi' }],
  metadata: { conversationId: 'conv-1', origin: 'interactive' },
  ...extra,
})

describe.skipIf(process.platform === 'win32')('grok-cli provider — kernel file sandbox', () => {
  it('a turn with tools spawns under the eyas-<hash> profile, which denies foreign memory and EYAS data', async () => {
    const log = join(fx.root, 'grok-available.log')
    const { profile, provider: p } = provider(AVAILABLE, log)
    // The vault is registered knowledge of the policy once it met it.
    fx.policy.classify(fx.vaultNote)

    let during: any = null
    const events: StreamEvent[] = []
    for await (const e of p.stream(request())) {
      events.push(e)
      if (!during && existsSync(join(profile.configDir, GROK_SANDBOX_FILE))) {
        during = parseToml(readFileSync(join(profile.configDir, GROK_SANDBOX_FILE), 'utf8'))
      }
    }
    expect(events.some((e) => e.type === 'done')).toBe(true)
    expect(events.some((e) => e.type === 'notice')).toBe(false)

    const { start, inspects } = readFakeAcpLog(log)
    expect(start.env.GROK_SANDBOX).toMatch(/^eyas-[0-9a-f]{16}$/)
    expect(start.env.GROK_SANDBOX_AUTO_ALLOW_BASH).toBe('false')
    expect(start.env.GROK_HOME).toBe(realpathSync(profile.configDir))
    // Only the turn's spawn selects the sandbox; the preflight inspect does not.
    expect(inspects.length).toBeGreaterThan(0)
    for (const i of inspects) expect(i.env).not.toHaveProperty('GROK_SANDBOX')

    const name = start.env.GROK_SANDBOX
    const prof = during.profiles[name]
    expect(prof.extends).toBe('workspace')
    const denied = (path: string) => (prof.deny as string[]).some((d) => realpathSync(path) === d || realpathSync(path).startsWith(`${d}/`) || path === d || path.startsWith(`${d}/`))
    expect(denied(fx.claudeMemory)).toBe(true)
    expect(denied(fx.vaultNote)).toBe(true)
    expect(denied(fx.eyasVaultNote)).toBe(true)
    expect(denied(fx.otherFile)).toBe(true)
    // Its own CLI HOME and this conversation's workspace stay usable.
    expect(denied(join(profile.configDir, 'config.toml'))).toBe(false)
    expect(denied(fx.ownFile)).toBe(false)
    expect(prof.read_write).toContain(profile.home)

    // The session is over: its profile left the file.
    const after = parseToml(readFileSync(join(profile.configDir, GROK_SANDBOX_FILE), 'utf8'))
    expect(after.profiles?.[name]).toBeUndefined()
  })

  it("'auto' without a sandbox: runs unsandboxed and says so once per conversation", async () => {
    const log1 = join(fx.root, 'grok-auto-1.log')
    const first = await collect(provider(NONE_AUTO, log1).provider.stream(request()))
    expect(first.error).toBeUndefined()
    expect(first.events[0]).toEqual({ type: 'notice', code: 'cliSandboxUnavailable', params: { provider: 'Grok CLI', reason: 'no-bwrap' } })
    expect(readFakeAcpLog(log1).start.env).not.toHaveProperty('GROK_SANDBOX')

    const log2 = join(fx.root, 'grok-auto-2.log')
    const second = await collect(provider(NONE_AUTO, log2).provider.stream(request()))
    expect(second.events.some((e) => e.type === 'notice')).toBe(false)
    expect(second.events.some((e) => e.type === 'done')).toBe(true)
  })

  it("'required' without a sandbox: refused with cliSandboxUnavailable before anything is spawned", async () => {
    const log = join(fx.root, 'grok-required.log')
    const { error, events } = await collect(provider(NONE_REQUIRED, log).provider.stream(request()))
    expect(error).toMatchObject({ kind: 'isolation', code: 'cliSandboxUnavailable', params: { provider: 'grok-cli', reason: 'no-bwrap' } })
    expect(events.some((e) => e.type === 'error')).toBe(true)
    const { start, inspects } = readFakeAcpLog(log)
    expect(start.argv).toEqual([])
    expect(inspects).toEqual([])
  })

  it('negative: an isolated completion runs no tool, so it neither selects a sandbox nor is refused without one', async () => {
    const log = join(fx.root, 'grok-isolated.log')
    const { error, events } = await collect(provider(NONE_REQUIRED, log).provider.stream(request({ isolated: true })))
    expect(error).toBeUndefined()
    expect(events.some((e) => e.type === 'notice')).toBe(false)
    expect(readFakeAcpLog(log).start.env).not.toHaveProperty('GROK_SANDBOX')

    const log2 = join(fx.root, 'grok-isolated-available.log')
    await collect(provider(AVAILABLE, log2).provider.stream(request({ isolated: true })))
    expect(readFakeAcpLog(log2).start.env).not.toHaveProperty('GROK_SANDBOX')
  })
})
