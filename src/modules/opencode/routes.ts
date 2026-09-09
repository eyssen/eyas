// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { requirePermission } from '@modules/permissions/middleware'
import type { CliRunner } from '@modules/studio/cli-runner.js'
import { doctorOpencode } from './doctor.js'
import { normalizeOpencodeSettings } from './settings-store.js'
import type { OpencodeSettings } from './types.js'
import type { PtyManager } from './pty-manager.js'
import type { OpencodeRunner } from './opencode-runner.js'
import { queryEyasMemory, saveEyasMemory, type MemoryServiceLike } from './memory-bridge.js'
import { resolveSessionCwd } from './path-guard.js'

const settingsPatch = z.object({
  enabled: z.boolean().optional(),
  cliPath: z.string().nullable().optional(),
  attachUrl: z.string().nullable().optional(),
  isolatedConfig: z.boolean().optional(),
  maxPtySessions: z.number().int().optional(),
  defaultCols: z.number().int().optional(),
  defaultRows: z.number().int().optional(),
})

const sessionBody = z.object({
  conversationId: z.string().min(1).max(128),
  cwd: z.string().max(4_096).optional(),
  kind: z.enum(['tui', 'shell']).default('tui'),
  cols: z.number().int().min(8).max(400).optional(),
  rows: z.number().int().min(4).max(200).optional(),
  workingDirectories: z.array(z.string().max(4_096)).max(32).optional(),
})

const memoryQueryBody = z.object({
  query: z.string().min(1).max(4_000),
  limit: z.number().int().min(1).max(20).optional(),
  conversationId: z.string().max(128).optional(),
  projectId: z.string().max(128).nullable().optional(),
})

function userIdOf(c: { get: (key: never) => unknown }): string {
  const value = (c.get as (key: string) => unknown)('userId')
  return typeof value === 'string' ? value : ''
}

const memorySaveBody = z.object({
  content: z.string().min(1).max(16_000),
  kind: z.enum(['stdout', 'diff', 'reasoning', 'note']).optional(),
  conversationId: z.string().max(128).optional(),
  projectId: z.string().max(128).nullable().optional(),
})

export function createOpencodeRoutes(
  app: Hono,
  deps: {
    runner: CliRunner
    load(): OpencodeSettings
    save(s: OpencodeSettings): void
    pty: PtyManager
    opencode: OpencodeRunner
    getMemory: () => MemoryServiceLike | undefined
    pluginToken: string
    dataDir: string
    resolveTuiCommand: () => { file: string; args: string[]; env: Record<string, string> }
  },
): void {
  app.get('/api/v1/opencode/status', requirePermission('read', 'OpenCode'), async (c) => {
    const status = await doctorOpencode(deps.runner, deps.load(), {
      serverUrl: deps.opencode.serverUrl(),
      serverVersion: deps.opencode.serverVersion(),
    })
    return c.json(status)
  })

  app.get('/api/v1/opencode/settings', requirePermission('read', 'OpenCode'), (c) => {
    return c.json(deps.load())
  })

  app.put('/api/v1/opencode/settings', requirePermission('manage', 'OpenCode'), async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = settingsPatch.safeParse(body)
    const current = deps.load()
    const patch = parsed.success ? parsed.data : {}
    const next = normalizeOpencodeSettings({ ...current, ...patch })
    deps.save(next)
    return c.json(next)
  })

  app.post('/api/v1/opencode/sessions', requirePermission('create', 'OpenCode'), async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = sessionBody.safeParse(body)
    if (!parsed.success) return c.json({ error: 'invalid session payload' }, 400)
    const settings = normalizeOpencodeSettings(deps.load())
    if (!settings.enabled) return c.json({ error: 'OpenCode is disabled' }, 409)
    const userId = userIdOf(c)
    if (!userId) return c.json({ error: 'unauthorized' }, 401)

    const fallback = `${deps.dataDir}/workspaces/${parsed.data.conversationId}`
    const cwd = resolveSessionCwd({
      requested: parsed.data.cwd,
      workingDirectories: parsed.data.workingDirectories,
      fallback,
    })

    if (parsed.data.kind === 'tui') {
      try {
        await deps.opencode.ensureServer()
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 503)
      }
    }

    const cmd = parsed.data.kind === 'tui'
      ? deps.resolveTuiCommand()
      : { file: process.env.SHELL || '/bin/bash', args: ['-l'], env: process.env as Record<string, string> }

    try {
      const rec = deps.pty.create(
        {
          userId,
          conversationId: parsed.data.conversationId,
          kind: parsed.data.kind,
          cwd,
          workingDirectories: parsed.data.workingDirectories ?? [cwd],
          cols: parsed.data.cols ?? settings.defaultCols,
          rows: parsed.data.rows ?? settings.defaultRows,
        },
        cmd,
      )
      return c.json({
        ...rec,
        wsPath: `/api/v1/opencode/terminal/${rec.id}`,
      })
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  app.get('/api/v1/opencode/sessions', requirePermission('read', 'OpenCode'), (c) => {
    const userId = userIdOf(c)
    return c.json({ sessions: deps.pty.listForUser(userId) })
  })

  app.delete('/api/v1/opencode/sessions/:id', requirePermission('create', 'OpenCode'), (c) => {
    const id = c.req.param('id')
    const userId = userIdOf(c)
    const rec = deps.pty.get(id)
    if (!rec || rec.userId !== userId) return c.json({ error: 'not found' }, 404)
    deps.pty.destroy(id)
    return c.json({ ok: true })
  })

  const requirePluginOrCreate: MiddlewareHandler = async (c, next) => {
    const auth = c.req.header('authorization') ?? ''
    if (auth === `Bearer ${deps.pluginToken}`) {
      await next()
      return
    }
    return requirePermission('create', 'OpenCode')(c, next)
  }

  app.post('/api/v1/opencode/memory/query', requirePluginOrCreate, async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = memoryQueryBody.safeParse(body)
    if (!parsed.success) return c.json({ error: 'invalid query' }, 400)
    const result = await queryEyasMemory(deps.getMemory(), parsed.data)
    return c.json(result)
  })

  app.post('/api/v1/opencode/memory/save', requirePluginOrCreate, async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const parsed = memorySaveBody.safeParse(body)
    if (!parsed.success) return c.json({ error: 'invalid save payload' }, 400)
    const conversationId = parsed.data.conversationId || 'opencode-plugin'
    const saved = saveEyasMemory({
      content: parsed.data.content,
      conversationId,
      projectId: parsed.data.projectId ?? null,
      kind: parsed.data.kind ?? 'note',
    })
    return c.json(saved)
  })
}
