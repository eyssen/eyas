// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dedicatedReadOnlyCommand } from '@modules/security-gate/read-only-command'
import { createDeterministicGate } from '@modules/security-gate/deterministic-gate'
import { DEFAULT_CONFIG } from '@modules/security-gate/types'
import { createPermissionBridge } from '@modules/model/permission-bridge'
import { createToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor, type AuthorizationDeps, type ExecutorSecurityGate } from '@modules/tools/tool-executor'
import type { ToolAbility, ToolActor, ToolContext, ToolImplementation } from '@modules/tools/types'

/**
 * Item 5 — low-friction read-path.
 *
 * Dedicated read-only tools (git_status / git_diff / read_file / grep / glob)
 * already sit on the green list. A coding conversation still stalls because
 * CLI providers send the same work through Bash / run_command (red + approval).
 * When the argv is exactly a dedicated-tool equivalent, the gate must allow
 * it as green with no click. Arbitrary shell, write-git, and metachar stay red.
 *
 * Fixtures are command strings only — no host paths.
 */

describe('dedicatedReadOnlyCommand', () => {
  it('matches git status (string and argv forms)', () => {
    expect(dedicatedReadOnlyCommand({ command: 'git status' })).toBe('git_status')
    expect(dedicatedReadOnlyCommand({ command: 'git', args: ['status'] })).toBe('git_status')
    expect(dedicatedReadOnlyCommand({ command: 'git status --short --branch' })).toBe('git_status')
    expect(dedicatedReadOnlyCommand({ command: 'git', args: ['status', '-sb'] })).toBe('git_status')
  })

  it('matches git diff including staged / base / relative pathspec', () => {
    expect(dedicatedReadOnlyCommand({ command: 'git diff' })).toBe('git_diff')
    expect(dedicatedReadOnlyCommand({ command: 'git diff --cached' })).toBe('git_diff')
    expect(dedicatedReadOnlyCommand({ command: 'git diff --staged --stat' })).toBe('git_diff')
    expect(dedicatedReadOnlyCommand({ command: 'git', args: ['diff', 'HEAD~1'] })).toBe('git_diff')
    expect(dedicatedReadOnlyCommand({ command: 'git diff -- src/alpha.ts' })).toBe('git_diff')
  })

  it('does not match write-git or an arbitrary program', () => {
    expect(dedicatedReadOnlyCommand({ command: 'git add src/alpha.ts' })).toBeNull()
    expect(dedicatedReadOnlyCommand({ command: 'git commit -m hi' })).toBeNull()
    expect(dedicatedReadOnlyCommand({ command: 'git push' })).toBeNull()
    expect(dedicatedReadOnlyCommand({ command: 'git reset --hard' })).toBeNull()
    expect(dedicatedReadOnlyCommand({ command: 'ls' })).toBeNull()
    expect(dedicatedReadOnlyCommand({ command: 'echo', args: ['ok'] })).toBeNull()
  })

  it('refuses shell metacharacters, expansion, and git global options', () => {
    expect(dedicatedReadOnlyCommand({ command: 'git status; rm -rf /tmp/bravo' })).toBeNull()
    expect(dedicatedReadOnlyCommand({ command: 'git diff | cat' })).toBeNull()
    expect(dedicatedReadOnlyCommand({ command: 'git status $(id)' })).toBeNull()
    expect(dedicatedReadOnlyCommand({ command: 'git status && git push' })).toBeNull()
    expect(dedicatedReadOnlyCommand({ command: 'git -C /tmp status' })).toBeNull()
    expect(dedicatedReadOnlyCommand({ command: 'git --git-dir=/tmp/alpha.git status' })).toBeNull()
    expect(dedicatedReadOnlyCommand({ command: 'git diff --no-index a b' })).toBeNull()
    expect(dedicatedReadOnlyCommand({ command: 'git diff /etc/passwd' })).toBeNull()
    expect(dedicatedReadOnlyCommand({ command: 'git diff ../bravo' })).toBeNull()
  })
})

describe('deterministic gate — green read-path', () => {
  const gate = createDeterministicGate(DEFAULT_CONFIG)

  it('allows dedicated read-only tools without escalation', () => {
    for (const name of ['git_status', 'git_diff', 'read_file', 'grep', 'glob']) {
      const result = gate.check(name, {})
      expect(result.decision, name).toBe('allow')
      expect(result.riskTier, name).toBe('green')
    }
  })

  it('allows Bash / run_command when the argv is git status or git diff', () => {
    for (const [tool, input] of [
      ['Bash', { command: 'git status --short' }],
      ['run_command', { command: 'git', args: ['status'] }],
      ['Bash', { command: 'git diff --stat' }],
      ['run_command', { command: 'git diff --cached' }],
    ] as const) {
      const result = gate.check(tool, input)
      expect(result.decision, `${tool} ${JSON.stringify(input)}`).toBe('allow')
      expect(result.riskTier, `${tool} ${JSON.stringify(input)}`).toBe('green')
    }
  })

  it('still escalates an arbitrary shell as red', () => {
    for (const [tool, input] of [
      ['Bash', { command: 'ls' }],
      ['run_command', { command: 'echo', args: ['hello'] }],
      ['Bash', { command: 'git commit -m wip' }],
    ] as const) {
      const result = gate.check(tool, input)
      expect(result.decision, `${tool} ${JSON.stringify(input)}`).toBe('escalate')
      expect(result.riskTier, `${tool} ${JSON.stringify(input)}`).toBe('red')
    }
  })

  it('does not green-path a metachar-bearing git status', () => {
    const result = gate.check('Bash', { command: 'git status; echo pwned' })
    expect(result.decision).not.toBe('allow')
    expect(result.riskTier).not.toBe('green')
  })
})

describe('permission bridge — interactive coding read-path', () => {
  const opts = { toolUseID: 'tu1', signal: new AbortController().signal }

  it('allows Bash git status without enqueueing an approval', async () => {
    const gate = createDeterministicGate(DEFAULT_CONFIG)
    const createApproval = vi.fn()
    const bridge = createPermissionBridge({
      validateToolCall: (name, input) => gate.check(name, input),
      autonomy: {
        categoryForTool: () => 'data_delete',
        resolve: () => ({ level: 1, locked: true, maxLevel: 1 }),
        createApproval,
      },
      ctx: { conversationId: 'c1', agentId: 'a1' },
    })
    const r = await bridge('Bash', { command: 'git status --short --branch' }, opts)
    expect(r).toMatchObject({ behavior: 'allow' })
    expect(createApproval).not.toHaveBeenCalled()
  })

  it('denies an arbitrary Bash command and enqueues approval', async () => {
    const gate = createDeterministicGate(DEFAULT_CONFIG)
    const createApproval = vi.fn()
    const bridge = createPermissionBridge({
      validateToolCall: (name, input) => gate.check(name, input),
      autonomy: {
        categoryForTool: () => 'data_delete',
        resolve: () => ({ level: 1, locked: true, maxLevel: 1 }),
        createApproval,
      },
      ctx: { conversationId: 'c1', agentId: 'a1' },
    })
    const r = await bridge('Bash', { command: 'ls' }, opts)
    expect(r.behavior).toBe('deny')
    expect(createApproval).toHaveBeenCalledTimes(1)
  })
})

describe('executor — green gate-allow skips requiresApproval', () => {
  const silentLogger: any = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => silentLogger,
  }
  const allowAll: ToolAbility = { can: () => true }
  const actor: ToolActor = { kind: 'agent', role: 'agent', ability: allowAll }

  function ctx(): ToolContext {
    return { conversationId: 'c1', userId: 'u1', agentId: 'a1', logger: silentLogger, actor } as ToolContext
  }

  function authWith(gate: ExecutorSecurityGate): AuthorizationDeps {
    return { getSecurityGate: () => gate, getAbilityForRole: () => allowAll }
  }

  let execute: ReturnType<typeof vi.fn>

  beforeEach(() => {
    execute = vi.fn(async () => ({ ok: true }))
  })

  it('runs run_command when the gate allowed the invocation as green', async () => {
    const tool: ToolImplementation = {
      name: 'run_command',
      description: '',
      category: 'shell',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {},
      execute,
    }
    const registry = createToolRegistry()
    registry.register(tool)
    const gate = {
      validateToolCall: vi.fn(async () => ({
        decision: 'allow' as const,
        reason: 'Read-only command matching a dedicated green tool',
        riskTier: 'green' as const,
      })),
    } as unknown as ExecutorSecurityGate
    const exec = createToolExecutor(registry, { authorization: authWith(gate) })

    const r = await exec.execute('run_command', { command: 'git', args: ['status'] }, ctx())
    expect(r.success).toBe(true)
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('still denies run_command when the gate escalates an arbitrary shell', async () => {
    const tool: ToolImplementation = {
      name: 'run_command',
      description: '',
      category: 'shell',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {},
      execute,
    }
    const registry = createToolRegistry()
    registry.register(tool)
    const createApproval = vi.fn()
    const gate = {
      validateToolCall: vi.fn(async () => ({
        decision: 'escalate' as const,
        reason: 'red tier — escalating to LLM judge',
        riskTier: 'red' as const,
      })),
      autonomyPolicy: {
        categoryForTool: () => 'data_delete',
        resolve: () => ({ level: 1, locked: true }),
        createApproval,
      },
    } as unknown as ExecutorSecurityGate
    const exec = createToolExecutor(registry, { authorization: authWith(gate) })

    const r = await exec.execute('run_command', { command: 'ls' }, ctx())
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('DENIED')
    expect(r.error).toMatch(/approval required/i)
    expect(execute).not.toHaveBeenCalled()
    expect(createApproval).toHaveBeenCalledTimes(1)
  })
})
