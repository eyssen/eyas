// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import type { CliRunner } from '@modules/studio/cli-runner'
import {
  assertAllowedMcpBrowserSidecar,
  BROWSER_USE_PYTHON_MCP_REMEDY,
  doctorPlaywrightMcp,
  isBrowserUsePythonMcp,
  isPlaywrightMcp,
  parseNodeMajor,
  sanitizeMcpStdioLaunch,
  stripSandboxArgs,
} from '@shared/playwright-mcp'

function runner(opts: {
  node?: string | null
  npx?: string | null
  nodeVersion?: string
}): CliRunner {
  return {
    async which(bin) {
      if (bin === 'node') return opts.node === undefined ? '/usr/bin/node' : opts.node
      if (bin === 'npx') return opts.npx === undefined ? '/usr/bin/npx' : opts.npx
      return null
    },
    async run() {
      return { code: 0, stdout: opts.nodeVersion ?? 'v22.11.0', stderr: '' }
    },
  }
}

describe('Playwright MCP policy', () => {
  it('recognizes Microsoft @playwright/mcp', () => {
    expect(isPlaywrightMcp({ command: 'npx', args: ['-y', '@playwright/mcp@latest'] })).toBe(true)
    expect(isPlaywrightMcp({ name: 'playwright', command: 'npx', args: ['-y'] })).toBe(true)
    expect(isPlaywrightMcp({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] })).toBe(false)
  })

  it('detects the Python browser-use MCP and not Playwright', () => {
    expect(isBrowserUsePythonMcp({ command: 'uvx', args: ['browser-use', '--mcp'] })).toBe(true)
    expect(isBrowserUsePythonMcp({ command: 'python', args: ['-m', 'browser_use'] })).toBe(true)
    expect(isBrowserUsePythonMcp({ command: 'browser-use', args: ['--mcp'] })).toBe(true)
    expect(isBrowserUsePythonMcp({ command: 'npx', args: ['-y', '@playwright/mcp'] })).toBe(false)
    expect(isBrowserUsePythonMcp({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] })).toBe(false)
  })

  it('rejects Python browser-use MCP on assert', () => {
    expect(() => assertAllowedMcpBrowserSidecar({ command: 'uvx', args: ['browser-use', '--mcp'] })).toThrow(
      BROWSER_USE_PYTHON_MCP_REMEDY,
    )
  })

  it('rewrites agent-browser --tools all to core,state and strips chat', () => {
    const out = sanitizeMcpStdioLaunch({
      command: 'agent-browser',
      args: ['mcp', '--tools', 'debug', 'chat'],
    })
    expect(out.args).toContain('mcp')
    expect(out.args).toContain('core,state')
    expect(out.args).not.toContain('debug')
    expect(out.args).not.toContain('chat')
    expect(out.env.DO_NOT_TRACK).toBe('1')
    expect(out.env.AI_GATEWAY_API_KEY).toBe('')
  })

  it('rejects the mcp-agent-browser npm wrapper', () => {
    expect(() => sanitizeMcpStdioLaunch({
      command: 'npx',
      args: ['-y', 'mcp-agent-browser'],
    })).toThrow(/mcp-agent-browser/)
  })

  it('strips --no-sandbox and injects telemetry + isolated for Playwright MCP', () => {
    const out = sanitizeMcpStdioLaunch({
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest', '--no-sandbox', '--disable-setuid-sandbox'],
      env: { PLAYWRIGHT_MCP_NO_SANDBOX: '1', KEEP: 'yes' },
    })
    expect(out.args).toEqual(['-y', '@playwright/mcp@latest', '--isolated'])
    expect(out.env.DO_NOT_TRACK).toBe('1')
    expect(out.env.KEEP).toBe('yes')
    expect(out.env.PLAYWRIGHT_MCP_NO_SANDBOX).toBeUndefined()
  })

  it('does not add --isolated when --extension is set', () => {
    const out = sanitizeMcpStdioLaunch({
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest', '--extension'],
    })
    expect(out.args).toContain('--extension')
    expect(out.args).not.toContain('--isolated')
  })

  it('refuses a daily Chrome profile as --user-data-dir', () => {
    expect(() => sanitizeMcpStdioLaunch({
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest', '--user-data-dir', '/Users/x/Library/Application Support/Google/Chrome'],
    })).toThrow(/daily browser profile/)
  })

  it('stripSandboxArgs drops sandbox flags only', () => {
    expect(stripSandboxArgs(['--headless', '--no-sandbox', '--isolated'])).toEqual(['--headless', '--isolated'])
  })

  it('parseNodeMajor reads v-prefixed versions', () => {
    expect(parseNodeMajor('v22.11.0')).toBe(22)
    expect(parseNodeMajor('18.20.0')).toBe(18)
    expect(parseNodeMajor('nope')).toBeNull()
  })
})

describe('Playwright MCP doctor (fail-closed)', () => {
  it('is missing when Node or npx is absent', async () => {
    const status = await doctorPlaywrightMcp(runner({ node: null, npx: null }), {
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
    })
    expect(status.available).toBe(false)
    expect(status.checks.find((c) => c.id === 'node')?.status).toBe('missing')
    expect(status.checks.find((c) => c.id === 'npx')?.status).toBe('missing')
  })

  it('is missing when Node is too old', async () => {
    const status = await doctorPlaywrightMcp(runner({ nodeVersion: 'v16.20.2' }), {
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
    })
    expect(status.available).toBe(false)
    expect(status.checks.find((c) => c.id === 'node')?.status).toBe('missing')
  })

  it('is missing when --no-sandbox is still in args', async () => {
    const status = await doctorPlaywrightMcp(runner({}), {
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest', '--no-sandbox'],
    })
    expect(status.available).toBe(false)
    expect(status.checks.find((c) => c.id === 'sandbox')?.status).toBe('missing')
  })

  it('is missing for the Python browser-use MCP even if Node is present', async () => {
    const status = await doctorPlaywrightMcp(runner({}), {
      command: 'uvx',
      args: ['browser-use', '--mcp'],
    })
    expect(status.available).toBe(false)
    expect(status.checks.find((c) => c.id === 'python-mcp')?.status).toBe('missing')
  })

  it('is available when Node 18+ and npx are present and args are clean', async () => {
    const status = await doctorPlaywrightMcp(runner({}), {
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest', '--isolated'],
    }, { env: {}, exists: () => false })
    expect(status.checks.find((c) => c.id === 'node')?.status).toBe('ok')
    expect(status.checks.find((c) => c.id === 'npx')?.status).toBe('ok')
    expect(status.checks.find((c) => c.id === 'sandbox')?.status).toBe('ok')
    expect(status.checks.find((c) => c.id === 'python-mcp')?.status).toBe('ok')
    expect(status.available).toBe(true)
  })
})
