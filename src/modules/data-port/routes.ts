// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { z } from 'zod'
import { requirePermission } from '@modules/permissions/middleware'
import { DATA_PORT_EXPORT_VERSION } from './constants.js'
import type { DataPortService } from './service.js'
import type { SourceProfile } from './types.js'

const sourceProfileSchema = z.enum([
  'claude-code',
  'cursor',
  'obsidian',
  'generic-md',
  'chat-export',
  'eyas-export',
  'auto',
])

const instructionsSchema = z.string().max(4000).optional().nullable()

const scanPathSchema = z.object({
  path: z.string().min(1),
  sourceProfile: sourceProfileSchema.default('auto'),
  instructions: instructionsSchema,
})

const createJobSchema = z.object({
  scanId: z.string().min(1),
  sourceProfile: sourceProfileSchema,
  instructions: instructionsSchema,
  selection: z
    .array(
      z.object({
        candidateId: z.string().min(1),
        target: z
          .enum([
            'episodic',
            'vault.semantic',
            'vault.procedural',
            'skill',
            'workspace.agents',
            'workspace.soul',
            'workspace.identity',
            'workspace.tools',
            'workspace.memory',
            'none',
          ])
          .optional(),
      }),
    )
    .min(1),
})

export interface DataPortRouteDeps {
  service: DataPortService
  workspaceWriter?: {
    write: (req: { agentId: string; file: string; body: string }) => Promise<void>
  }
}

export function createDataPortRoutes(app: Hono, deps: DataPortRouteDeps) {
  const { service } = deps

  // ── Scan by server path ────────────────────────────────────────────
  app.post(
    '/api/v1/data-port/import/scan',
    requirePermission('create', 'DataPort'),
    async (c) => {
      const raw = await c.req.json().catch(() => null)
      const parsed = scanPathSchema.safeParse(raw)
      if (!parsed.success) {
        return c.json({ error: 'Invalid scan payload', details: parsed.error.issues }, 400)
      }
      try {
        const result = service.scanPath(
          parsed.data.sourceProfile as SourceProfile,
          parsed.data.path,
          parsed.data.instructions,
        )
        return c.json(result)
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
      }
    },
  )

  // ── Scan by upload (zip or single text file) ───────────────────────
  app.post(
    '/api/v1/data-port/import/scan-upload',
    requirePermission('create', 'DataPort'),
    async (c) => {
      try {
        const body = await c.req.parseBody()
        const file = body['file']
        if (!(file instanceof File)) {
          return c.json({ error: 'file field is required and must be a file upload' }, 400)
        }
        const profileRaw = typeof body['sourceProfile'] === 'string' ? body['sourceProfile'] : 'auto'
        const profileParsed = sourceProfileSchema.safeParse(profileRaw)
        if (!profileParsed.success) {
          return c.json({ error: 'Invalid sourceProfile' }, 400)
        }
        const instructions =
          typeof body['instructions'] === 'string' ? body['instructions'] : null
        const buffer = Buffer.from(await file.arrayBuffer())
        const result = await service.scanUpload(
          profileParsed.data as SourceProfile,
          { name: file.name, buffer },
          instructions,
        )
        return c.json(result)
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
      }
    },
  )

  // ── Start import job ───────────────────────────────────────────────
  app.post(
    '/api/v1/data-port/import/jobs',
    requirePermission('create', 'DataPort'),
    async (c) => {
      const raw = await c.req.json().catch(() => null)
      const parsed = createJobSchema.safeParse(raw)
      if (!parsed.success) {
        return c.json({ error: 'Invalid job payload', details: parsed.error.issues }, 400)
      }
      try {
        const job = service.createJob({
          scanId: parsed.data.scanId,
          sourceProfile: parsed.data.sourceProfile as SourceProfile,
          selection: parsed.data.selection,
          instructions: parsed.data.instructions,
        })
        return c.json({ job }, 201)
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
      }
    },
  )

  app.get(
    '/api/v1/data-port/import/jobs',
    requirePermission('read', 'DataPort'),
    (c) => {
      const limit = parseInt(c.req.query('limit') ?? '20', 10)
      return c.json({ jobs: service.listJobs(limit) })
    },
  )

  app.get(
    '/api/v1/data-port/import/jobs/:id',
    requirePermission('read', 'DataPort'),
    (c) => {
      const job = service.getJob(c.req.param('id'))
      if (!job) return c.json({ error: 'Job not found' }, 404)
      const proposals = service.listProposals({ jobId: job.id })
      return c.json({ job, proposals })
    },
  )

  // ── Workspace proposals (approve/reject — never auto-merge) ────────
  app.get(
    '/api/v1/data-port/proposals',
    requirePermission('read', 'DataPort'),
    (c) => {
      const status = c.req.query('status') || undefined
      const jobId = c.req.query('jobId') || undefined
      return c.json({ proposals: service.listProposals({ status, jobId }) })
    },
  )

  app.post(
    '/api/v1/data-port/proposals/:id/approve',
    requirePermission('update', 'DataPort'),
    async (c) => {
      if (!deps.workspaceWriter) {
        return c.json({ error: 'Workspace writer unavailable' }, 503)
      }
      try {
        const proposal = await service.approveProposal(c.req.param('id'), deps.workspaceWriter)
        return c.json({ proposal })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const status = msg.includes('not found') ? 404 : 400
        return c.json({ error: msg }, status)
      }
    },
  )

  app.post(
    '/api/v1/data-port/proposals/:id/reject',
    requirePermission('update', 'DataPort'),
    (c) => {
      try {
        const proposal = service.rejectProposal(c.req.param('id'))
        return c.json({ proposal })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const status = msg.includes('not found') ? 404 : 400
        return c.json({ error: msg }, status)
      }
    },
  )

  // ── Export stub ────────────────────────────────────────────────────
  app.post(
    '/api/v1/data-port/export',
    requirePermission('create', 'DataPort'),
    (c) => {
      return c.json(
        {
          error: 'coming_soon',
          message: 'Data export is planned. The target bundle format is documented as eyas-export-v1.',
          format: DATA_PORT_EXPORT_VERSION,
          planned: [
            'manifest.json',
            'vault/',
            'skills/*.md',
            'agents/<id>/workspace/',
            'episodic.jsonl',
          ],
        },
        503,
      )
    },
  )

  app.get(
    '/api/v1/data-port/export',
    requirePermission('read', 'DataPort'),
    (c) => {
      return c.json({
        available: false,
        status: 'coming_soon',
        format: DATA_PORT_EXPORT_VERSION,
      })
    },
  )
}
