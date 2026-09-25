// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { BrowserUnavailableError } from '@shared/playwright-loader'
import type { HeadlessBrowser, PageOptions } from '@shared/headless-browser'
import { FONT_ORIGINS } from '@modules/design/dc-render'
import { createPrintService, orderedArtboards, PrintRenderError, PrintTargetError } from '@modules/design/print-service'
import type { Design } from '@modules/design/types'

function artboard(label: string): string {
  return `<!doctype html>
<html><head><script src="./support.js"></script></head>
<body><x-dc><div>${label}</div></x-dc></body></html>`
}

function design(overrides: Partial<Design> = {}): Design {
  const files: Record<string, string> = {
    'Main.dc.html': artboard('main'),
    'Second.dc.html': artboard('second'),
    'canvas.json': JSON.stringify({
      artboards: [
        { file: 'Second.dc.html', x: 0, y: 400, w: 300, h: 200 },
        { file: 'Main.dc.html', x: 0, y: 0, w: 794, h: 1123 },
      ],
    }),
  }
  return {
    id: 'd1', title: 'Brochure', slug: 'brochure', kind: 'print', tags: [], currentVersion: 1,
    createdAt: '2026-08-26', updatedAt: '2026-08-26',
    files,
    manifest: JSON.parse(files['canvas.json']),
    artboards: ['Main.dc.html', 'Second.dc.html'],
    ...overrides,
  }
}

async function onePagePdf(widthPt: number, heightPt: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([widthPt, heightPt])
  return doc.save()
}

interface Recorded { html: string; opts: PageOptions; pdf?: any; screenshot?: any }

/**
 * The mounted artboard, read back out of the document's spec block.
 *
 * Needed because every print document also carries its SIBLINGS' templates —
 * that is what makes <dc-import> work — so searching the raw HTML for an
 * artboard's text finds it in every document on the canvas.
 */
function mountedSpec(html: string): any {
  const open = html.indexOf('id="dc-spec">') + 'id="dc-spec">'.length
  const json = html.slice(open, html.indexOf('</script>', open))
  return JSON.parse(json.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>'))
}

function fakeBrowser(produce: (call: Recorded) => Promise<Uint8Array>): {
  browser: HeadlessBrowser
  calls: Recorded[]
} {
  const calls: Recorded[] = []
  const browser: HeadlessBrowser = {
    async status() { return { available: true } },
    async close() {},
    async withPage(opts, fn) {
      const record: Recorded = { html: '', opts }
      calls.push(record)
      const page = {
        async setContent(html: string) { record.html = html },
        async waitForFunction() { return true },
        async getAttribute() { return null },
        async textContent() { return null },
        async evaluate() { return true },
        async pdf(o: any) { record.pdf = o; return Buffer.from(await produce(record)) },
        async screenshot(o: any) { record.screenshot = o; return Buffer.from(await produce(record)) },
        setDefaultTimeout() {},
      }
      return fn(page) as any
    },
  }
  return { browser, calls }
}

const logger = { info() {}, warn() {}, error() {}, debug() {} } as any

describe('orderedArtboards', () => {
  it('follows the canvas placement, not the alphabet', () => {
    // Second is placed BELOW Main, so it must come second even though its name
    // sorts first in the store's ordering.
    expect(orderedArtboards(design())).toEqual(['Main.dc.html', 'Second.dc.html'])
  })

  it('orders by page, then down, then across', () => {
    const files = {
      'A.dc.html': artboard('a'), 'B.dc.html': artboard('b'),
      'C.dc.html': artboard('c'), 'D.dc.html': artboard('d'),
    }
    const manifest = {
      pages: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }],
      artboards: [
        { file: 'D.dc.html', x: 0, y: 0, w: 10, h: 10, page: 'p2' },
        { file: 'C.dc.html', x: 500, y: 0, w: 10, h: 10, page: 'p1' },
        { file: 'B.dc.html', x: 0, y: 0, w: 10, h: 10, page: 'p1' },
        { file: 'A.dc.html', x: 0, y: -100, w: 10, h: 10, page: 'p1' },
      ],
    }
    const d = design({ files: files as any, manifest: manifest as any, artboards: Object.keys(files).sort() })
    expect(orderedArtboards(d)).toEqual(['A.dc.html', 'B.dc.html', 'C.dc.html', 'D.dc.html'])
  })

  it('appends artboards the canvas never placed', () => {
    const d = design()
    d.files['Zebra.dc.html'] = artboard('z')
    d.artboards = ['Main.dc.html', 'Second.dc.html', 'Zebra.dc.html']
    expect(orderedArtboards(d)).toEqual(['Main.dc.html', 'Second.dc.html', 'Zebra.dc.html'])
  })
})

describe('print service — targeting', () => {
  it('rejects an artboard the design does not have', async () => {
    const { browser } = fakeBrowser(async () => onePagePdf(100, 100))
    const svc = createPrintService({ browser, logger })
    await expect(svc.png(design(), 'Nope.dc.html')).rejects.toBeInstanceOf(PrintTargetError)
  })

  it('rejects a non-artboard file', async () => {
    const { browser } = fakeBrowser(async () => onePagePdf(100, 100))
    const svc = createPrintService({ browser, logger })
    await expect(svc.png(design(), 'canvas.json')).rejects.toBeInstanceOf(PrintTargetError)
  })

  it('refuses to hand back a blank page when the artboard failed to mount', async () => {
    const { browser } = fakeBrowser(async () => onePagePdf(100, 100))
    // Override getAttribute to report the runtime's own failure marker.
    const failing: HeadlessBrowser = {
      ...browser,
      async withPage(_opts, fn) {
        return fn({
          async setContent() {}, async waitForFunction() { return true },
          async getAttribute() { return 'Cannot read properties of undefined' },
          async textContent() { return 'renderVals() threw: nope is not defined' },
          async evaluate() { return true },
          async pdf() { return Buffer.alloc(0) }, async screenshot() { return Buffer.alloc(0) },
          setDefaultTimeout() {},
        }) as any
      },
    }
    const svc = createPrintService({ browser: failing, logger })
    await expect(svc.pdf(design(), { file: 'Main.dc.html' })).rejects.toBeInstanceOf(PrintRenderError)
  })

  it('passes an unavailable browser straight through', async () => {
    const unavailable: HeadlessBrowser = {
      async status() { return { available: false, reason: 'none' } },
      async close() {},
      async withPage() { throw new BrowserUnavailableError('none') },
    }
    const svc = createPrintService({ browser: unavailable, logger })
    await expect(svc.png(design(), 'Main.dc.html')).rejects.toBeInstanceOf(BrowserUnavailableError)
    expect((await svc.status()).available).toBe(false)
  })
})

describe('print service — one artboard', () => {
  it('prints a fixed artboard at its own size, on one page', async () => {
    const { browser, calls } = fakeBrowser(async () => onePagePdf(595, 842))
    const svc = createPrintService({ browser, logger })
    await svc.pdf(design(), { file: 'Main.dc.html' })
    expect(calls).toHaveLength(1)
    expect(calls[0].pdf).toMatchObject({ width: '794px', height: '1123px', pageRanges: '1' })
  })

  it('fences the page to the two font origins and nothing else', async () => {
    const { browser, calls } = fakeBrowser(async () => onePagePdf(100, 100))
    const svc = createPrintService({ browser, logger })
    await svc.pdf(design(), { file: 'Main.dc.html' })
    expect(calls[0].opts.allowOrigins).toEqual([...FONT_ORIGINS])
  })

  it('mounts the artboard asked for, and carries its siblings only as imports', async () => {
    const { browser, calls } = fakeBrowser(async () => onePagePdf(100, 100))
    const svc = createPrintService({ browser, logger })
    await svc.png(design(), 'Second.dc.html')
    const spec = mountedSpec(calls[0].html)
    expect(spec.template).toContain('second')
    expect(spec.template).not.toContain('main')
    expect(spec.imports.Main.template).toContain('main')
  })

  it('takes a retina PNG through the context, not the screenshot call', async () => {
    const { browser, calls } = fakeBrowser(async () => onePagePdf(100, 100))
    const svc = createPrintService({ browser, logger })
    await svc.png(design(), 'Main.dc.html', { scale: 2 })
    expect(calls[0].opts.deviceScaleFactor).toBe(2)
    expect(calls[0].screenshot).toMatchObject({ type: 'png' })
  })
})

describe('print service — the whole canvas', () => {
  it('renders every artboard, in canvas order, and concatenates the pages', async () => {
    // Keyed on the viewport the service asked for, which is the artboard's own
    // canvas frame: Main is 794 wide, Second is 300.
    const { browser, calls } = fakeBrowser(async (call) =>
      call.opts.viewport!.width === 794 ? onePagePdf(595, 842) : onePagePdf(300, 200),
    )
    const svc = createPrintService({ browser, logger })
    const merged = await svc.pdf(design())

    expect(calls).toHaveLength(2)
    const doc = await PDFDocument.load(merged)
    expect(doc.getPageCount()).toBe(2)
    // Order is the assertion: Main is placed above Second on the canvas, so its
    // page must come first even though the fake could have produced either.
    expect(Math.round(doc.getPage(0).getWidth())).toBe(595)
    expect(Math.round(doc.getPage(1).getWidth())).toBe(300)
  })

  it('keeps each artboard at its own page size rather than forcing one paper', async () => {
    const { browser } = fakeBrowser(async (call) =>
      call.opts.viewport!.width === 794 ? onePagePdf(595, 842) : onePagePdf(300, 200),
    )
    const svc = createPrintService({ browser, logger })
    const doc = await PDFDocument.load(await svc.pdf(design()))
    expect(Math.round(doc.getPage(0).getHeight())).toBe(842)
    expect(Math.round(doc.getPage(1).getHeight())).toBe(200)
  })

  it('carries a multi-page flow artboard through the merge intact', async () => {
    const files = { 'Report.dc.html': artboard('report') }
    const d = design({
      files: { ...files, 'canvas.json': JSON.stringify({ artboards: [{ file: 'Report.dc.html', x: 0, y: 0, w: 680, h: 900, print: 'flow' }] }) },
      manifest: { artboards: [{ file: 'Report.dc.html', x: 0, y: 0, w: 680, h: 900, print: 'flow' }] },
      artboards: ['Report.dc.html'],
    })
    const { browser, calls } = fakeBrowser(async () => {
      const doc = await PDFDocument.create()
      doc.addPage([595, 842]); doc.addPage([595, 842]); doc.addPage([595, 842])
      return doc.save()
    })
    const svc = createPrintService({ browser, logger })
    const merged = await PDFDocument.load(await svc.pdf(d))
    expect(merged.getPageCount()).toBe(3)
    expect(calls[0].pdf).toMatchObject({ format: 'A4' })
    expect(calls[0].pdf.pageRanges).toBeUndefined()
  })

  it('refuses a canvas with no artboards rather than emitting an empty PDF', async () => {
    const { browser } = fakeBrowser(async () => onePagePdf(100, 100))
    const svc = createPrintService({ browser, logger })
    const empty = design({ files: { 'canvas.json': '{}' }, manifest: {}, artboards: [] })
    await expect(svc.pdf(empty)).rejects.toBeInstanceOf(PrintTargetError)
  })
})
