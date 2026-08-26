// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { createAgentWorkspaceRoutes } from '../../../src/modules/agent/routes-workspace.js'
import { buildAbilityForRole } from '../../../src/modules/permissions/roles.js'
import { createPermissionRegistry } from '../../../src/modules/permissions/registry.js'
import { errorHandler } from '../../../src/core/http/middleware/error-handler.js'
import type { AgentWorkspace, WorkspaceFile } from '../../../src/modules/prompt-wizard/workspace-types.js'

// ─── Helpers ────────────────────────────────────────────

function makeAbility() {
  const registry = createPermissionRegistry()
  registry.registerSubject('Agent', {
    actions: ['read', 'update', 'create', 'delete'],
    defaults: {
      admin: ['read', 'update', 'create', 'delete'],
      owner: ['read', 'update', 'create', 'delete'],
      user: ['read', 'update', 'create', 'delete'],
      agent: [],
      guest: [],
    },
  })
  return buildAbilityForRole('admin', registry)
}

function makeWorkspaceFile(name: string, body: string, exists = true): WorkspaceFile {
  return { name, path: `/fake/${name}`, exists, frontmatter: null, body, byteSize: body.length, truncated: false }
}

const CANNED_WORKSPACE: AgentWorkspace = {
  agentId: 'test-agent',
  rootPath: '/fake',
  identity: makeWorkspaceFile('IDENTITY.md', '# Identity'),
  soulMd: makeWorkspaceFile('SOUL.md', '# Soul'),
  soulStyleJson: makeWorkspaceFile('SOUL.style.json', JSON.stringify({ version: 1 }), true),
  agentsMd: makeWorkspaceFile('AGENTS.md', '## Agents'),
  toolsMd: makeWorkspaceFile('TOOLS.md', '## Tools'),
  memoryMd: makeWorkspaceFile('MEMORY.md', '## Memory'),
  dailyMemory: [makeWorkspaceFile('memory/2026-04-27.md', '# daily')],
}

const VALID_SOUL_STYLE = {
  version: 1,
  preset: { internal: 'jarvis', external: 'custom' },
  internal: {
    address: 'magázó',
    tone: 'komoly',
    verbosity: 'lényegre törő',
    directness: 'direkt + udvarias',
    humor: 'nincs',
    emoji: 'soha',
    blockedPhrases: [],
    signature: '',
  },
  external: {
    address: 'magázó',
    tone: 'kiegyensúlyozott',
    verbosity: 'lényegre törő',
    directness: 'direkt + udvarias',
    humor: 'nincs',
    emoji: 'soha',
    blockedPhrases: [],
    signature: '',
  },
}

function createTestApp(opts?: {
  workspace?: AgentWorkspace | null
  writeCalls?: { agentId: string; file: string; body: string }[]
  soulStyleSaveCalls?: unknown[]
  agentExists?: boolean
}) {
  const writeCalls: { agentId: string; file: string; body: string }[] = opts?.writeCalls ?? []
  const soulStyleSaveCalls: unknown[] = opts?.soulStyleSaveCalls ?? []
  const workspace = opts?.workspace !== undefined ? opts.workspace : CANNED_WORKSPACE
  const agentExists = opts?.agentExists ?? true

  const loader = {
    load: vi.fn().mockResolvedValue(workspace),
    invalidate: vi.fn(),
    invalidateAll: vi.fn(),
  }
  const writer = {
    write: vi.fn().mockImplementation(async (req: { agentId: string; file: string; body: string }) => {
      writeCalls.push(req)
    }),
    delete: vi.fn(),
  }
  const soulPipeline = {
    saveStyle: vi.fn().mockImplementation(async (_id: string, _name: string, style: unknown) => {
      soulStyleSaveCalls.push(style)
    }),
    rerender: vi.fn(),
  }
  const registry = {
    get: vi.fn().mockReturnValue(agentExists ? { id: 'test-agent', name: 'Test Agent' } : undefined),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    toggle: vi.fn(),
    getByCapability: vi.fn(),
    addTokenUsage: vi.fn(),
    isWithinBudget: vi.fn(),
    resetMonthlyBudgets: vi.fn(),
    seedFromDirectory: vi.fn(),
  }

  const ability = makeAbility()
  // Use plain Hono — inject ability/userId via middleware cast to any to avoid generic type conflicts
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c: any, next: any) => {
    c.set('ability', ability)
    c.set('userId', 'test-user')
    await next()
  })
  createAgentWorkspaceRoutes(app as any, {
    workspaceLoader: loader,
    workspaceWriter: writer,
    soulPipeline,
    registry: registry as any,
    dataDir: '/tmp/test-data',
  })

  return { app, loader, writer, soulPipeline, registry, writeCalls, soulStyleSaveCalls }
}

// ─── Tests ──────────────────────────────────────────────

describe('Agent Workspace Routes', () => {
  describe('GET /api/v1/agents/:id/soul-style', () => {
    it('returns parsed soul style JSON when exists', async () => {
      const { app } = createTestApp()
      const res = await app.request('/api/v1/agents/test-agent/soul-style')
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.soulStyle).toBeDefined()
      expect(body.soulStyle.version).toBe(1)
    })

    it('returns 404 when agent not found', async () => {
      const { app } = createTestApp({ agentExists: false })
      const res = await app.request('/api/v1/agents/missing-agent/soul-style')
      expect(res.status).toBe(404)
    })

    it('returns 404 when SOUL.style.json does not exist', async () => {
      const ws: AgentWorkspace = {
        ...CANNED_WORKSPACE,
        soulStyleJson: makeWorkspaceFile('SOUL.style.json', '', false),
      }
      const { app } = createTestApp({ workspace: ws })
      const res = await app.request('/api/v1/agents/test-agent/soul-style')
      expect(res.status).toBe(404)
    })
  })

  describe('PUT /api/v1/agents/:id/soul-style', () => {
    it('saves valid soul style', async () => {
      const soulStyleSaveCalls: unknown[] = []
      const { app } = createTestApp({ soulStyleSaveCalls })
      const res = await app.request('/api/v1/agents/test-agent/soul-style', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_SOUL_STYLE),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.ok).toBe(true)
      expect(soulStyleSaveCalls).toHaveLength(1)
    })

    it('returns 400 for invalid soul style (missing required fields)', async () => {
      const { app } = createTestApp()
      const res = await app.request('/api/v1/agents/test-agent/soul-style', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: 2, bogus: true }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as any
      expect(body.error).toMatch(/[Vv]alidation/)
    })

    it('returns 404 when agent not found', async () => {
      const { app } = createTestApp({ agentExists: false })
      const res = await app.request('/api/v1/agents/missing/soul-style', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_SOUL_STYLE),
      })
      expect(res.status).toBe(404)
    })
  })

  describe('GET /api/v1/agents/:id/workspace/:file', () => {
    it('returns file body for allowed file', async () => {
      const { app } = createTestApp()
      const res = await app.request('/api/v1/agents/test-agent/workspace/IDENTITY.md')
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.exists).toBe(true)
      expect(body.body).toBe('# Identity')
    })

    it('returns exists:false for non-existent daily memory file', async () => {
      const { app } = createTestApp()
      const res = await app.request('/api/v1/agents/test-agent/workspace/memory%2F2026-01-01.md')
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.exists).toBe(false)
    })

    it('returns 400 for disallowed file (not in allowlist)', async () => {
      const { app } = createTestApp()
      const res = await app.request('/api/v1/agents/test-agent/workspace/config.yaml')
      expect(res.status).toBe(400)
    })

    it('returns 400 for unknown file like README.md', async () => {
      const { app } = createTestApp()
      const res = await app.request('/api/v1/agents/test-agent/workspace/README.md')
      expect(res.status).toBe(400)
    })

    it('returns 404 when agent not found', async () => {
      const { app } = createTestApp({ agentExists: false })
      const res = await app.request('/api/v1/agents/missing/workspace/IDENTITY.md')
      expect(res.status).toBe(404)
    })
  })

  describe('PUT /api/v1/agents/:id/workspace/:file', () => {
    it('writes valid file and returns ok:true', async () => {
      const writeCalls: { agentId: string; file: string; body: string }[] = []
      const { app } = createTestApp({ writeCalls })
      const res = await app.request('/api/v1/agents/test-agent/workspace/IDENTITY.md', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: '# Updated Identity' }),
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.ok).toBe(true)
      expect(writeCalls).toHaveLength(1)
      expect(writeCalls[0].file).toBe('IDENTITY.md')
      expect(writeCalls[0].body).toBe('# Updated Identity')
    })

    it('returns 400 for SOUL.md (read-only, auto-rendered)', async () => {
      const { app } = createTestApp()
      const res = await app.request('/api/v1/agents/test-agent/workspace/SOUL.md', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'something' }),
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as any
      expect(body.error).toMatch(/auto-rendered/)
    })

    it('returns 400 for disallowed file names', async () => {
      const { app } = createTestApp()
      const res = await app.request('/api/v1/agents/test-agent/workspace/secrets.env', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'bad' }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 when body field is missing', async () => {
      const { app } = createTestApp()
      const res = await app.request('/api/v1/agents/test-agent/workspace/IDENTITY.md', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'oops' }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/v1/agents/:id/workspace/:file/history', () => {
    it('returns empty snapshots when .history dir does not exist', async () => {
      const { app } = createTestApp()
      const res = await app.request('/api/v1/agents/test-agent/workspace/IDENTITY.md/history')
      expect(res.status).toBe(200)
      const body = (await res.json()) as any
      expect(body.snapshots).toEqual([])
    })

    it('returns 404 when agent not found', async () => {
      const { app } = createTestApp({ agentExists: false })
      const res = await app.request('/api/v1/agents/missing/workspace/IDENTITY.md/history')
      expect(res.status).toBe(404)
    })

    it('returns 400 for disallowed file', async () => {
      const { app } = createTestApp()
      const res = await app.request('/api/v1/agents/test-agent/workspace/hack.sh/history')
      expect(res.status).toBe(400)
    })
  })

  describe('POST /api/v1/agents/:id/workspace/:file/restore', () => {
    it('returns 404 when snapshot file does not exist', async () => {
      const { app } = createTestApp()
      const res = await app.request('/api/v1/agents/test-agent/workspace/IDENTITY.md/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot: 'IDENTITY.md.2026-04-01T00-00-00.md' }),
      })
      expect(res.status).toBe(404)
    })

    it('returns 400 for snapshot filename with path traversal', async () => {
      const { app } = createTestApp()
      const res = await app.request('/api/v1/agents/test-agent/workspace/IDENTITY.md/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot: '../../../etc/passwd' }),
      })
      expect(res.status).toBe(400)
    })

    it('returns 404 when agent not found', async () => {
      const { app } = createTestApp({ agentExists: false })
      const res = await app.request('/api/v1/agents/missing/workspace/IDENTITY.md/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot: 'IDENTITY.md.2026-04-01T00-00-00.md' }),
      })
      expect(res.status).toBe(404)
    })

    it('returns 400 for disallowed file', async () => {
      const { app } = createTestApp()
      const res = await app.request('/api/v1/agents/test-agent/workspace/hack.sh/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot: 'hack.sh.2026-04-01T00-00-00.md' }),
      })
      expect(res.status).toBe(400)
    })
  })
})
