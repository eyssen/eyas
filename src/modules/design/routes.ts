// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/routes.ts
//
// Created from onStart, never onRegister — see the api-auth-coverage contract.
//
// Note what is NOT here: no route serves an artboard as a document. The render
// endpoint returns the srcdoc as JSON and the frontend puts it into a sandboxed
// iframe. That sidesteps the whole X-Frame-Options / frame-ancestors problem
// and keeps AI-authored HTML off this origin as a navigable page.

import { Hono } from 'hono'
import type { Logger } from 'pino'
import { z } from 'zod'
import { requirePermission } from '@modules/permissions/middleware'
import { DesignNotFoundError, DesignValidationError, type DesignService } from './design-service.js'
import { DESIGN_KINDS } from './types.js'
import { imageDataUris } from './design-store.js'
import { artboardStem, renderArtboard } from './dc-render.js'
import { buildCanvasDocument, buildStandalonePage, parseAppifactDoc } from './canvas-io.js'
import { editDesign, type CompleteFn } from './design-ai.js'
import type { DesignAiRunService } from './design-ai-runs.js'
import { DcSpliceError, patchPropDefault, spliceArtboardBody } from './dc-splice.js'
import { PrintRenderError, PrintTargetError, type PrintService } from './print-service.js'
import { PAPER_CHOICES, type PaperChoice } from './print-options.js'
import { BrowserUnavailableError } from '@shared/playwright-loader'

export interface DesignRouteDeps {
  designs: DesignService
  /**
   * Every AI attempt is recorded here before it starts. Not optional: an edit
   * that leaves no row is an edit a reload cannot find out about, which is the
   * whole failure this exists to close.
   */
  runs: DesignAiRunService
  /** Raw model text for AI edits. Absent = the AI route answers 503. */
  complete?: CompleteFn
  /** The active design prompt row, when the owner has edited it. */
  designPrompt?: () => string | undefined
  /** Headless rendering. Absent means the print routes answer 503 rather than 500. */
  print?: PrintService
  logger: Logger
}

const filesRecord = z.record(z.string(), z.string())

const createSchema = z.object({
  title: z.string().min(1).max(200),
  kind: z.enum(DESIGN_KINDS).optional(),
  tags: z.array(z.string()).max(32).optional(),
  files: filesRecord.optional(),
})

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  kind: z.enum(DESIGN_KINDS).optional(),
  tags: z.array(z.string()).max(32).optional(),
})

const writeFileSchema = z.object({ content: z.string(), note: z.string().max(400).optional() })
const writeFilesSchema = z.object({ files: filesRecord, note: z.string().max(400).optional() })
const aiSchema = z.object({
  instruction: z.string().min(1).max(8000),
  targetFile: z.string().max(200).optional(),
  conversationId: z.string().max(64).optional(),
  commit: z.boolean().optional(),
})
const importSchema = z.object({
  page: z.string().min(1).max(32 * 1024 * 1024).optional(),
  files: filesRecord.optional(),
  title: z.string().min(1).max(200).optional(),
})
const linkSchema = z.object({ ownerModule: z.string().min(1).max(64), ownerId: z.string().min(1).max(128) })

function actor(c: any): string | undefined {
  return c.get('userId') as string | undefined
}

/**
 * A Content-Disposition filename that a header can actually carry. Titles are
 * user text and reach this through the slug, so anything outside a conservative
 * set is dropped rather than quoted.
 */
function downloadName(parts: string[], extension: string): string {
  const stem = parts
    .join('-')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
  return `${stem || 'design'}.${extension}`
}

function fail(c: any, err: unknown) {
  if (err instanceof BrowserUnavailableError) {
    return c.json({ error: 'Unavailable', message: err.message, remediation: err.remediation }, 503)
  }
  if (err instanceof PrintTargetError) return c.json({ error: 'NotFound', message: err.message }, 404)
  if (err instanceof PrintRenderError) return c.json({ error: 'RenderError', message: err.message }, 422)
  if (err instanceof DesignValidationError) {
    return c.json({ error: 'ValidationError', message: err.message, issues: err.result.errors, warnings: err.result.warnings }, 422)
  }
  if (err instanceof DesignNotFoundError) return c.json({ error: 'NotFound', message: err.message }, 404)
  if (err instanceof DcSpliceError) return c.json({ error: 'SpliceError', message: err.message }, 422)
  throw err
}

export function createDesignRoutes(app: Hono<any>, deps: DesignRouteDeps): void {
  const api = new Hono()
  const { designs } = deps

  api.get('/designs', requirePermission('read', 'Design'), (c) => {
    const kind = c.req.query('kind') as any
    const linkedModule = c.req.query('ownerModule')
    const linkedId = c.req.query('ownerId')
    if (linkedModule && linkedId) return c.json({ designs: designs.linkedTo(linkedModule, linkedId) })
    return c.json({ designs: designs.list({ kind }) })
  })

  api.post('/designs', requirePermission('create', 'Design'), async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)
    try {
      return c.json({ design: designs.create({ ...parsed.data, actor: actor(c) }) }, 201)
    } catch (err) { return fail(c, err) }
  })

  api.post('/designs/import', requirePermission('create', 'Design'), async (c) => {
    const parsed = importSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)

    let title = parsed.data.title
    let files = parsed.data.files
    if (parsed.data.page) {
      const imported = parseAppifactDoc(parsed.data.page)
      if (!imported.ok) return c.json({ error: 'ImportError', message: imported.message, notes: imported.notes, issues: imported.validation?.errors ?? [] }, 422)
      title = title ?? imported.title
      files = imported.files
      if (!files) return c.json({ error: 'ImportError', message: 'the page carried no files' }, 422)
      try {
        const design = designs.create({ title: title ?? 'Imported canvas', files, origin: 'import', actor: actor(c) })
        return c.json({ design, notes: imported.notes }, 201)
      } catch (err) { return fail(c, err) }
    }
    if (!files) return c.json({ error: 'ValidationError', message: 'either "page" or "files" is required' }, 400)
    try {
      return c.json({ design: designs.create({ title: title ?? 'Imported canvas', files, origin: 'import', actor: actor(c) }), notes: [] }, 201)
    } catch (err) { return fail(c, err) }
  })

  /**
   * Whether an export would work at all. Registered BEFORE /designs/:id: Hono
   * matches in registration order, and after it this path is just a design
   * whose id happens to be "print-status".
   */
  api.get('/designs/print-status', requirePermission('read', 'Design'), async (c) => {
    if (!deps.print) {
      return c.json({ available: false, reason: 'the design module was started without a print service' })
    }
    try {
      return c.json(await deps.print.status())
    } catch (err) {
      // status() is meant to answer, not throw. If it does, the honest answer
      // is still "no", not a 500 that makes the whole page look broken.
      return c.json({ available: false, reason: err instanceof Error ? err.message : String(err) })
    }
  })

  api.get('/designs/:id', requirePermission('read', 'Design'), (c) => {
    const design = designs.get(c.req.param('id'))
    if (!design) return c.json({ error: 'NotFound' }, 404)
    // `links` rides along because a delete confirmation has to name what it
    // takes with it, and attachments are invisible from the design's own page.
    return c.json({ design, links: designs.linkSummary(design.id) })
  })

  api.get('/designs/:id/export/png', requirePermission('read', 'Design'), async (c) => {
    if (!deps.print) return c.json({ error: 'Unavailable', message: 'no print service' }, 503)
    const design = designs.get(c.req.param('id'))
    if (!design) return c.json({ error: 'NotFound' }, 404)

    const file = c.req.query('file') ?? design.artboards[0]
    if (!file) return c.json({ error: 'NotFound', message: 'this canvas has no artboards' }, 404)

    const rawScale = c.req.query('scale')
    let scale: number | undefined
    if (rawScale !== undefined) {
      scale = Number(rawScale)
      if (!Number.isFinite(scale) || scale < 1 || scale > 3) {
        return c.json({ error: 'ValidationError', message: 'scale must be 1, 2 or 3' }, 400)
      }
    }

    try {
      const bytes = await deps.print.png(design, file, scale === undefined ? undefined : { scale })
      return new Response(bytes as any, {
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': `attachment; filename="${downloadName([design.slug, artboardStem(file)], 'png')}"`,
        },
      })
    } catch (err) { return fail(c, err) }
  })

  api.get('/designs/:id/export/pdf', requirePermission('read', 'Design'), async (c) => {
    if (!deps.print) return c.json({ error: 'Unavailable', message: 'no print service' }, 503)
    const design = designs.get(c.req.param('id'))
    if (!design) return c.json({ error: 'NotFound' }, 404)

    const file = c.req.query('file') ?? undefined

    const rawPaper = c.req.query('paper')
    if (rawPaper !== undefined && !(PAPER_CHOICES as string[]).includes(rawPaper)) {
      return c.json({ error: 'ValidationError', message: `paper must be one of: ${PAPER_CHOICES.join(', ')}` }, 400)
    }
    const paper = rawPaper as PaperChoice | undefined

    const rawMargin = c.req.query('margin')
    let marginMm: number | undefined
    if (rawMargin !== undefined) {
      marginMm = Number(rawMargin)
      // 40mm a side already eats most of an A5. Beyond that the content has
      // nowhere to go, and Chromium silently produces empty pages.
      if (!Number.isFinite(marginMm) || marginMm < 0 || marginMm > 40) {
        return c.json({ error: 'ValidationError', message: 'margin must be between 0 and 40 mm' }, 400)
      }
    }

    try {
      const bytes = await deps.print.pdf(design, {
        ...(file ? { file } : {}),
        ...(paper ? { paper } : {}),
        ...(marginMm === undefined ? {} : { marginMm }),
      })
      const name = file ? downloadName([design.slug, artboardStem(file)], 'pdf') : downloadName([design.slug], 'pdf')
      return new Response(bytes as any, {
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}"` },
      })
    } catch (err) { return fail(c, err) }
  })

  api.patch('/designs/:id', requirePermission('update', 'Design'), async (c) => {
    const parsed = patchSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)
    try {
      return c.json({ design: designs.update(c.req.param('id'), parsed.data) })
    } catch (err) { return fail(c, err) }
  })

  api.put('/designs/:id/files', requirePermission('update', 'Design'), async (c) => {
    const parsed = writeFilesSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)
    try {
      return c.json({ design: designs.writeFiles(c.req.param('id'), parsed.data.files, { actor: actor(c), note: parsed.data.note }) })
    } catch (err) { return fail(c, err) }
  })

  api.put('/designs/:id/files/:path{.+}', requirePermission('update', 'Design'), async (c) => {
    const parsed = writeFileSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)
    try {
      return c.json({ design: designs.writeFile(c.req.param('id'), c.req.param('path'), parsed.data.content, { actor: actor(c), note: parsed.data.note }) })
    } catch (err) { return fail(c, err) }
  })

  api.delete('/designs/:id/files/:path{.+}', requirePermission('update', 'Design'), (c) => {
    try {
      return c.json({ design: designs.deleteFile(c.req.param('id'), c.req.param('path'), { actor: actor(c) }) })
    } catch (err) { return fail(c, err) }
  })

  const bodySchema = z.object({
    file: z.string().min(1).max(200),
    template: z.string().max(2 * 1024 * 1024),
    note: z.string().max(400).optional(),
  })
  const propSchema = z.object({
    file: z.string().min(1).max(200),
    prop: z.string().min(1).max(80),
    value: z.unknown(),
  })

  /**
   * Persist a WYSIWYG edit. The runtime serialises only the template, because
   * that is what it parsed; splicing rebuilds the file around it so the head
   * marker, the helmet and the logic script survive untouched.
   */
  api.put('/designs/:id/body', requirePermission('update', 'Design'), async (c) => {
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)
    const design = designs.get(c.req.param('id'))
    if (!design) return c.json({ error: 'NotFound' }, 404)
    const source = design.files[parsed.data.file]
    if (source === undefined || !parsed.data.file.endsWith('.dc.html')) {
      return c.json({ error: 'NotFound', message: `no artboard named ${parsed.data.file}` }, 404)
    }
    try {
      const spliced = spliceArtboardBody(source, parsed.data.template)
      return c.json({
        design: designs.writeFile(design.id, parsed.data.file, spliced, {
          actor: actor(c), note: parsed.data.note ?? `edited ${parsed.data.file}`,
        }),
      })
    } catch (err) { return fail(c, err) }
  })

  /** Write a tweak's current value back as the artboard's declared default. */
  api.put('/designs/:id/props', requirePermission('update', 'Design'), async (c) => {
    const parsed = propSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)
    const design = designs.get(c.req.param('id'))
    if (!design) return c.json({ error: 'NotFound' }, 404)
    const source = design.files[parsed.data.file]
    if (source === undefined) return c.json({ error: 'NotFound', message: `no artboard named ${parsed.data.file}` }, 404)
    try {
      const patched = patchPropDefault(source, parsed.data.prop, parsed.data.value)
      return c.json({
        design: designs.writeFile(design.id, parsed.data.file, patched, {
          actor: actor(c), note: `set ${parsed.data.prop} default`,
        }),
      })
    } catch (err) { return fail(c, err) }
  })

  /**
   * The srcdoc for one artboard, as JSON. The frontend puts it into an iframe
   * whose sandbox attribute comes back in the same payload, so the two can
   * never drift apart.
   */
  api.get('/designs/:id/render/:file{.+}', requirePermission('read', 'Design'), (c) => {
    const design = designs.get(c.req.param('id'))
    if (!design) return c.json({ error: 'NotFound' }, 404)
    const file = c.req.param('file')
    const source = design.files[file]
    if (source === undefined || !file.endsWith('.dc.html')) return c.json({ error: 'NotFound', message: `no artboard named ${file}` }, 404)

    const siblings: Record<string, string> = {}
    for (const other of design.artboards) if (other !== file) siblings[other] = design.files[other]

    try {
      const rendered = renderArtboard({
        artboard: { file, source },
        siblings,
        images: imageDataUris(design.files),
      })
      return c.json(rendered)
    } catch (err) {
      return c.json({ error: 'RenderError', message: err instanceof Error ? err.message : String(err) }, 422)
    }
  })

  api.get('/designs/:id/versions', requirePermission('read', 'Design'), (c) => {
    if (!designs.get(c.req.param('id'))) return c.json({ error: 'NotFound' }, 404)
    return c.json({ versions: designs.versions(c.req.param('id')) })
  })

  api.post('/designs/:id/restore/:version', requirePermission('update', 'Design'), (c) => {
    const version = Number(c.req.param('version'))
    if (!Number.isInteger(version) || version < 1) return c.json({ error: 'ValidationError', message: 'version must be a positive integer' }, 400)
    try {
      return c.json({ design: designs.restore(c.req.param('id'), version, actor(c)) })
    } catch (err) { return fail(c, err) }
  })

  api.post('/designs/:id/ai', requirePermission('update', 'Design'), async (c) => {
    if (!deps.complete) {
      return c.json({ error: 'Unavailable', message: 'No model provider is configured, so the design cannot be edited by AI. Edit the source directly instead.' }, 503)
    }
    const design = designs.get(c.req.param('id'))
    if (!design) return c.json({ error: 'NotFound' }, 404)
    const parsed = aiSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)

    // The row exists before the model is asked, and is closed on every exit
    // below — including the throw. A run left `running` by this handler would
    // be indistinguishable from one a restart orphaned.
    const run = deps.runs.start({
      designId: design.id,
      instruction: parsed.data.instruction,
      ...(parsed.data.targetFile ? { targetFile: parsed.data.targetFile } : {}),
      versionBefore: design.currentVersion,
      ...(actor(c) ? { createdBy: actor(c)! } : {}),
    })

    let result
    try {
      result = await editDesign(
        { complete: deps.complete, systemPrompt: deps.designPrompt?.() },
        { files: design.files, instruction: parsed.data.instruction, targetFile: parsed.data.targetFile },
      )
    } catch (err) {
      deps.runs.finish(run.id, { status: 'failed', message: err instanceof Error ? err.message : String(err) })
      throw err
    }

    if (!result.ok) {
      deps.runs.finish(run.id, {
        status: 'failed',
        tier: result.tier,
        attempts: result.attempts,
        message: result.message ?? 'The edit did not pass the canvas rules.',
      })
      return c.json({
        error: 'AiEditFailed',
        message: result.message,
        tier: result.tier,
        attempts: result.attempts,
        issues: result.validation?.errors ?? [],
      }, 422)
    }
    if (parsed.data.commit === false) {
      deps.runs.finish(run.id, {
        status: 'ok',
        tier: result.tier,
        attempts: result.attempts,
        message: 'Candidate returned for preview; nothing was written.',
      })
      return c.json({ candidate: result.files, tier: result.tier, attempts: result.attempts })
    }
    try {
      const updated = designs.writeFiles(design.id, result.files!, {
        actor: actor(c), origin: 'ai', note: parsed.data.instruction.slice(0, 200),
      })
      deps.runs.finish(run.id, {
        status: 'ok', tier: result.tier, attempts: result.attempts, versionAfter: updated.currentVersion,
      })
      return c.json({ design: updated, tier: result.tier, attempts: result.attempts })
    } catch (err) {
      // The gate can still reject at write time; that is a failed run, not a
      // run that never ended.
      deps.runs.finish(run.id, {
        status: 'failed',
        tier: result.tier,
        attempts: result.attempts,
        message: err instanceof Error ? err.message : String(err),
      })
      return fail(c, err)
    }
  })

  api.get('/designs/:id/ai/runs', requirePermission('read', 'Design'), (c) => {
    const design = designs.get(c.req.param('id'))
    if (!design) return c.json({ error: 'NotFound' }, 404)
    const raw = Number(c.req.query('limit'))
    const limit = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5
    // `now` is the server's clock. Elapsed time computed against the browser's
    // own would drift by whatever the two disagree about.
    return c.json({ runs: deps.runs.list(design.id, limit), now: deps.runs.now() })
  })

  api.get('/designs/:id/export', requirePermission('read', 'Design'), (c) => {
    const design = designs.get(c.req.param('id'))
    if (!design) return c.json({ error: 'NotFound' }, 404)
    const format = c.req.query('format') ?? 'files'

    if (format === 'files') return c.json({ title: design.title, files: design.files })
    if (format === 'document') {
      return new Response(buildCanvasDocument(design.title, design.files), {
        headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${design.slug}.canvas.json"` },
      })
    }
    if (format === 'html') {
      const images = imageDataUris(design.files)
      const placed = design.manifest.artboards ?? []
      const frames = design.artboards.map((file, index) => {
        const entry = placed.find((a) => a.file === file)
        const siblings: Record<string, string> = {}
        for (const other of design.artboards) if (other !== file) siblings[other] = design.files[other]
        const rendered = renderArtboard({ artboard: { file, source: design.files[file] }, siblings, images })
        return {
          file,
          srcdoc: rendered.srcdoc,
          sandbox: rendered.sandbox,
          x: entry?.x ?? index * 880,
          y: entry?.y ?? 0,
          w: entry?.w ?? rendered.preview?.width ?? 800,
          h: entry?.h ?? rendered.preview?.height ?? 600,
        }
      })
      return new Response(buildStandalonePage(design.title, frames), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${design.slug}.html"` },
      })
    }
    return c.json({ error: 'ValidationError', message: 'format must be one of: files, document, html' }, 400)
  })

  api.post('/designs/:id/links', requirePermission('update', 'Design'), async (c) => {
    const parsed = linkSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)
    if (!designs.get(c.req.param('id'))) return c.json({ error: 'NotFound' }, 404)
    designs.link(c.req.param('id'), parsed.data.ownerModule, parsed.data.ownerId)
    return c.json({ ok: true })
  })

  api.delete('/designs/:id/links/:ownerModule/:ownerId', requirePermission('update', 'Design'), (c) => {
    designs.unlink(c.req.param('id'), c.req.param('ownerModule'), c.req.param('ownerId'))
    return c.json({ ok: true })
  })

  api.delete('/designs/:id', requirePermission('delete', 'Design'), (c) => {
    if (!designs.get(c.req.param('id'))) return c.json({ error: 'NotFound' }, 404)
    designs.remove(c.req.param('id'))
    return c.json({ ok: true })
  })

  app.route('/api/v1', api)
}
