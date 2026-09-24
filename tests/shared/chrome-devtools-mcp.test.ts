// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import type { CliRunner } from '@modules/studio/cli-runner'
import {
  CHROME_DEVTOOLS_AUTOCONNECT_REMEDY,
  CHROME_DEVTOOLS_MCP_CATALOG_ARGS,
  doctorChromeDevtoolsMcp,
  extractChromeDevtoolsUserDataDir,
  isChromeDevtoolsMcp,
  sanitizeChromeDevtoolsMcpLaunch,
  stripChromeArgSandbox,
} from '@shared/chrome-devtools-mcp'
import { sanitizeMcpStdioLaunch } from '@shared/playwright-mcp'

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

describe('Chrome DevTools MCP policy', () => {
  it('recognizes Google chrome-devtools-mcp', () => {
    expect(isChromeDevtoolsMcp({ command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'] })).toBe(true)
    expect(isChromeDevtoolsMcp({ name: 'chrome-devtools', command: 'npx', args: ['-y'] })).toBe(true)
    expect(isChromeDevtoolsMcp({ command: 'npx', args: ['-y', '@playwright/mcp'] })).toBe(false)
    expect(isChromeDevtoolsMcp({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] })).toBe(false)
  })

  it('strips --chrome-arg sandbox values', () => {
    expect(stripChromeArgSandbox([
      '-y', 'chrome-devtools-mcp@latest', '--chrome-arg', '--no-sandbox', '--isolated',
    ])).toEqual(['-y', 'chrome-devtools-mcp@latest', '--isolated'])
    expect(stripChromeArgSandbox(['--chrome-arg=--no-sandbox', '--headless'])).toEqual(['--headless'])
  })

  it('sanitizes telemetry, isolated, and WebMCP through the shared MCP sanitizer', () => {
    const out = sanitizeMcpStdioLaunch({
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest', '--no-sandbox', '--chrome-arg=--disable-setuid-sandbox'],
      env: { KEEP: 'yes' },
    })
    expect(out.args).toContain('-y')
    expect(out.args).toContain('chrome-devtools-mcp@latest')
    expect(out.args).toContain('--isolated')
    expect(out.args).toContain('--no-usage-statistics')
    expect(out.args).toContain('--no-performance-crux')
    expect(out.args).toContain('--categoryExperimentalWebmcp=true')
    expect(out.args.join(' ')).not.toMatch(/no-sandbox/)
    expect(out.env.DO_NOT_TRACK).toBe('1')
    expect(out.env.CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS).toBe('1')
    expect(out.env.CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS).toBe('1')
    expect(out.env.KEEP).toBe('yes')
  })

  it('does not add --isolated when --browser-url is set', () => {
    const out = sanitizeChromeDevtoolsMcpLaunch({
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest', '--browser-url=http://127.0.0.1:9222'],
    })
    expect(out.args).toContain('--browser-url=http://127.0.0.1:9222')
    expect(out.args).not.toContain('--isolated')
  })

  it('refuses --autoConnect (daily Chrome)', () => {
    expect(() => sanitizeMcpStdioLaunch({
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest', '--autoConnect'],
    })).toThrow(CHROME_DEVTOOLS_AUTOCONNECT_REMEDY)
  })

  it('refuses a daily Chrome profile as --user-data-dir', () => {
    expect(() => sanitizeMcpStdioLaunch({
      command: 'npx',
      args: [
        '-y', 'chrome-devtools-mcp@latest',
        '--user-data-dir', '/Users/x/Library/Application Support/Google/Chrome',
      ],
    })).toThrow(/daily browser profile/)
  })

  it('extracts camelCase --userDataDir', () => {
    expect(extractChromeDevtoolsUserDataDir(['--userDataDir=/tmp/eyas-chrome'])).toBe('/tmp/eyas-chrome')
  })

  it('catalog args stay isolated, telemetry-off, WebMCP on, no sandbox', () => {
    const joined = CHROME_DEVTOOLS_MCP_CATALOG_ARGS.join(' ')
    expect(joined).toContain('chrome-devtools-mcp@latest')
    expect(joined).toContain('--isolated')
    expect(joined).toContain('--no-usage-statistics')
    expect(joined).toContain('--categoryExperimentalWebmcp=true')
    expect(joined).not.toMatch(/no-sandbox/)
    expect(joined).not.toMatch(/autoConnect|auto-connect/)
  })
})

describe('Chrome DevTools MCP doctor (fail-closed)', () => {
  it('is missing when Node or npx is absent', async () => {
    const status = await doctorChromeDevtoolsMcp(runner({ node: null, npx: null }), {
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest'],
    })
    expect(status.available).toBe(false)
    expect(status.checks.find((c) => c.id === 'node')?.status).toBe('missing')
    expect(status.checks.find((c) => c.id === 'npx')?.status).toBe('missing')
  })

  it('is missing when Node is too old', async () => {
    const status = await doctorChromeDevtoolsMcp(runner({ nodeVersion: 'v16.20.2' }), {
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest'],
    })
    expect(status.available).toBe(false)
    expect(status.checks.find((c) => c.id === 'node')?.status).toBe('missing')
  })

  it('is missing when --no-sandbox is still in args', async () => {
    const status = await doctorChromeDevtoolsMcp(runner({}), {
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest', '--no-sandbox'],
    })
    expect(status.available).toBe(false)
    expect(status.checks.find((c) => c.id === 'sandbox')?.status).toBe('missing')
  })

  it('is missing when --chrome-arg disables the sandbox', async () => {
    const status = await doctorChromeDevtoolsMcp(runner({}), {
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest', '--chrome-arg=--no-sandbox'],
    })
    expect(status.available).toBe(false)
    expect(status.checks.find((c) => c.id === 'sandbox')?.status).toBe('missing')
  })

  it('is missing when --autoConnect is set even if Node is present', async () => {
    const status = await doctorChromeDevtoolsMcp(runner({}), {
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest', '--autoConnect'],
    })
    expect(status.available).toBe(false)
    expect(status.checks.find((c) => c.id === 'autoconnect')?.status).toBe('missing')
  })

  it('warns when WebMCP category is off (does not fail-closed)', async () => {
    const status = await doctorChromeDevtoolsMcp(runner({}), {
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest', '--isolated'],
    }, { env: {}, exists: () => false })
    expect(status.checks.find((c) => c.id === 'webmcp')?.status).toBe('warn')
    expect(status.available).toBe(true)
  })

  it('is available when Node 18+ and npx are present and args are clean', async () => {
    const status = await doctorChromeDevtoolsMcp(runner({}), {
      command: 'npx',
      args: [...CHROME_DEVTOOLS_MCP_CATALOG_ARGS],
    }, { env: {}, exists: () => false })
    expect(status.checks.find((c) => c.id === 'node')?.status).toBe('ok')
    expect(status.checks.find((c) => c.id === 'npx')?.status).toBe('ok')
    expect(status.checks.find((c) => c.id === 'sandbox')?.status).toBe('ok')
    expect(status.checks.find((c) => c.id === 'autoconnect')?.status).toBe('ok')
    expect(status.checks.find((c) => c.id === 'webmcp')?.status).toBe('ok')
    expect(status.available).toBe(true)
  })
})
