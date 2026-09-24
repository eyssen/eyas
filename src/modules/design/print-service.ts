// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/print-service.ts
//
// Turning a canvas into printable bytes.
//
// The shape of this file follows from one browser fact: Chromium cannot
// paginate content inside an iframe. So every artboard is rendered as its own
// top-level document (see print-page.ts), and a multi-artboard PDF is those
// single-artboard PDFs concatenated with pdf-lib.
//
// That is not a workaround, it is the better answer. A brochure keeps each
// page at its natural size, a flowing report still paginates, and one artboard
// cannot leak its <helmet> CSS into the next — which is exactly what would
// happen if several were mounted into one document.

import { PDFDocument } from 'pdf-lib'
import type { Logger } from 'pino'
import type { BrowserStatus, HeadlessBrowser } from '@shared/headless-browser.js'
import type { ArtboardEntry } from './canvas-schema.js'
import { buildArtboardSpec, FONT_ORIGINS } from './dc-render.js'
import { imageDataUris } from './design-store.js'
import { buildPrintDocument } from './print-page.js'
import {
  DEFAULT_MARGIN_MM,
  DEFAULT_PAPER,
  PAPERS,
  frameOf,
  pdfOptionsFor,
  pngOptionsFor,
  printModeOf,
  type Frame,
  type PaperChoice,
} from './print-options.js'
import type { Design } from './types.js'

/** The artboard asked for is not in this design. Routes map this to 404. */
export class PrintTargetError extends Error {}
/** The artboard is there but would print blank. Routes map this to 422. */
export class PrintRenderError extends Error {}

export interface PdfRequest {
  /** One artboard, or the whole canvas when omitted. */
  file?: string
  paper?: PaperChoice
  marginMm?: number
}

export interface PrintService {
  status(): Promise<BrowserStatus>
  png(design: Design, file: string, opts?: { scale?: number }): Promise<Uint8Array>
  pdf(design: Design, opts?: PdfRequest): Promise<Uint8Array>
}

/**
 * Reading order for the canvas: by page, then down, then across — the order a
 * person would read the artboards off the canvas, which is the order the pages
 * of the export have to be in. Anything the manifest never placed is appended
 * by name, because there is nothing better to go on.
 */
export function orderedArtboards(design: Design): string[] {
  const placed = design.manifest.artboards ?? []
  const pageOrder = new Map((design.manifest.pages ?? []).map((p, i) => [p.id, i]))
  const rank = (entry: ArtboardEntry): number =>
    entry.page === undefined ? -1 : (pageOrder.get(entry.page) ?? pageOrder.size)

  const known = new Set(design.artboards)
  const inCanvas = placed
    .filter((entry) => known.has(entry.file))
    .slice()
    .sort((a, b) => rank(a) - rank(b) || a.y - b.y || a.x - b.x || a.file.localeCompare(b.file))
    .map((entry) => entry.file)

  const seen = new Set(inCanvas)
  const rest = design.artboards.filter((f) => !seen.has(f)).sort()
  return [...inCanvas, ...rest]
}

interface Prepared {
  html: string
  mode: 'fixed' | 'flow'
  frame: Frame
}

function prepare(design: Design, file: string): Prepared {
  const source = design.files[file]
  if (source === undefined || !file.endsWith('.dc.html')) {
    throw new PrintTargetError(`no artboard named ${file}`)
  }

  const siblings: Record<string, string> = {}
  for (const other of design.artboards) if (other !== file) siblings[other] = design.files[other]

  const built = buildArtboardSpec({ artboard: { file, source }, siblings, images: imageDataUris(design.files) })
  const entry = (design.manifest.artboards ?? []).find((a) => a.file === file)
  const mode = printModeOf(entry)
  const frame = frameOf(entry, built.preview)

  return {
    html: buildPrintDocument({ spec: built.spec, mode, width: frame.width, height: frame.height }),
    mode,
    frame,
  }
}

/**
 * Wait for the mount marker, then refuse anything either layer flagged.
 *
 * Two layers, because the runtime and the print shell fail in different places.
 * The shell marks <html> when __dcMountArtboard itself throws. The runtime
 * marks its own host and replaces the artboard with the message when the
 * component constructor or renderVals() throws — a page that would print as
 * nothing but "renderVals() threw: …". Both are broken exports, and handing
 * either one back as a PDF is worse than refusing.
 */
async function settle(page: any, file: string): Promise<void> {
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-dc-ready'), null, { timeout: 15_000 })

  const mountFailure = await page.getAttribute('html', 'data-dc-error')
  if (mountFailure) {
    throw new PrintRenderError(`${file} did not render: ${mountFailure}`)
  }

  const logicFailure = await page.getAttribute('#dc-root', 'data-dc-error')
  if (logicFailure) {
    const detail = await page.textContent('#dc-root').catch(() => null)
    throw new PrintRenderError(`${file} did not render: ${(detail ?? 'the artboard logic threw').trim().slice(0, 300)}`)
  }
  // Web fonts, if any were allowed through, but never at the cost of the export.
  await page
    .evaluate(() => Promise.race([
      (document as any).fonts?.ready ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]))
    .catch(() => undefined)
}

async function mergePdfs(parts: Uint8Array[]): Promise<Uint8Array> {
  if (parts.length === 1) return parts[0]
  const out = await PDFDocument.create()
  for (const bytes of parts) {
    const src = await PDFDocument.load(bytes)
    const copied = await out.copyPages(src, src.getPageIndices())
    for (const page of copied) out.addPage(page)
  }
  return out.save()
}

export function createPrintService(deps: { browser: HeadlessBrowser; logger: Logger }): PrintService {
  const { browser, logger } = deps

  async function renderPdf(design: Design, file: string, req: PdfRequest): Promise<Uint8Array> {
    const { html, mode, frame } = prepare(design, file)
    const paper = req.paper ?? DEFAULT_PAPER
    const pdfOptions = pdfOptionsFor({ mode, frame, paper, marginMm: req.marginMm ?? DEFAULT_MARGIN_MM })

    // A flow artboard is laid out at the paper's height so that anything sized
    // in viewport units lands where the paginator will put it.
    const viewport: Frame = mode === 'fixed' ? frame : { width: frame.width, height: PAPERS[paper].heightPx }

    return browser.withPage({ viewport, allowOrigins: [...FONT_ORIGINS], timeoutMs: 30_000 }, async (page) => {
      await page.setContent(html, { waitUntil: 'domcontentloaded' })
      await settle(page, file)
      const bytes = await page.pdf(pdfOptions)
      return new Uint8Array(bytes)
    })
  }

  return {
    status: () => browser.status(),

    async png(design, file, opts) {
      const { html, mode, frame } = prepare(design, file)
      const png = pngOptionsFor({ mode, frame, scale: opts?.scale })

      return browser.withPage(
        {
          viewport: png.viewport,
          deviceScaleFactor: png.deviceScaleFactor,
          allowOrigins: [...FONT_ORIGINS],
          timeoutMs: 30_000,
        },
        async (page) => {
          await page.setContent(html, { waitUntil: 'domcontentloaded' })
          await settle(page, file)
          const bytes = await page.screenshot({ type: 'png', fullPage: png.fullPage })
          return new Uint8Array(bytes)
        },
      )
    },

    async pdf(design, opts = {}) {
      if (opts.file) return renderPdf(design, opts.file, opts)

      const files = orderedArtboards(design)
      if (files.length === 0) {
        throw new PrintTargetError('this canvas has no artboards to print')
      }

      // Sequential on purpose: one browser, and a canvas of twenty artboards
      // rendered in parallel is a memory spike on exactly the small machines
      // this project is meant to run on.
      const parts: Uint8Array[] = []
      for (const file of files) {
        parts.push(await renderPdf(design, file, opts))
      }
      logger.debug({ design: design.id, artboards: files.length }, 'design canvas printed')
      return mergePdfs(parts)
    },
  }
}
