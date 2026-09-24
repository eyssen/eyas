// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { installPathPolicy, resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy.js'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture.js'
import { createOpencodeRoutes } from '@modules/opencode/routes'
import { normalizeOpencodeSettings } from '@modules/opencode/settings-store'
import type { OpencodeSettings, PtySessionRecord } from '@modules/opencode/types'
import type { PtyManager } from '@modules/opencode/pty-manager'
import type { OpencodeRunner } from '@modules/opencode/opencode-runner'

vi.mock('@modules/permissions/middleware', () => ({
  requirePermission: () => async (_c: unknown, next: () => Promise<void>) => next(),
}))

function app(store: { settings: OpencodeSettings }) {
  const created: Array<{ cwd?: string }> = []
  const pty = {
    create: (input: { cwd?: string }) => {
      created.push(input)
      return { id: 'pty1', userId: 'u1', conversationId: 'c', kind: 'shell', cwd: input.cwd ?? '', cols: 80, rows: 24, pid: 1, state: 'running', createdAt: 0, lastActivityAt: 0 } satisfies PtySessionRecord
    },
  } as unknown as PtyManager
  const hono = new Hono()
  hono.use('*', async (c, next) => {
    ;(c.set as (k: string, v: unknown) => void)('userId', 'u1')
    await next()
  })
  createOpencodeRoutes(hono, {
    runner: { which: async () => null, run: async () => ({ code: 0, stdout: '', stderr: '' }) },
    load: () => store.settings,
    save: (s) => { store.settings = s },
    pty,
    opencode: {} as OpencodeRunner,
    getTools: () => undefined,
    pluginTokens: { redeem: () => null },
    sessions: { lookup: () => null },
    resolveTuiCommand: () => ({ file: 'opencode', args: [], env: {} }),
  })
  return { hono, created }
}

describe('opencode routes', () => {
  it('opens a shell session in the conversation workspace when no folder is given', async () => {
    const { hono, created } = app({ settings: normalizeOpencodeSettings({}) })
    const res = await hono.request('/api/v1/opencode/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'conv-route-1', kind: 'shell' }),
    })
    expect(res.status).toBe(200)
    expect(created[0]?.cwd).toBe(join(process.env.EYAS_WORKSPACES_DIR!, 'conv-route-1'))
  })

  it('refuses a conversation id that is not a safe folder name', async () => {
    const { hono, created } = app({ settings: normalizeOpencodeSettings({}) })
    const res = await hono.request('/api/v1/opencode/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: '../../outside', kind: 'shell' }),
    })
    expect(res.status).toBe(400)
    expect(created).toHaveLength(0)
  })

  it('drops the retired isolatedConfig key from a settings update', async () => {
    const store = { settings: normalizeOpencodeSettings({}) }
    const { hono } = app(store)
    const res = await hono.request('/api/v1/opencode/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isolatedConfig: false, maxPtySessions: 2 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).not.toHaveProperty('isolatedConfig')
    expect(body.maxPtySessions).toBe(2)
    expect(store.settings).not.toHaveProperty('isolatedConfig')
  })
})

describe('OpenCode terminal folders are screened like every CLI run (K2)', () => {
  let f: SovereigntyFixture

  beforeEach(() => {
    f = createSovereigntyFixture()
    f.stubInstanceEnv()
    installPathPolicy(f.policy)
  })
  afterEach(() => {
    resetPathPolicyForTests()
    vi.unstubAllEnvs()
    f.cleanup()
  })

  function tuiApp() {
    const created: Array<{ cwd?: string; workingDirectories?: string[] }> = []
    const ensureServer = vi.fn(async () => ({}))
    const pty = {
      create: (input: { cwd?: string; workingDirectories?: string[] }) => {
        created.push(input)
        return { id: 'pty1', userId: 'u1', conversationId: 'c', kind: 'tui', cwd: input.cwd ?? '', cols: 80, rows: 24, pid: 1, state: 'running', createdAt: 0, lastActivityAt: 0 } satisfies PtySessionRecord
      },
    } as unknown as PtyManager
    const hono = new Hono()
    hono.use('*', async (c, next) => {
      ;(c.set as (k: string, v: unknown) => void)('userId', 'u1')
      await next()
    })
    createOpencodeRoutes(hono, {
      runner: { which: async () => null, run: async () => ({ code: 0, stdout: '', stderr: '' }) },
      load: () => normalizeOpencodeSettings({}),
      save: () => undefined,
      pty,
      opencode: { ensureServer } as unknown as OpencodeRunner,
      getTools: () => undefined,
      pluginTokens: { redeem: () => null },
      sessions: { lookup: () => null },
      resolveTuiCommand: () => ({ file: 'opencode', args: [], env: {} }),
    })
    const open = async (body: Record<string, unknown>) => {
      const res = await hono.request('/api/v1/opencode/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: 'conv-1', kind: 'tui', ...body }),
      })
      return { status: res.status, body: await res.json() as { notices?: Array<{ code: string; params: { path: string; reason: string } }> } }
    }
    return { open, created, ensureServer }
  }

  it('(−) a stored folder that contains a vault is not the TUI\'s folder: the conversation workspace is, and the user is told why', async () => {
    const documents = join(f.home, 'Documents')
    mkdirSync(join(documents, 'Vault', '.obsidian'), { recursive: true })
    const { open, created } = tuiApp()
    const res = await open({ cwd: documents, workingDirectories: [documents] })
    expect(res.status).toBe(200)
    expect(created[0]?.cwd).toBe(f.ownWorkspace)
    expect(created[0]?.workingDirectories).toEqual([f.ownWorkspace])
    expect(res.body.notices).toEqual([{ code: 'folderRefused', params: { path: documents, reason: 'containsVault' } }])
  })

  it('(−) a stored folder that holds the EYAS data dir is left out; an allowed one of the same list is used', async () => {
    const project = join(f.root, 'projects', 'app')
    mkdirSync(project, { recursive: true })
    const { open, created } = tuiApp()
    const res = await open({ cwd: f.repo, workingDirectories: [f.repo, project] })
    expect(res.status).toBe(200)
    expect(created[0]?.cwd).toBe(project)
    expect(created[0]?.workingDirectories).toEqual([project])
    expect(res.body.notices?.map((n) => n.params.reason)).toEqual(['containsEyasData'])
  })

  it('(−) a client asking for the home folder gets the conversation workspace, never the home', async () => {
    const { open, created } = tuiApp()
    const res = await open({ cwd: f.home, workingDirectories: [f.home] })
    expect(res.status).toBe(200)
    expect(created[0]?.cwd).toBe(f.ownWorkspace)
    expect(res.body.notices?.map((n) => n.params.reason)).toEqual(['home'])
    const alone = await open({ cwd: f.home })
    expect(alone.status).toBe(200)
    expect(created[1]?.cwd).toBe(f.ownWorkspace)
    expect(alone.body.notices?.map((n) => n.params.reason)).toEqual(['home'])
  })

  it('(−) a cwd outside the request\'s folders is still refused', async () => {
    const project = join(f.root, 'projects', 'app')
    mkdirSync(project, { recursive: true })
    const { open, created } = tuiApp()
    const res = await open({ cwd: join(f.root, 'elsewhere'), workingDirectories: [project] })
    expect(res.status).toBe(400)
    expect(created).toHaveLength(0)
  })

  it('(+) an ordinary project folder is the TUI\'s folder, with no notice', async () => {
    const project = join(f.root, 'projects', 'app')
    mkdirSync(join(project, '.claude'), { recursive: true })
    const { open, created, ensureServer } = tuiApp()
    const res = await open({ cwd: project, workingDirectories: [project] })
    expect(res.status).toBe(200)
    expect(ensureServer).toHaveBeenCalledOnce()
    expect(created[0]?.cwd).toBe(project)
    expect(res.body.notices).toEqual([])
  })
})
