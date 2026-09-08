// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../../helpers/test-db'
import { createMcpClient } from '@modules/communication/submodules/mcp-client/client'
import { BROWSER_USE_PYTHON_MCP_REMEDY } from '@shared/playwright-mcp'
import type { EyasDb } from '@core/types'

const silentLogger: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
}

function makeDb(): EyasDb {
  const db = createMemoryDb() as unknown as EyasDb
  db.run(sql`CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    transport TEXT NOT NULL DEFAULT 'stdio',
    url TEXT,
    command TEXT,
    args TEXT,
    env TEXT,
    api_key TEXT,
    headers TEXT,
    auth_type TEXT NOT NULL DEFAULT 'none',
    owned_by TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    auto_start INTEGER NOT NULL DEFAULT 1,
    discovered_tools TEXT,
    discovered_resources TEXT,
    discovered_prompts TEXT,
    status TEXT NOT NULL DEFAULT 'disconnected',
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  return db
}

describe('MCP client — Playwright sidecar policy', () => {
  let client: ReturnType<typeof createMcpClient>

  beforeEach(() => {
    client = createMcpClient({ db: makeDb(), logger: silentLogger })
  })

  it('rejects the Python browser-use MCP on add', async () => {
    await expect(client.add({
      name: 'browser-use',
      transport: 'stdio',
      command: 'uvx',
      args: ['browser-use', '--mcp'],
      enabled: false,
      autoStart: false,
    })).rejects.toThrow(BROWSER_USE_PYTHON_MCP_REMEDY)
  })

  it('strips --no-sandbox, sets telemetry, and isolates Playwright MCP on add', async () => {
    const rec = await client.add({
      name: 'playwright',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest', '--no-sandbox'],
      env: { PLAYWRIGHT_MCP_NO_SANDBOX: '1' },
      enabled: false,
      autoStart: false,
    })
    const args = JSON.parse(rec.args ?? '[]') as string[]
    const env = JSON.parse(rec.env ?? '{}') as Record<string, string>
    expect(args).toEqual(['-y', '@playwright/mcp@latest', '--isolated'])
    expect(args.join(' ')).not.toMatch(/no-sandbox/)
    expect(env.DO_NOT_TRACK).toBe('1')
    expect(env.PLAYWRIGHT_MCP_NO_SANDBOX).toBeUndefined()
  })

  it('strips sandbox flags from a legacy Playwright row on update', async () => {
    const rec = await client.add({
      name: 'playwright',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest', '--isolated'],
      enabled: false,
      autoStart: false,
    })
    const updated = await client.update(rec.id, {
      args: ['-y', '@playwright/mcp@latest', '--no-sandbox'],
    })
    const args = JSON.parse(updated!.args ?? '[]') as string[]
    expect(args).not.toContain('--no-sandbox')
    expect(args).toContain('--isolated')
  })
})
