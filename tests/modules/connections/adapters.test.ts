// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createConnectionsTables } from '@modules/connections/schema'
import { createConnectionsService } from '@modules/connections/service'
import { testConnection } from '@modules/connections/adapters'
import type { EyasDb } from '@core/types'

function makeService() {
  const db = createMemoryDb() as unknown as EyasDb
  createConnectionsTables(db)
  return createConnectionsService(db)
}

describe('connection adapters', () => {
  let service: ReturnType<typeof createConnectionsService>

  beforeEach(() => {
    service = makeService()
  })

  it('pending connection cannot be tested', async () => {
    const conn = await service.create({
      name: 'Pending GH',
      systemType: 'github',
      source: 'agent',
      pending: true,
    })
    const result = await testConnection(service, conn, {})
    expect(result.ok).toBe(false)
    expect(result.status).toBe('pending')
  })

  it('playwright-mcp doctor fail-closes without Node/npx', async () => {
    const conn = await service.create({
      name: 'Playwright MCP',
      systemType: 'playwright-mcp',
      config: { mcpServerName: 'playwright' },
      source: 'user',
    })
    const result = await testConnection(service, conn, {
      cliRunner: {
        which: async () => null,
        run: async () => ({ code: 1, stdout: '', stderr: '' }),
      },
      mcpClient: {
        get: () => ({ id: 'srv-pw', name: 'playwright', status: 'connected', command: 'npx', args: ['-y', '@playwright/mcp@latest'] }),
        list: () => [{ id: 'srv-pw', name: 'playwright', status: 'connected', command: 'npx', args: ['-y', '@playwright/mcp@latest'] }],
      },
      chromiumDeps: { env: {}, exists: () => false },
    })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/Node\.js|npx/i)
  })

  it('playwright-mcp doctor fail-closes on --no-sandbox even if MCP is connected', async () => {
    const conn = await service.create({
      name: 'Playwright MCP',
      systemType: 'playwright-mcp',
      config: { mcpServerName: 'playwright' },
      source: 'user',
    })
    const result = await testConnection(service, conn, {
      cliRunner: {
        which: async (bin) => (bin === 'node' || bin === 'npx' ? `/usr/bin/${bin}` : null),
        run: async () => ({ code: 0, stdout: 'v22.0.0', stderr: '' }),
      },
      mcpClient: {
        get: () => null,
        list: () => [{
          id: 'srv-pw',
          name: 'playwright',
          status: 'connected',
          command: 'npx',
          args: ['-y', '@playwright/mcp@latest', '--no-sandbox'],
        }],
      },
      chromiumDeps: { env: {}, exists: () => false },
    })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/no-sandbox/i)
  })

  it('playwright-mcp rejects the Python browser-use MCP', async () => {
    const conn = await service.create({
      name: 'Playwright MCP',
      systemType: 'playwright-mcp',
      config: { mcpServerName: 'playwright' },
      source: 'user',
    })
    const result = await testConnection(service, conn, {
      cliRunner: {
        which: async (bin) => (bin === 'node' || bin === 'npx' ? `/usr/bin/${bin}` : null),
        run: async () => ({ code: 0, stdout: 'v22.0.0', stderr: '' }),
      },
      mcpClient: {
        get: () => null,
        list: () => [{
          id: 'srv-bu',
          name: 'playwright',
          status: 'connected',
          command: 'uvx',
          args: ['browser-use', '--mcp'],
        }],
      },
      chromiumDeps: { env: {}, exists: () => false },
    })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/retry_with_browser_use_agent|LLM API key/i)
  })

  it('playwright-mcp Test is connected when doctor is green and MCP is up', async () => {
    const conn = await service.create({
      name: 'Playwright MCP',
      systemType: 'playwright-mcp',
      config: { mcpServerName: 'playwright' },
      source: 'user',
    })
    const result = await testConnection(service, conn, {
      cliRunner: {
        which: async (bin) => (bin === 'node' || bin === 'npx' ? `/usr/bin/${bin}` : null),
        run: async () => ({ code: 0, stdout: 'v22.0.0', stderr: '' }),
      },
      mcpClient: {
        get: () => null,
        list: () => [{
          id: 'srv-pw',
          name: 'playwright',
          status: 'connected',
          command: 'npx',
          args: ['-y', '@playwright/mcp@latest', '--isolated'],
        }],
      },
      chromiumDeps: { env: {}, exists: () => false },
    })
    expect(result.ok).toBe(true)
    expect(result.status).toBe('connected')
  })

  it('chrome-devtools-mcp doctor fail-closes without Node/npx', async () => {
    const conn = await service.create({
      name: 'Chrome DevTools MCP',
      systemType: 'chrome-devtools-mcp',
      config: { mcpServerName: 'chrome-devtools' },
      source: 'user',
    })
    const result = await testConnection(service, conn, {
      cliRunner: {
        which: async () => null,
        run: async () => ({ code: 1, stdout: '', stderr: '' }),
      },
      mcpClient: {
        get: () => ({
          id: 'srv-cd',
          name: 'chrome-devtools',
          status: 'connected',
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest'],
        }),
        list: () => [{
          id: 'srv-cd',
          name: 'chrome-devtools',
          status: 'connected',
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest'],
        }],
      },
      chromiumDeps: { env: {}, exists: () => false },
    })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/Node\.js|npx/i)
  })

  it('chrome-devtools-mcp doctor fail-closes on --autoConnect even if MCP is connected', async () => {
    const conn = await service.create({
      name: 'Chrome DevTools MCP',
      systemType: 'chrome-devtools-mcp',
      config: { mcpServerName: 'chrome-devtools' },
      source: 'user',
    })
    const result = await testConnection(service, conn, {
      cliRunner: {
        which: async (bin) => (bin === 'node' || bin === 'npx' ? `/usr/bin/${bin}` : null),
        run: async () => ({ code: 0, stdout: 'v22.0.0', stderr: '' }),
      },
      mcpClient: {
        get: () => null,
        list: () => [{
          id: 'srv-cd',
          name: 'chrome-devtools',
          status: 'connected',
          command: 'npx',
          args: ['-y', 'chrome-devtools-mcp@latest', '--autoConnect'],
        }],
      },
      chromiumDeps: { env: {}, exists: () => false },
    })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/autoConnect|daily Chrome/i)
  })

  it('chrome-devtools-mcp Test is connected when doctor is green and MCP is up', async () => {
    const conn = await service.create({
      name: 'Chrome DevTools MCP',
      systemType: 'chrome-devtools-mcp',
      config: { mcpServerName: 'chrome-devtools' },
      source: 'user',
    })
    const result = await testConnection(service, conn, {
      cliRunner: {
        which: async (bin) => (bin === 'node' || bin === 'npx' ? `/usr/bin/${bin}` : null),
        run: async () => ({ code: 0, stdout: 'v22.0.0', stderr: '' }),
      },
      mcpClient: {
        get: () => null,
        list: () => [{
          id: 'srv-cd',
          name: 'chrome-devtools',
          status: 'connected',
          command: 'npx',
          args: [
            '-y',
            'chrome-devtools-mcp@latest',
            '--isolated',
            '--no-usage-statistics',
            '--categoryExperimentalWebmcp=true',
          ],
        }],
      },
      chromiumDeps: { env: {}, exists: () => false },
    })
    expect(result.ok).toBe(true)
    expect(result.status).toBe('connected')
  })

  it('agent-browser doctor fail-closes without the CLI binary', async () => {
    const conn = await service.create({
      name: 'Agent Browser',
      systemType: 'agent-browser',
      config: { mcpServerName: 'agent-browser' },
      source: 'user',
    })
    const result = await testConnection(service, conn, {
      cliRunner: {
        which: async () => null,
        run: async () => ({ code: 1, stdout: '', stderr: '' }),
      },
      mcpClient: {
        get: () => ({ id: 'srv-ab', name: 'agent-browser', status: 'connected', command: 'agent-browser', args: ['mcp', '--tools', 'core,state'] }),
        list: () => [{ id: 'srv-ab', name: 'agent-browser', status: 'connected', command: 'agent-browser', args: ['mcp', '--tools', 'core,state'] }],
      },
    })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/EYAS_AGENT_BROWSER_BIN|agent-browser install/i)
  })

  it('mcp adapter reports connected when mcp client matches', async () => {
    const conn = await service.create({
      name: 'Filesystem MCP',
      systemType: 'mcp',
      config: { mcpServerId: 'srv-1' },
      source: 'user',
    })
    const result = await testConnection(service, conn, {
      mcpClient: {
        get: (id) => id === 'srv-1'
          ? { id: 'srv-1', name: 'filesystem', status: 'connected' }
          : null,
        list: () => [{ id: 'srv-1', name: 'filesystem', status: 'connected' }],
      },
    })
    expect(result.ok).toBe(true)
    expect(result.status).toBe('connected')
    expect(service.get(conn.id)!.status).toBe('connected')
  })

  it('github adapter uses fetch and bearer token', async () => {
    const secrets = {
      store: new Map<string, string>(),
      async get(name: string, scope: string) {
        return this.store.get(`${scope}:${name}`) ?? null
      },
      async set(name: string, scope: string, value: string) {
        this.store.set(`${scope}:${name}`, value)
      },
    }
    const conn = await service.create({
      name: 'GH',
      systemType: 'github',
      secrets: { token: 'ghp_test' },
      source: 'user',
    }, { secrets })

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ login: 'eyssen' }),
    })) as any

    const result = await testConnection(service, conn, { secrets, fetchImpl })
    expect(result.ok).toBe(true)
    expect(result.message).toContain('eyssen')
    expect(fetchImpl).toHaveBeenCalled()
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toContain('/user')
    expect(init.headers.Authorization).toBe('Bearer ghp_test')
  })
})
