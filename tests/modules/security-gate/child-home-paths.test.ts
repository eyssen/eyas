// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B2 × A5/A10 — a CLI EYAS runs in its own HOME (<dataDir>/cli-homes/<id>)
// resolves `~` and `$HOME` there, two levels under the data dir. The gate
// judges such input under that HOME as well as the operator's, so
// `~/../../vault`, `$HOME/../../sqlite/eyas.db` and another provider's home
// stay a hard deny on the ACP permission path (Grok, Kimi).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'node:path'
import { createDeterministicGate } from '@modules/security-gate/deterministic-gate'
import { DEFAULT_CONFIG } from '@modules/security-gate/types'
import { createAcpCanUseTool } from '@modules/model/submodules/grok-cli/acp-governance'
import { installPathPolicy, resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture'

let fx: SovereigntyFixture
let grokHome: string
beforeAll(() => {
  fx = createSovereigntyFixture()
  installPathPolicy(fx.policy)
  grokHome = join(fx.dataDir, 'cli-homes', 'grok-cli')
})
afterAll(() => {
  resetPathPolicyForTests()
  fx.cleanup()
})

const ESCAPES = [
  ['the EYAS vault', 'cat ~/../../vault/semantic/fact.md', /EYAS data directory \(vault\)/],
  ['the database folder', 'sqlite3 $HOME/../../sqlite/eyas.db .dump', /EYAS data directory \(sqlite\)/],
  ['another provider\'s home', 'cat ${HOME}/../../cli-homes/kimi-cli/.kimi/credentials/kimi-code.json', /EYAS-owned CLI home/],
] as const

describe('path policy — `~`/`$HOME` under a child HOME', () => {
  it.each(ESCAPES)('(−) %s through the child home is a violation', (_label, command) => {
    expect(fx.policy.evaluateToolInput('Bash', { command }, { workingDirectories: [fx.ownWorkspace], homeDir: grokHome })).not.toBeNull()
  })

  it('(−) without the child home the same text escapes (why the gate needs it)', () => {
    expect(fx.policy.evaluateToolInput('Bash', { command: 'cat ~/../../vault/semantic/fact.md' }, { workingDirectories: [fx.ownWorkspace] })).toBeNull()
  })

  it('(−) the operator-home reading still counts when a child home is given', () => {
    const hit = fx.policy.evaluateToolInput('Read', { file_path: '~/.claude/projects/x/memory/MEMORY.md' }, { homeDir: grokHome })
    expect(hit?.kind).toBe('foreign-memory')
  })

  it('(+) a relative path in the conversation\'s own workspace stays fine', () => {
    expect(fx.policy.evaluateToolInput('Bash', { command: 'cat out.md' }, { workingDirectories: [fx.ownWorkspace], homeDir: grokHome })).toBeNull()
  })

  it('(+) a relative child home is ignored (only an absolute HOME is trusted)', () => {
    expect(fx.policy.evaluateToolInput('Bash', { command: 'cat ~/../../vault/x' }, { homeDir: 'cli-homes/grok-cli' })).toBeNull()
  })
})

describe('ACP permission path — the gate sees the child home', () => {
  const gate = createDeterministicGate({ ...DEFAULT_CONFIG })
  const canUseTool = (homeDir?: string) => createAcpCanUseTool({
    validateToolCall: (name, input, ctx) => gate.check(name, input, ctx),
    autonomous: false,
    ctx: { conversationId: 'conv-1', workingDirectories: [fx.ownWorkspace], ...(homeDir ? { homeDir } : {}) },
  }, new AbortController().signal)

  it.each(ESCAPES)('(−) %s is a hard deny with the memory-path reason', async (_label, command, reason) => {
    const verdict = await canUseTool(grokHome)('Bash', { command })
    expect(verdict.behavior).toBe('deny')
    expect((verdict as { message: string }).message).toMatch(reason)
  })

  it('(+) a green read in the own workspace is allowed with the child home set', async () => {
    const verdict = await canUseTool(grokHome)('Read', { file_path: fx.ownFile })
    expect(verdict.behavior).toBe('allow')
  })
})
