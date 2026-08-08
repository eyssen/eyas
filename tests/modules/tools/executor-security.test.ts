// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { createToolRegistry, type ToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor } from '@modules/tools/tool-executor'
import { createShellTools, runShellFree } from '@modules/tools/builtin/shell-tools'
import type { ToolImplementation, ToolContext } from '@modules/tools/types'

function silentCtx(): ToolContext {
  // Minimal pino-compatible stub
  const logger: any = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => logger,
  }
  return {
    conversationId: 'c1',
    userId: 'u1',
    logger,
  }
}

describe('Tool executor — security hardening (S3)', () => {
  let registry: ToolRegistry

  beforeEach(() => {
    registry = createToolRegistry()
  })

  describe('Zod input-schema enforcement', () => {
    it('rejects input that fails Zod validation with a structured error', async () => {
      const tool: ToolImplementation = {
        name: 'sum',
        description: 'Sum two numbers',
        category: 'custom',
        riskTier: 'green',
        inputSchema: {},
        validator: z.object({ a: z.number(), b: z.number() }),
        execute: async (i) => ({ total: (i.a as number) + (i.b as number) }),
      }
      registry.register(tool)
      const exec = createToolExecutor(registry, { authorization: 'disabled' })

      // Wrong type: b is a string
      const r = await exec.execute('sum', { a: 1, b: 'two' }, silentCtx())
      expect(r.success).toBe(false)
      expect(r.errorCode).toBe('INVALID_INPUT')
      expect(r.issues).toBeDefined()
      expect(r.issues!.length).toBeGreaterThan(0)
      // No exception leaked: we got a structured result, not a throw
      expect(typeof r.error).toBe('string')
    })

    it('accepts valid input and runs the tool', async () => {
      const tool: ToolImplementation = {
        name: 'sum',
        description: '',
        category: 'custom',
        riskTier: 'green',
        inputSchema: {},
        validator: z.object({ a: z.number(), b: z.number() }),
        execute: async (i) => ({ total: (i.a as number) + (i.b as number) }),
      }
      registry.register(tool)
      const exec = createToolExecutor(registry, { authorization: 'disabled' })

      const r = await exec.execute('sum', { a: 2, b: 3 }, silentCtx())
      expect(r.success).toBe(true)
      expect(r.output?.total).toBe(5)
    })

    it('rejects non-object input even when no validator is provided', async () => {
      const tool: ToolImplementation = {
        name: 'echo',
        description: '',
        category: 'custom',
        riskTier: 'green',
        inputSchema: {},
        execute: async (i) => i,
      }
      registry.register(tool)
      const exec = createToolExecutor(registry, { authorization: 'disabled' })

      const r = await exec.execute('echo', 'not an object' as any, silentCtx())
      expect(r.success).toBe(false)
      expect(r.errorCode).toBe('INVALID_INPUT')
    })
  })

  describe('Output size cap', () => {
    it('truncates outputs that exceed the cap and marks them', async () => {
      const big = 'x'.repeat(2_000)
      const tool: ToolImplementation = {
        name: 'big',
        description: '',
        category: 'custom',
        riskTier: 'green',
        inputSchema: {},
        validator: z.object({}).passthrough(),
        execute: async () => ({ payload: big }),
      }
      registry.register(tool)
      const exec = createToolExecutor(registry, { maxOutputBytes: 500, authorization: 'disabled' })

      const r = await exec.execute('big', {}, silentCtx())
      expect(r.success).toBe(true)
      expect(r.output?.__truncated).toBe(true)
      const payload = r.output?.payload as string
      expect(payload.length).toBeLessThan(big.length)
      expect(payload).toContain('[truncated')
    })

    it('leaves small outputs unmodified', async () => {
      const tool: ToolImplementation = {
        name: 'small',
        description: '',
        category: 'custom',
        riskTier: 'green',
        inputSchema: {},
        validator: z.object({}).passthrough(),
        execute: async () => ({ payload: 'tiny' }),
      }
      registry.register(tool)
      const exec = createToolExecutor(registry, { maxOutputBytes: 500, authorization: 'disabled' })

      const r = await exec.execute('small', {}, silentCtx())
      expect(r.success).toBe(true)
      expect(r.output?.__truncated).toBeUndefined()
      expect(r.output?.payload).toBe('tiny')
    })
  })

  describe('Timeout handling', () => {
    it('returns a structured TIMEOUT error when the tool exceeds its timeout', async () => {
      const tool: ToolImplementation = {
        name: 'slow',
        description: '',
        category: 'custom',
        riskTier: 'green',
        inputSchema: {},
        timeoutMs: 50,
        validator: z.object({}).passthrough(),
        execute: async () => {
          await new Promise(r => setTimeout(r, 5_000))
          return { ok: true }
        },
      }
      registry.register(tool)
      const exec = createToolExecutor(registry, { authorization: 'disabled' })

      const r = await exec.execute('slow', {}, silentCtx())
      expect(r.success).toBe(false)
      expect(r.errorCode).toBe('TIMEOUT')
      expect(r.error).toContain('timed out')
    })
  })

  describe('Not-found handling', () => {
    it('returns a structured NOT_FOUND error for unknown tools', async () => {
      const exec = createToolExecutor(registry, { authorization: 'disabled' })
      const r = await exec.execute('nope', {}, silentCtx())
      expect(r.success).toBe(false)
      expect(r.errorCode).toBe('NOT_FOUND')
    })
  })
})

describe('Shell tool — security hardening (S3)', () => {
  const tools = createShellTools(undefined)
  const runCmd = tools.find(t => t.name === 'run_command')!

  it('exposes a Zod validator and sandboxMode=process', () => {
    expect(runCmd.validator).toBeDefined()
    expect(runCmd.sandboxMode).toBe('process')
    expect(runCmd.requiresApproval).toBe(true)
    expect(runCmd.riskTier).toBe('red')
  })

  it('rejects shell-injection attempts in `command` via the deny-list', async () => {
    const r = await runCmd.execute({ command: 'ls ; rm -rf /' }, silentCtx())
    expect(r.refused).toBe(true)
    expect(r.stderr).toContain('shell metacharacter')
  })

  it('rejects shell-metacharacter in args', async () => {
    const r = await runCmd.execute({ command: 'echo', args: ['hello', '; rm -rf /'] }, silentCtx())
    expect(r.refused).toBe(true)
  })

  it('rejects command-substitution ($( ... ))', async () => {
    const r = await runCmd.execute({ command: 'echo $(whoami)' }, silentCtx())
    expect(r.refused).toBe(true)
  })

  it('rejects pipe chaining', async () => {
    const r = await runCmd.execute({ command: 'cat /etc/passwd | head' }, silentCtx())
    expect(r.refused).toBe(true)
  })

  it('rejects backtick substitution', async () => {
    const r = await runCmd.execute({ command: 'echo `id`' }, silentCtx())
    expect(r.refused).toBe(true)
  })

  it('runs a legitimate program with args and captures stdout', async () => {
    const r = await runCmd.execute({ command: 'echo', args: ['hello', 'world'] }, silentCtx())
    expect(r.refused).toBeUndefined()
    expect(r.exitCode).toBe(0)
    expect(String(r.stdout).trim()).toBe('hello world')
  })

  it('kills the child process (and its subprocess tree) on timeout', async () => {
    // Launch a shell that sleeps. Because we invoke `sleep` directly with an
    // args array (no shell interpretation), this is safe. The test verifies
    // that a slow process is terminated within the timeout window.
    const start = Date.now()
    const r = await runShellFree({
      command: 'sleep',
      args: ['30'],
      cwd: process.cwd(),
      timeoutMs: 200,
    })
    const elapsed = Date.now() - start
    expect(r.timedOut).toBe(true)
    // Should exit far before the 30s sleep completes; allow generous slack
    // for CI/macOS SIGKILL grace.
    expect(elapsed).toBeLessThan(5_000)
    expect(r.exitCode).not.toBe(0)
  }, 10_000)

  it('truncates runaway stdout at the per-stream cap', async () => {
    // `yes` produces unbounded output. With a short timeout plus the 1 MiB
    // stream cap, we expect `truncated: true` in the result.
    const r = await runShellFree({
      command: 'yes',
      args: ['x'],
      cwd: process.cwd(),
      timeoutMs: 500,
    })
    expect(r.truncated).toBe(true)
    expect(r.stdout.length).toBeGreaterThan(0)
    // The accumulated string should not exceed ~1 MiB + truncation marker.
    expect(r.stdout.length).toBeLessThan(1024 * 1024 + 1024)
  }, 10_000)

  it('rejects invalid input at the executor layer (Zod)', async () => {
    const registry = createToolRegistry()
    registry.register(runCmd)
    const exec = createToolExecutor(registry, { authorization: 'disabled' })

    // `command` must be a string; pass a number
    const r = await exec.execute('run_command', { command: 123 }, silentCtx())
    expect(r.success).toBe(false)
    expect(r.errorCode).toBe('INVALID_INPUT')
  })
})
