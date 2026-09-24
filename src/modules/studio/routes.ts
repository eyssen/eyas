// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Created from onStart, never onRegister — see the api-auth-coverage contract.

import type { Hono } from 'hono'
import { z } from 'zod'
import { requirePermission } from '@modules/permissions/middleware'
import type { StudioGateway } from './types.js'
import type { StudioSettings } from './settings-store.js'

const createSchema = z.object({
  engineId: z.string().min(1).default('hyperframes'),
  title: z.string().min(1).max(200),
  conversationId: z.string().optional(),
})

const writeSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string(),
})

function jobError(c: any, err: unknown, status = 400) {
  const message = err instanceof Error ? err.message : String(err)
  return c.json({ error: message }, status)
}

export function createStudioRoutes(
  app: Hono,
  gw: StudioGateway,
  settings: { load(): StudioSettings; save(s: StudioSettings): void },
): void {
  app.get('/api/v1/studio/status', requirePermission('read', 'Studio'), async (c) => {
    const status = await gw.status()
    return c.json(status)
  })

  app.get('/api/v1/studio/engines', requirePermission('read', 'Studio'), (c) => {
    return c.json({ engines: gw.listEngines() })
  })

  app.get('/api/v1/studio/settings', requirePermission('read', 'Studio'), (c) => {
    return c.json(settings.load())
  })

  app.put('/api/v1/studio/settings', requirePermission('manage', 'Studio'), async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const current = settings.load()
    const next: StudioSettings = {
      hyperframes: {
        ...current.hyperframes,
        ...(body?.hyperframes && typeof body.hyperframes === 'object' ? body.hyperframes : {}),
      },
      videouse: {
        ...current.videouse,
        ...(body?.videouse && typeof body.videouse === 'object' ? body.videouse : {}),
      },
    }
    if (typeof next.hyperframes.enabled !== 'boolean') next.hyperframes.enabled = current.hyperframes.enabled
    if (next.hyperframes.cliPath !== null && typeof next.hyperframes.cliPath !== 'string') {
      next.hyperframes.cliPath = current.hyperframes.cliPath
    }
    if (typeof next.hyperframes.versionPin !== 'string' || !next.hyperframes.versionPin) {
      next.hyperframes.versionPin = current.hyperframes.versionPin
    }
    if (typeof next.hyperframes.allowNpx !== 'boolean') next.hyperframes.allowNpx = current.hyperframes.allowNpx
    if (typeof next.videouse.enabled !== 'boolean') next.videouse.enabled = current.videouse.enabled
    settings.save(next)
    return c.json(next)
  })

  app.get('/api/v1/studio/projects', requirePermission('read', 'Studio'), (c) => {
    const engineId = c.req.query('engineId') ?? undefined
    const conversationId = c.req.query('conversationId') ?? undefined
    return c.json({ projects: gw.listProjects({ engineId, conversationId }) })
  })

  app.post('/api/v1/studio/projects', requirePermission('create', 'Studio'), async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)
    try {
      const project = await gw.createProject(parsed.data)
      return c.json({ project }, 201)
    } catch (err) {
      return jobError(c, err)
    }
  })

  app.get('/api/v1/studio/projects/:id', requirePermission('read', 'Studio'), (c) => {
    const project = gw.getProject(c.req.param('id'))
    if (!project) return c.json({ error: 'Not found' }, 404)
    return c.json({ project })
  })

  app.post('/api/v1/studio/projects/:id/write', requirePermission('create', 'Studio'), async (c) => {
    const parsed = writeSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)
    try {
      const result = await gw.writeFile(c.req.param('id'), parsed.data.path, parsed.data.content)
      return c.json(result)
    } catch (err) {
      return jobError(c, err)
    }
  })

  app.post('/api/v1/studio/projects/:id/lint', requirePermission('read', 'Studio'), async (c) => {
    try {
      return c.json(await gw.lint(c.req.param('id')))
    } catch (err) {
      return jobError(c, err)
    }
  })

  app.post('/api/v1/studio/projects/:id/render', requirePermission('create', 'Studio'), async (c) => {
    const user = c.get('user') as { id?: string } | undefined
    try {
      const job = await gw.render({
        projectId: c.req.param('id'),
        userId: user?.id,
      })
      return c.json({ job })
    } catch (err) {
      return jobError(c, err)
    }
  })

  app.get('/api/v1/studio/jobs', requirePermission('read', 'Studio'), (c) => {
    const conversationId = c.req.query('conversationId') ?? undefined
    const projectId = c.req.query('projectId') ?? undefined
    const limitRaw = c.req.query('limit')
    const limit = limitRaw ? Number(limitRaw) : 50
    return c.json({
      jobs: gw.listJobs({
        conversationId,
        projectId,
        limit: Number.isFinite(limit) ? Math.min(limit, 100) : 50,
      }),
    })
  })

  app.get('/api/v1/studio/jobs/:id', requirePermission('read', 'Studio'), (c) => {
    const job = gw.getJob(c.req.param('id'))
    if (!job) return c.json({ error: 'Not found' }, 404)
    return c.json({ job })
  })
}
