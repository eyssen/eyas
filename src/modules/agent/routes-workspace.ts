// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { requirePermission } from '@modules/permissions/middleware'
import { soulStyleSchema } from '../prompt-wizard/soul-style-schema.js'
import type { WorkspaceLoader } from '../prompt-wizard/workspace-loader.js'
import type { WorkspaceWriter } from '../prompt-wizard/workspace-writer.js'
import type { SoulPipeline } from '../prompt-wizard/soul-pipeline.js'
import type { AgentRegistry } from './agent-registry.js'

export interface AgentWorkspaceRoutesDeps {
  workspaceLoader: WorkspaceLoader
  workspaceWriter: WorkspaceWriter
  soulPipeline: SoulPipeline
  registry: AgentRegistry
  dataDir: string
}

// Files that can be read/written via the workspace API
const ALLOWED_FILES = new Set(['IDENTITY.md', 'AGENTS.md', 'TOOLS.md', 'MEMORY.md', 'SOUL.md'])
// SOUL.md is auto-rendered from SOUL.style.json — disallow direct writes
const READONLY_FILES = new Set(['SOUL.md'])
// Pattern for daily memory files: memory/YYYY-MM-DD.md
const MEMORY_DATE_RE = /^memory\/\d{4}-\d{2}-\d{2}\.md$/

function isAllowedFile(file: string): boolean {
  if (ALLOWED_FILES.has(file)) return true
  if (MEMORY_DATE_RE.test(file)) return true
  return false
}

export function createAgentWorkspaceRoutes(app: Hono, deps: AgentWorkspaceRoutesDeps): void {
  const { workspaceLoader, workspaceWriter, soulPipeline, registry, dataDir } = deps
  const api = new Hono()

  // GET /agents/:id/soul-style — return parsed SOUL.style.json body
  api.get('/agents/:id/soul-style', requirePermission('read', 'Agent'), async (c) => {
    const id = c.req.param('id')
    const agent = registry.get(id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    const ws = await workspaceLoader.load(id)
    if (!ws.soulStyleJson.exists) {
      return c.json({ error: 'SOUL.style.json not found' }, 404)
    }
    try {
      const parsed = JSON.parse(ws.soulStyleJson.body)
      return c.json({ soulStyle: parsed })
    } catch {
      return c.json({ error: 'SOUL.style.json is not valid JSON' }, 422)
    }
  })

  // PUT /agents/:id/soul-style — validate + save via soulPipeline
  api.put('/agents/:id/soul-style', requirePermission('update', 'Agent'), async (c) => {
    const id = c.req.param('id')
    const agent = registry.get(id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const parsed = soulStyleSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.issues }, 400)
    }
    await soulPipeline.saveStyle(id, agent.name, parsed.data)
    workspaceLoader.invalidate(id)
    return c.json({ ok: true })
  })

  // GET /agents/:id/workspace/:file — return { exists, body }
  api.get('/agents/:id/workspace/:file', requirePermission('read', 'Agent'), async (c) => {
    const id = c.req.param('id')
    const file = c.req.param('file')
    const agent = registry.get(id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    if (!isAllowedFile(file)) {
      return c.json({ error: `File "${file}" is not accessible via this API` }, 400)
    }
    const ws = await workspaceLoader.load(id)
    // Map file param to workspace property
    const fileEntry = resolveWorkspaceFile(ws, file)
    return c.json({ exists: fileEntry?.exists ?? false, body: fileEntry?.body ?? '' })
  })

  // PUT /agents/:id/workspace/:file — write body via workspaceWriter
  api.put('/agents/:id/workspace/:file', requirePermission('update', 'Agent'), async (c) => {
    const id = c.req.param('id')
    const file = c.req.param('file')
    const agent = registry.get(id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    if (!isAllowedFile(file)) {
      return c.json({ error: `File "${file}" is not accessible via this API` }, 400)
    }
    if (READONLY_FILES.has(file)) {
      return c.json({ error: `"${file}" is auto-rendered from SOUL.style.json and cannot be edited directly` }, 400)
    }
    let body: { body?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    if (typeof body.body !== 'string') {
      return c.json({ error: '"body" must be a string' }, 400)
    }
    await workspaceWriter.write({ agentId: id, file, body: body.body })
    workspaceLoader.invalidate(id)
    return c.json({ ok: true })
  })

  // GET /agents/:id/workspace/:file/history — list history snapshots
  api.get('/agents/:id/workspace/:file/history', requirePermission('read', 'Agent'), (c) => {
    const id = c.req.param('id')
    const file = c.req.param('file')
    const agent = registry.get(id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    if (!isAllowedFile(file)) {
      return c.json({ error: `File "${file}" is not accessible via this API` }, 400)
    }
    const histDir = join(dataDir, 'agents', id, '.history')
    let snapshots: Array<{ filename: string; timestamp: string; size: number }> = []
    try {
      // historyPath() writes files as `<basename>.<safeTs>.md`
      const baseName = file.includes('/') ? file.split('/').pop()! : file
      const entries = readdirSync(histDir)
        .filter((e) => e.startsWith(`${baseName}.`))
        .sort()
      snapshots = entries.map((filename) => {
        const stat = statSync(join(histDir, filename))
        // Extract timestamp from filename: <basename>.<ts>.md → <ts>
        const ts = filename.slice(baseName.length + 1, filename.lastIndexOf('.'))
        return { filename, timestamp: ts, size: stat.size }
      })
    } catch {
      // Directory doesn't exist or readdir fails → return empty list
    }
    return c.json({ snapshots })
  })

  // POST /agents/:id/workspace/:file/restore — restore a snapshot
  api.post('/agents/:id/workspace/:file/restore', requirePermission('update', 'Agent'), async (c) => {
    const id = c.req.param('id')
    const file = c.req.param('file')
    const agent = registry.get(id)
    if (!agent) return c.json({ error: 'Agent not found' }, 404)
    if (!isAllowedFile(file)) {
      return c.json({ error: `File "${file}" is not accessible via this API` }, 400)
    }
    let body: { snapshot?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    if (typeof body.snapshot !== 'string') {
      return c.json({ error: '"snapshot" filename is required' }, 400)
    }
    // Security: snapshot filename must not escape the history dir
    if (body.snapshot.includes('/') || body.snapshot.includes('..')) {
      return c.json({ error: 'Invalid snapshot filename' }, 400)
    }
    const { readFile, existsSync } = await import('node:fs')
    const { promisify } = await import('node:util')
    const readFileAsync = promisify(readFile)
    const snapPath = join(dataDir, 'agents', id, '.history', body.snapshot)
    const exists = existsSync(snapPath)
    if (!exists) return c.json({ error: 'Snapshot not found' }, 404)
    const content = await readFileAsync(snapPath, 'utf8')
    await workspaceWriter.write({ agentId: id, file, body: content, skipHistory: true })
    workspaceLoader.invalidate(id)
    return c.json({ ok: true })
  })

  app.route('/api/v1', api)
}

// ─── Helper ─────────────────────────────────────────────

function resolveWorkspaceFile(ws: any, file: string): { exists: boolean; body: string } | null {
  switch (file) {
    case 'IDENTITY.md': return ws.identity
    case 'AGENTS.md': return ws.agentsMd
    case 'TOOLS.md': return ws.toolsMd
    case 'MEMORY.md': return ws.memoryMd
    case 'SOUL.md': return ws.soulMd
    default:
      // memory/YYYY-MM-DD.md — search in dailyMemory array
      if (ws.dailyMemory) {
        const found = (ws.dailyMemory as any[]).find((m: any) => m.name === file)
        if (found) return found
        // Not found but pattern is valid → return exists:false
        return { exists: false, body: '' }
      }
      return null
  }
}
