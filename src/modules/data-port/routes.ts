// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { z } from 'zod'
import { requirePermission } from '@modules/permissions/middleware'
import { ADAPTERS, listProfiles } from './adapters/registry.js'
import {
  CANDIDATE_PAGE_DEFAULT,
  CANDIDATE_PAGE_MAX,
  DATA_PORT_EXPORT_VERSION,
  SELECTION_MAX_GROUPS,
  SELECTION_MAX_ROWS,
} from './constants.js'
import type { RollbackDeps } from './rollback.js'
import { failureReason, ScanInUse, SelectionCountSuperseded, type DataPortService } from './service.js'
import { CANDIDATE_KINDS, CANDIDATE_TARGETS } from './types.js'
import type { SourceProfile } from './types.js'

/**
 * What an error SAYS, for an HTTP body. Never `err.message`: drizzle quotes the
 * whole prepared statement there and puts the driver's own words on `.cause`,
 * so a failing INSERT answered `400 "Failed to run the query 'INSERT INTO
 * data_port_scans…"` with no reason in it at all. One helper for every failure
 * this module reports, stored or returned.
 */
const msg = failureReason

// The registry is the single list of profiles: an adapter added there is
// accepted by the API and offered by the wizard without a second edit here.
const sourceProfileSchema = z.enum(['auto', ...listProfiles()] as [string, ...string[]])

const instructionsSchema = z.string().max(4000).optional().nullable()

const scanPathSchema = z.object({
  path: z.string().min(1),
  sourceProfile: sourceProfileSchema.default('auto'),
  instructions: instructionsSchema,
})

/**
 * A reason code as the scanner emits it — `binary`, or a classed
 * `directory-skipped:node_modules`. Bounded and anchored, so a query string
 * cannot smuggle anything else into the filter.
 */
const reasonToken = z.string().regex(/^[a-z0-9][a-z0-9:_-]{0,63}$/)

/** `?kind=memory,code` — one query parameter, a bounded list. */
const csv = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v),
    z.array(schema).max(50).optional(),
  )

/** `?selected=true` — anything else is left for the schema to refuse. */
const bool = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean().optional(),
)

/**
 * How the list-valued fields combine, because the two readings differ and a
 * client cannot tell from the shape: `kind` and `reason` are OR within
 * themselves (`kind=memory,code` = either), while `tag` is AND
 * (`tag=legacy,contains-secrets` = a row carrying BOTH). Every field is ANDed
 * against every other, and a tag matches its whole value, so `tag=session`
 * does not match a row tagged `session-part:1/of`.
 */
const candidateFilterQuery = z.object({
  kind: csv(z.enum(CANDIDATE_KINDS)),
  reason: csv(reasonToken),
  folder: z.string().max(1024).optional(),
  subtree: bool,
  selected: bool,
  // A-47 — a declared field of `CandidateFilter`. Accepted explicitly: left
  // out, zod would strip it without a word and a client asking for the
  // importable rows would silently get all of them.
  importable: bool,
  q: z.string().max(200).optional(),
  tag: csv(z.string().max(64)),
  excludeKinds: csv(z.enum(CANDIDATE_KINDS)),
  excludeReasons: csv(reasonToken),
  excludeFolders: csv(z.string().max(1024)),
})

/** Paging is unbounded; `CANDIDATE_PAGE_MAX` bounds ONE response (R11.1). */
const pageQuery = candidateFilterQuery.extend({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(CANDIDATE_PAGE_MAX).default(CANDIDATE_PAGE_DEFAULT),
  order: z.enum(['path', 'seq']).default('path'),
})

/**
 * P-10 — a bulk gesture is a folder/kind GROUP, never an id list, so a whole
 * home directory is selected in one small request. `SELECTION_MAX_ROWS` and
 * `SELECTION_MAX_GROUPS` bound one body; neither bounds what may be imported.
 */
const selectionWireSchema = z.object({
  base: z.enum(['default', 'all', 'none']),
  groups: z
    .array(
      z.object({
        kind: z.enum(CANDIDATE_KINDS).optional(),
        folder: z.string().max(1024).optional(),
        selected: z.boolean(),
      }),
    )
    .max(SELECTION_MAX_GROUPS),
  rows: z
    .array(
      z.object({
        candidateId: z.string().min(1),
        selected: z.boolean().optional(),
        // Straight from the target list in types.ts, for the same reason the
        // profile enum comes from the registry: one list, no hand-copied twin.
        target: z.enum(CANDIDATE_TARGETS).optional(),
      }),
    )
    .max(SELECTION_MAX_ROWS),
})

/** The pre-R11 shape, still accepted and normalised into the wire (P-10). */
const legacySelectionSchema = z
  .array(
    z.object({
      candidateId: z.string().min(1),
      target: z.enum(CANDIDATE_TARGETS).optional(),
    }),
  )
  .min(1)

/**
 * Both shapes are accepted, and they are NOT interchangeable at the boundary:
 * an id list is counted as the caller wrote it, so a list naming only
 * unimportable rows creates a job that REPORTS them as skipped, while the same
 * selection expressed as a wire resolves to nothing and answers 400. Task 16
 * documents it; the difference is deliberate, because a hand-picked id the
 * scan cannot import must be answered for rather than dropped.
 */
const createJobSchema = z.object({
  scanId: z.string().min(1),
  sourceProfile: sourceProfileSchema,
  instructions: instructionsSchema,
  // Opt-in, and absent means no. The import is deterministic by default: a
  // client that says nothing about enrichment gets no model call at all.
  enrich: z.boolean().optional().default(false),
  selection: z.union([selectionWireSchema, legacySelectionSchema]),
})

export interface DataPortRouteDeps {
  service: DataPortService
  workspaceWriter?: {
    write: (req: { agentId: string; file: string; body: string }) => Promise<void>
  }
  /** Reads the file as it stands now; approval appends to that, not to the scan-time snapshot. */
  workspaceReader?: {
    read: (agentId: string, file: string) => string | null
  }
  /** Everything an undo may touch. Absent = the module could not wire it, and rollback answers 503. */
  rollbackDeps?: RollbackDeps
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
      // 202: the header row exists and the walk starts on the next tick (P-9).
      // A path that is missing or is not a directory is refused HERE, before a
      // header is written, so a bad path is a 400 rather than a scan that
      // fails a second later (A-27).
      try {
        return c.json(
          service.scanPath(
            parsed.data.sourceProfile as SourceProfile,
            parsed.data.path,
            parsed.data.instructions,
          ),
          202,
        )
      } catch (err) {
        return c.json({ error: msg(err) }, 400)
      }
    },
  )

  // ── One scan: status, progress, counts ─────────────────────────────
  app.get(
    '/api/v1/data-port/import/scans/:id',
    requirePermission('read', 'DataPort'),
    (c) => {
      const scan = service.getScan(c.req.param('id'))
      return scan ? c.json(scan) : c.json({ error: 'Scan not found' }, 404)
    },
  )

  // Cancels a running scan and purges its rows; a finished one is purged
  // outright. `ok` is true either way — the rows are gone in both cases.
  app.delete(
    '/api/v1/data-port/import/scans/:id',
    requirePermission('create', 'DataPort'),
    (c) => {
      const id = c.req.param('id')
      if (!service.getScan(id)) return c.json({ error: 'Scan not found' }, 404)
      // A scan a `pending`/`running` job is importing from refuses: purging its
      // rows would truncate that import in silence.
      try {
        const cancelling = service.cancelScan(id)
        return c.json({ ok: true, cancelling })
      } catch (err) {
        // Only the refusal is a conflict. A locked database reported as a 409
        // would tell the operator to wait for an import that does not exist.
        if (err instanceof ScanInUse) return c.json({ error: msg(err) }, 409)
        return c.json({ error: msg(err) }, 500)
      }
    },
  )

  // ── The folder tree, one level at a time ───────────────────────────
  app.get(
    '/api/v1/data-port/import/scans/:id/tree',
    requirePermission('read', 'DataPort'),
    (c) => {
      const id = c.req.param('id')
      if (!service.getScan(id)) return c.json({ error: 'Scan not found' }, 404)
      const parsed = candidateFilterQuery
        .extend({ parent: z.string().max(1024).default('.') })
        .safeParse(c.req.query())
      if (!parsed.success) {
        return c.json({ error: 'Invalid query', details: parsed.error.issues }, 400)
      }
      const { parent, ...filter } = parsed.data
      return c.json({
        parent,
        dirs: service.listDirs(id, parent, filter),
        files: service.candidateCounts(id, { ...filter, folder: parent, subtree: false }),
      })
    },
  )

  // ── One page of candidates ─────────────────────────────────────────
  app.get(
    '/api/v1/data-port/import/scans/:id/candidates',
    requirePermission('read', 'DataPort'),
    (c) => {
      const id = c.req.param('id')
      if (!service.getScan(id)) return c.json({ error: 'Scan not found' }, 404)
      const parsed = pageQuery.safeParse(c.req.query())
      if (!parsed.success) {
        return c.json({ error: 'Invalid query', details: parsed.error.issues }, 400)
      }
      const { offset, limit, order, ...filter } = parsed.data
      return c.json({ ...service.listCandidates(id, filter, { offset, limit, order }), offset, limit })
    },
  )

  app.get(
    '/api/v1/data-port/import/scans/:id/counts',
    requirePermission('read', 'DataPort'),
    (c) => {
      const id = c.req.param('id')
      if (!service.getScan(id)) return c.json({ error: 'Scan not found' }, 404)
      const parsed = candidateFilterQuery.safeParse(c.req.query())
      if (!parsed.success) {
        return c.json({ error: 'Invalid query', details: parsed.error.issues }, 400)
      }
      return c.json(service.candidateCounts(id, parsed.data))
    },
  )

  // How many rows a selection resolves to — answered from the table, so the
  // wizard never has to hold a list of ids to know what it has ticked.
  app.post(
    '/api/v1/data-port/import/scans/:id/selection/count',
    requirePermission('read', 'DataPort'),
    async (c) => {
      const id = c.req.param('id')
      if (!service.getScan(id)) return c.json({ error: 'Scan not found' }, 404)
      const parsed = z
        .object({
          selection: z.union([selectionWireSchema, legacySelectionSchema]),
          filter: candidateFilterQuery.optional(),
          folders: z.array(z.string().max(1024)).max(500).optional(),
        })
        .safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) {
        return c.json({ error: 'Invalid selection', details: parsed.error.issues }, 400)
      }
      try {
        return c.json(
          await service.selectionCount(
            id,
            parsed.data.selection,
            parsed.data.filter,
            parsed.data.folders,
          ),
        )
      } catch (err) {
        // A supersede is a race the client caused by asking again on a path the
        // wizard takes on every gesture — a conflict, never a 5xx.
        if (err instanceof SelectionCountSuperseded) return c.json({ error: msg(err) }, 409)
        return c.json({ error: msg(err) }, err instanceof RangeError ? 400 : 500)
      }
    },
  )

  // ── One candidate's first bytes ────────────────────────────────────
  // P-11: `create` on DataPort — the same right that produced the scan — and
  // the body comes back verbatim, secrets included. D-7 is a rule about what a
  // MODEL may recall, not about the owner reading their own file.
  app.get(
    '/api/v1/data-port/import/scans/:id/candidates/:cid/preview',
    requirePermission('create', 'DataPort'),
    (c) => {
      const parsed = z.coerce
        .number()
        .int()
        .min(1024)
        .max(1024 * 1024)
        .default(65_536)
        .safeParse(c.req.query('bytes') ?? undefined)
      if (!parsed.success) {
        return c.json({ error: 'Invalid bytes', details: parsed.error.issues }, 400)
      }
      const preview = service.preview(c.req.param('id'), c.req.param('cid'), parsed.data)
      return preview ? c.json(preview) : c.json({ error: 'Candidate not found' }, 404)
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
        return c.json({ error: msg(err) }, 400)
      }
    },
  )

  // ── Source profiles the wizard can offer ───────────────────────────
  // Straight from the adapter registry, with the root hints each one shows, so
  // the wizard never carries a second copy of the list.
  app.get(
    '/api/v1/data-port/import/profiles',
    requirePermission('read', 'DataPort'),
    (c) => {
      return c.json({
        profiles: ADAPTERS.map((adapter) => ({ id: adapter.id, rootHints: adapter.rootHints })),
      })
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
          enrich: parsed.data.enrich,
        })
        return c.json({ job }, 201)
      } catch (err) {
        // A scan still walking is a conflict, not a bad request: the same
        // payload will be accepted once the table is complete (P-9).
        const message = msg(err)
        return c.json({ error: message }, message === 'Scan is still running' ? 409 : 400)
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

  // ── Stop an import that is still going ─────────────────────────────
  // `update` on DataPort: stopping an import is not destructive — everything
  // already written stays, and the job row says how far it got — so it is not
  // held to the same right as the undo. The runner reads the flag at its next
  // batch boundary, where the ledger, the counters and the cursor agree, so the
  // stopped job leaves an honest account of what landed.
  //
  // 200 means the request was ACCEPTED, never that the import stopped: a job
  // already on its last batch finishes everything and reports `completed`
  // rather than `cancelled`, because nothing was left to stop. So the body says
  // which of the two happened — `status` is the job's status the moment the
  // request was taken: `cancelled` for a queued job, which really did stop
  // there and then, and `running` for one whose stop is still pending. The
  // outcome is always the job row, never this response.
  app.post(
    '/api/v1/data-port/import/jobs/:id/cancel',
    requirePermission('update', 'DataPort'),
    (c) => {
      const id = c.req.param('id')
      if (!service.getJob(id)) return c.json({ error: 'Job not found' }, 404)
      if (!service.cancelJob(id)) {
        return c.json({ error: 'Job is not running' }, 409)
      }
      return c.json({ ok: true, status: service.getJob(id)?.status ?? 'running' })
    },
  )

  // ── Roll an import back ────────────────────────────────────────────
  // Destructive, so `delete` on DataPort — owner/admin only by the module's
  // defaults. A job still running refuses (409); an unknown id is a 404.
  app.post(
    '/api/v1/data-port/import/jobs/:id/rollback',
    requirePermission('delete', 'DataPort'),
    async (c) => {
      if (!deps.rollbackDeps) {
        return c.json({ error: 'Rollback unavailable' }, 503)
      }
      try {
        const result = await service.rollback(c.req.param('id'), deps.rollbackDeps)
        return c.json({ result })
      } catch (err) {
        // `msg` is the module's one helper (see its comment); a local shadow
        // here would hand the caller drizzle's quoted statement instead.
        const reason = msg(err)
        return c.json({ error: reason }, reason.includes('not found') ? 404 : 409)
      }
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
        const proposal = await service.approveProposal(
          c.req.param('id'),
          deps.workspaceWriter,
          deps.workspaceReader,
        )
        return c.json({ proposal })
      } catch (err) {
        const reason = msg(err)
        return c.json({ error: reason }, reason.includes('not found') ? 404 : 400)
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
        const reason = msg(err)
        return c.json({ error: reason }, reason.includes('not found') ? 404 : 400)
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
