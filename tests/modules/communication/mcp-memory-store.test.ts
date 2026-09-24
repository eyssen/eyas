// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B7: MCP servers that keep memory outside EYAS (catalog memory/qdrant/
// obsidian, known memory packages, anything pointed at another tool's memory
// or EYAS's data folder) are refused on install/add/update, never spawned,
// and their tools never reach any model. Ordinary servers are unaffected.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { errorHandler } from '@core/http/middleware/error-handler'
import type { EyasDb } from '@core/types'
import {
  createPathPolicy,
  installPathPolicy,
  resetPathPolicyForTests,
  workAreaRootsOf,
} from '@shared/memory-sovereignty/path-policy'

// Every stdio launch goes through this fake: a spawn is observable, never real.
const spawned = vi.hoisted(() => [] as Array<{ command: string; args?: string[] }>)
vi.mock('@modules/communication/submodules/mcp-client/transports/stdio.js', () => ({
  createStdioTransport: (opts: { command: string; args?: string[] }) => {
    spawned.push({ command: opts.command, args: opts.args })
    let connected = false
    return {
      get connected() { return connected },
      sessionId: null,
      async connect() { connected = true },
      async disconnect() { connected = false },
      async send(req: { method: string; id: number | string }) {
        if (req.method === 'tools/list') {
          return { jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'read_graph', description: 'read', inputSchema: {} }] } }
        }
        return { jsonrpc: '2.0', id: req.id, result: {} }
      },
    }
  },
}))

import { createMcpClient } from '@modules/communication/submodules/mcp-client/client'
import { createMcpRoutes } from '@modules/communication/submodules/mcp-client/routes'
import { mcpServerRegistry } from '@modules/communication/submodules/mcp-client/registry'
import {
  MEMORY_STORE_BLOCKED,
  McpMemoryStoreBlockedError,
  isForeignMemoryServer,
  mcpMemoryStoreVerdict,
} from '@modules/communication/submodules/mcp-client/memory-store'

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
}

let root: string
let home: string
let dataDir: string
let vault: string
let project: string
let basicMemoryProject: string

function mk(...parts: string[]): string {
  const dir = join(...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'eyas-mcp-memory-store-'))
  home = mk(root, 'home')
  mk(home, '.claude', 'projects')
  dataDir = mk(root, 'eyas', 'data')
  mk(dataDir, 'vault', 'semantic')
  mk(dataDir, 'workspaces')
  vault = mk(root, 'notes', 'MyVault')
  mk(vault, '.obsidian')
  project = mk(root, 'projects', 'website')
  basicMemoryProject = mk(root, 'projects', 'basic-memory')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  vi.stubEnv('HOME', home)
  const workspacesRoot = join(dataDir, 'workspaces')
  installPathPolicy(createPathPolicy({
    homeDir: home,
    env: {},
    dataDir,
    databasePath: join(dataDir, 'sqlite', 'eyas.db'),
    extraForeignPaths: [],
    workspacesRoot,
    workAreaRoots: workAreaRootsOf({ dataDir, workspacesDir: workspacesRoot }),
    providerHomes: [join(dataDir, 'cli-homes')],
    obsidianRegistryPaths: [],
  }))
  spawned.length = 0
})

afterEach(() => {
  resetPathPolicyForTests()
  vi.unstubAllEnvs()
})

function catalog(id: string) {
  const entry = mcpServerRegistry.find((e) => e.id === id)
  if (!entry) throw new Error(`catalog entry ${id} missing`)
  return { name: entry.id, command: entry.command, args: entry.args, env: entry.env, url: entry.url }
}

// ── Classifier ─────────────────────────────────────────────────────────────

describe('mcpMemoryStoreVerdict — blocked', () => {
  it('flags the catalog memory, qdrant and obsidian entries (and keeps them out of "bundled")', () => {
    for (const id of ['memory', 'qdrant', 'obsidian']) {
      const entry = mcpServerRegistry.find((e) => e.id === id)!
      expect(entry.memoryStore, id).toBe(true)
      expect(entry.tier, id).toBe('manual')
      expect(mcpMemoryStoreVerdict({ catalogId: id })?.match).toBe('catalog')
      // The same launch added by hand is caught by its package name.
      expect(mcpMemoryStoreVerdict(catalog(id)), id).not.toBeNull()
    }
  })

  it('matches the MCP reference memory server by package name, version suffix ignored', () => {
    const v = mcpMemoryStoreVerdict({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory@2025.4.25'] })
    expect(v).toMatchObject({ match: 'package', ruleId: 'mcp-memory', field: 'args' })
  })

  it('matches mcpvault by package, by binary and when run from node_modules', () => {
    expect(mcpMemoryStoreVerdict({ command: 'npx', args: ['@bitbonsai/mcpvault@latest', project] }))
      .toMatchObject({ match: 'package', ruleId: 'mcpvault' })
    expect(mcpMemoryStoreVerdict({ command: '/usr/local/bin/mcpvault', args: [] }))
      .toMatchObject({ match: 'package', ruleId: 'mcpvault', field: 'command' })
    expect(mcpMemoryStoreVerdict({ command: 'node', args: ['/opt/x/node_modules/@bitbonsai/mcpvault/dist/server.js'] }))
      .toMatchObject({ match: 'package', ruleId: 'mcpvault' })
  })

  it('matches the Qdrant memory server added by hand (catalog package)', () => {
    expect(mcpMemoryStoreVerdict({ command: 'uvx', args: ['mcp-server-qdrant'] }))
      .toMatchObject({ match: 'catalog', ruleId: 'qdrant' })
  })

  it('blocks a filesystem server pointed at an Obsidian vault (argument, --flag=value, env, file: URL)', () => {
    const fs = '@modelcontextprotocol/server-filesystem'
    expect(mcpMemoryStoreVerdict({ command: 'npx', args: ['-y', fs, join(vault, 'Daily')] }))
      .toMatchObject({ match: 'path', kind: 'foreign-memory', ruleId: 'obsidian', field: 'args' })
    expect(mcpMemoryStoreVerdict({ command: 'some-notes-server', args: [`--root=${vault}`] }))
      .toMatchObject({ match: 'path', kind: 'foreign-memory' })
    expect(mcpMemoryStoreVerdict({ command: 'some-notes-server', args: [], env: { NOTES_DIR: vault } }))
      .toMatchObject({ match: 'path', field: 'env.NOTES_DIR' })
    expect(mcpMemoryStoreVerdict({ url: pathToFileURL(vault).href }))
      .toMatchObject({ match: 'path', field: 'url' })
  })

  it("blocks a server pointed at EYAS's own vault or at another tool's memory (~ expanded)", () => {
    const fs = '@modelcontextprotocol/server-filesystem'
    expect(mcpMemoryStoreVerdict({ command: 'npx', args: ['-y', fs, join(dataDir, 'vault')] }))
      .toMatchObject({ match: 'path', kind: 'eyas-data' })
    expect(mcpMemoryStoreVerdict({ command: 'npx', args: ['-y', fs, '~/.claude/projects'] }))
      .toMatchObject({ match: 'path', kind: 'foreign-memory', ruleId: 'claude' })
  })

  it('reads stored rows (args/env as JSON strings)', () => {
    expect(isForeignMemoryServer({ command: 'npx', args: JSON.stringify(['-y', 'mcp-obsidian']) })).toBe(true)
    expect(isForeignMemoryServer({ command: 'x', args: '[]', env: JSON.stringify({ VAULT: vault }) })).toBe(true)
  })
})

describe('mcpMemoryStoreVerdict — allowed', () => {
  it('git, fetch, github and the other non-memory catalog entries pass', () => {
    for (const id of ['git', 'fetch', 'github', 'playwright', 'sequential-thinking', 'context7']) {
      expect(mcpMemoryStoreVerdict(catalog(id)), id).toBeNull()
    }
  })

  it('a filesystem server pointed at an ordinary project folder passes', () => {
    expect(isForeignMemoryServer({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', project] })).toBe(false)
  })

  it('a display name containing "memory" is never matched', () => {
    expect(mcpMemoryStoreVerdict({ name: 'memory', command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'] })).toBeNull()
    expect(mcpMemoryStoreVerdict({ name: 'team-memory-notes', command: 'uvx', args: ['mcp-server-fetch'] })).toBeNull()
  })

  it('a project folder that shares a package name is not a package match', () => {
    expect(mcpMemoryStoreVerdict({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', basicMemoryProject] })).toBeNull()
  })

  it('a server installed under <dataDir>/mcp-servers (config/mcp.yaml) passes; <dataDir>/vault is still refused (negative)', () => {
    const cwd = join(dataDir, '..')
    expect(mcpMemoryStoreVerdict({ command: 'node', args: ['data/mcp-servers/billingo-mcp/dist/cli.js'] }, { cwd })).toBeNull()
    expect(mcpMemoryStoreVerdict({ command: 'python', args: ['-m', 'fal_mcp_server'], env: { PYTHONPATH: 'data/mcp-servers/x' } }, { cwd })).toBeNull()
    expect(mcpMemoryStoreVerdict({ command: 'node', args: [join(dataDir, 'mcp-servers', 'wise-mcp', 'dist', 'cli.js')] })).toBeNull()
    expect(mcpMemoryStoreVerdict({ command: 'node', args: ['data/vault'] }, { cwd }))
      .toMatchObject({ match: 'path', kind: 'eyas-data', label: 'vault' })
    expect(mcpMemoryStoreVerdict({ command: 'node', args: ['data/mcp-servers/../vault/semantic'] }, { cwd }))
      .toMatchObject({ match: 'path', label: 'vault' })
    expect(mcpMemoryStoreVerdict({ command: 'x', args: [], env: { DB: join(dataDir, 'sqlite', 'eyas.db') } }))
      .toMatchObject({ match: 'path', kind: 'eyas-data' })
  })

  it('a link under <dataDir>/mcp-servers that leads into the vault is refused by its real path (negative)', () => {
    const area = mk(dataDir, 'mcp-servers')
    const link = join(area, 'sneaky')
    try {
      symlinkSync(join(dataDir, 'vault'), link)
      expect(mcpMemoryStoreVerdict({ command: 'node', args: [join(link, 'semantic')] }))
        .toMatchObject({ match: 'path', kind: 'eyas-data', label: 'vault' })
    } finally {
      rmSync(link, { force: true })
    }
  })

  it('boot: every server config/mcp.yaml ships is allowed (no memory_store_blocked on load)', () => {
    const parsed = parseYaml(readFileSync(join(process.cwd(), 'config', 'mcp.yaml'), 'utf-8')) as { servers?: Array<Record<string, unknown>> }
    const servers = parsed.servers ?? []
    expect(servers.length).toBeGreaterThan(0)
    const cwd = join(dataDir, '..')
    for (const server of servers) {
      const verdict = mcpMemoryStoreVerdict({
        name: server.name as string,
        command: server.command as string | undefined,
        args: server.args as string[] | undefined,
        url: server.url as string | undefined,
        env: server.env as Record<string, unknown> | undefined,
      }, { cwd })
      expect(verdict, String(server.name)).toBeNull()
    }
  })

  it('an env secret with a slash in it is not treated as a protected path', () => {
    expect(mcpMemoryStoreVerdict({ command: 'npx', args: ['-y', 'tavily-mcp'], env: { TAVILY_API_KEY: 'tvly-ab/cd+ef==' } })).toBeNull()
  })
})

// ── Client + routes ────────────────────────────────────────────────────────

function makeDb(): EyasDb {
  const db = createMemoryDb() as unknown as EyasDb
  db.run(sql`CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    transport TEXT NOT NULL DEFAULT 'stdio',
    url TEXT, command TEXT, args TEXT, env TEXT, api_key TEXT, headers TEXT,
    auth_type TEXT NOT NULL DEFAULT 'none',
    owned_by TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    auto_start INTEGER NOT NULL DEFAULT 1,
    discovered_tools TEXT, discovered_resources TEXT, discovered_prompts TEXT,
    status TEXT NOT NULL DEFAULT 'disconnected',
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  return db
}

function makeToolRegistry() {
  const tools = new Map<string, unknown>()
  return {
    tools,
    registry: {
      has: (name: string) => tools.has(name),
      register: (impl: { name: string }) => { tools.set(impl.name, impl) },
      unregister: (name: string) => { tools.delete(name) },
    } as any,
  }
}

function insertRow(db: EyasDb, row: { id: string; name: string; command: string; args: string[]; env?: Record<string, string>; enabled?: number; status?: string }) {
  db.run(sql`INSERT INTO mcp_servers (id, name, transport, command, args, env, enabled, auto_start, status)
    VALUES (${row.id}, ${row.name}, 'stdio', ${row.command}, ${JSON.stringify(row.args)},
    ${row.env ? JSON.stringify(row.env) : null}, ${row.enabled ?? 1}, 1, ${row.status ?? 'disconnected'})`)
}

function statusOf(db: EyasDb, id: string): { status: string; error: string | null } {
  return (db.all(sql`SELECT status, error FROM mcp_servers WHERE id = ${id}`) as any[])[0]
}

function setup() {
  const db = makeDb()
  const { tools, registry } = makeToolRegistry()
  const client = createMcpClient({ db, logger: silentLogger, toolRegistry: registry })
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    ;(c as any).set('ability', { can: () => true })
    await next()
  })
  createMcpRoutes(app, client)
  return { db, tools, client, app }
}

async function call(app: Hono, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, body: await res.json() as any }
}

describe('MCP client — memory stores are never spawned or exposed', () => {
  it('refuses add with McpMemoryStoreBlockedError and inserts nothing', async () => {
    const { db, client } = setup()
    await expect(client.add({ name: 'kg', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] }))
      .rejects.toBeInstanceOf(McpMemoryStoreBlockedError)
    expect(db.all(sql`SELECT id FROM mcp_servers`)).toHaveLength(0)
    expect(spawned).toHaveLength(0)
  })

  it('an existing flagged row is marked blocked at boot: no spawn, no mcp_* tools', async () => {
    const { db, tools, client } = setup()
    insertRow(db, { id: 'old-obsidian', name: 'obsidian', command: 'npx', args: ['-y', 'mcp-obsidian', vault] })
    insertRow(db, { id: 'old-fs', name: 'notes', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', vault] })
    await client.autoConnect()
    expect(spawned).toHaveLength(0)
    expect([...tools.keys()].filter((n) => n.startsWith('mcp_'))).toHaveLength(0)
    expect(statusOf(db, 'old-obsidian').status).toBe('blocked')
    expect(statusOf(db, 'old-fs').status).toBe('blocked')
    expect(statusOf(db, 'old-fs').error).toMatch(/memory outside EYAS/)
    await expect(client.connect('old-obsidian')).rejects.toMatchObject({ code: MEMORY_STORE_BLOCKED })
    expect(await client.test('old-fs')).toMatchObject({ ok: false, code: MEMORY_STORE_BLOCKED })
    expect(spawned).toHaveLength(0)
  })

  it('an allowed row still connects and registers its tools (control)', async () => {
    const { db, tools, client } = setup()
    insertRow(db, { id: 'fetch-1', name: 'fetch', command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'] })
    await client.autoConnect()
    expect(spawned).toHaveLength(1)
    expect(tools.has('mcp_fetch_read_graph')).toBe(true)
    expect(statusOf(db, 'fetch-1').status).toBe('connected')
  })

  it('a row the policy no longer flags leaves the blocked state', async () => {
    const { db, client } = setup()
    insertRow(db, { id: 'was-blocked', name: 'fs', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', project], enabled: 0, status: 'blocked' })
    await client.autoConnect()
    expect(statusOf(db, 'was-blocked')).toMatchObject({ status: 'disconnected', error: null })
  })
})

describe('MCP routes — 409 memory_store_blocked', () => {
  it.each(['memory', 'qdrant', 'obsidian'])('catalog install of %s → 409', async (id) => {
    const { db, app } = setup()
    const res = await call(app, 'POST', `/api/v1/mcp/registry/${id}/install`, {})
    expect(res.status).toBe(409)
    expect(res.body.code).toBe(MEMORY_STORE_BLOCKED)
    expect(db.all(sql`SELECT id FROM mcp_servers`)).toHaveLength(0)
    expect(spawned).toHaveLength(0)
  })

  it.each([
    ['reference memory server', { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] }],
    ['mcpvault', { command: 'npx', args: ['-y', '@bitbonsai/mcpvault@latest'] }],
  ])('manual add of %s → 409', async (_label, launch) => {
    const { db, app } = setup()
    const res = await call(app, 'POST', '/api/v1/mcp/servers', { name: 'my-notes', transport: 'stdio', ...launch })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe(MEMORY_STORE_BLOCKED)
    expect(db.all(sql`SELECT id FROM mcp_servers`)).toHaveLength(0)
  })

  it('a filesystem server with a vault argument or <dataDir>/vault → 409', async () => {
    const { app } = setup()
    for (const target of [vault, join(dataDir, 'vault')]) {
      const res = await call(app, 'POST', '/api/v1/mcp/servers', {
        name: `fs-${target.length}`,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', target],
      })
      expect(res.status, target).toBe(409)
      expect(res.body.code).toBe(MEMORY_STORE_BLOCKED)
    }
    expect(spawned).toHaveLength(0)
  })

  it('update that would point a server at a vault → 409, row unchanged', async () => {
    const { db, app, client } = setup()
    const created = await client.add({ name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', project], enabled: false, autoStart: false })
    const res = await call(app, 'PUT', `/api/v1/mcp/servers/${created.id}`, { args: ['-y', '@modelcontextprotocol/server-filesystem', vault] })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe(MEMORY_STORE_BLOCKED)
    const row = (db.all(sql`SELECT args FROM mcp_servers WHERE id = ${created.id}`) as any[])[0]
    expect(JSON.parse(row.args)).toContain(project)
  })

  it('the list exposes blocked:"memory_store"; refresh → 409; test → code', async () => {
    const { db, app } = setup()
    insertRow(db, { id: 'kg', name: 'kg', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] })
    insertRow(db, { id: 'git-1', name: 'git', command: 'npx', args: ['-y', '@modelcontextprotocol/server-git'], enabled: 0 })
    const list = await call(app, 'GET', '/api/v1/mcp/servers')
    const byId = Object.fromEntries(list.body.servers.map((s: any) => [s.id, s]))
    expect(byId.kg).toMatchObject({ blocked: 'memory_store', status: 'blocked' })
    expect(byId['git-1'].blocked).toBeNull()
    expect(byId['git-1'].env).toBeUndefined()

    const refresh = await call(app, 'POST', '/api/v1/mcp/servers/kg/refresh', {})
    expect(refresh.status).toBe(409)
    expect(refresh.body.code).toBe(MEMORY_STORE_BLOCKED)
    const test = await call(app, 'POST', '/api/v1/mcp/servers/kg/test', {})
    expect(test.body).toMatchObject({ ok: false, code: MEMORY_STORE_BLOCKED })
    expect(spawned).toHaveLength(0)
  })

  it('the catalog lists the flagged entries with memoryStore', async () => {
    const { app } = setup()
    const res = await call(app, 'GET', '/api/v1/mcp/registry')
    const flagged = res.body.servers.filter((s: any) => s.memoryStore).map((s: any) => s.id).sort()
    expect(flagged).toEqual(['memory', 'obsidian', 'qdrant'])
  })
})

describe('MCP routes — ordinary servers install normally', () => {
  it.each(['git', 'fetch'])('catalog install of %s → 201', async (id) => {
    const { app } = setup()
    const res = await call(app, 'POST', `/api/v1/mcp/registry/${id}/install`, {})
    expect(res.status).toBe(201)
    expect(res.body.server.blocked).toBeNull()
  })

  it('catalog install of github (with its token) → 201', async () => {
    const { app } = setup()
    const res = await call(app, 'POST', '/api/v1/mcp/registry/github/install', { env: { GITHUB_TOKEN: 'ghp_test' } })
    expect(res.status).toBe(201)
  })

  it('a filesystem server on a project folder, and a server merely named "memory", → 201', async () => {
    const { app } = setup()
    const fs = await call(app, 'POST', '/api/v1/mcp/servers', {
      name: 'project-files', transport: 'stdio', command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', project], autoStart: false,
    })
    expect(fs.status).toBe(201)
    const named = await call(app, 'POST', '/api/v1/mcp/servers', {
      name: 'memory', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'], autoStart: false,
    })
    expect(named.status).toBe(201)
    expect(named.body.server.blocked).toBeNull()
  })
})
