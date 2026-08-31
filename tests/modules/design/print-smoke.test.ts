// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The only test here that launches a real browser. Skipped by default, because
// a checkout without a Chromium is a supported state and CI should not need
// one; run it with:
//
//   EYAS_PRINT_SMOKE=1 bun vitest run tests/modules/design/print-smoke.test.ts
//
// Everything it covers is covered logically elsewhere. What it adds is the one
// thing a unit test cannot: proof that Chromium actually renders the runtime,
// paginates a flow artboard, and honours the page sizes we compute.

import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PDFDocument } from 'pdf-lib'
import { createMemoryDb } from '../../helpers/test-db'
import { createHeadlessBrowser } from '@shared/headless-browser'
import { createDesignTables } from '@modules/design/schema'
import { createDesignStore } from '@modules/design/design-store'
import { createDesignService } from '@modules/design/design-service'
import { createPrintService } from '@modules/design/print-service'
import type { Design } from '@modules/design/types'

const ENABLED = process.env.EYAS_PRINT_SMOKE === '1'

const FIXED = `<!doctype html>
<html><head><script src="./support.js"></script></head>
<body>
<x-dc>
<helmet><style>
  body { margin: 0; font-family: Georgia, serif; }
  .card { width: 400px; height: 300px; background: #123456; color: #fff;
          display: flex; align-items: center; justify-content: center; font-size: 32px; }
</style></helmet>
<div class="card">{{heading}}</div>
</x-dc>
<script data-dc-script data-props='{"heading": {"default": "Poster", "editor": "text"}}'>
class Component extends DCLogic {
  renderVals() { return { heading: this.props.heading } }
}
</script>
</body></html>`

// Enough paragraphs that A4 cannot hold them on one page.
const FLOW = `<!doctype html>
<html><head><script src="./support.js"></script></head>
<body>
<x-dc>
<helmet><style>
  body { margin: 0; font-family: Georgia, serif; }
  p { font-size: 18px; line-height: 1.8; margin: 0 0 18px; }
</style></helmet>
<div>
  <sc-for list="{{paragraphs}}" as="para">
    <p>{{para}}</p>
  </sc-for>
</div>
</x-dc>
<script data-dc-script data-props='{}'>
class Component extends DCLogic {
  renderVals() {
    var out = [];
    for (var i = 0; i < 120; i++) {
      out.push('Paragraph ' + (i + 1) + ' — ' + 'the quick brown fox jumps over the lazy dog. '.repeat(4));
    }
    return { paragraphs: out };
  }
}
</script>
</body></html>`

function design(): Design {
  const manifest = {
    artboards: [
      { file: 'Poster.dc.html', x: 0, y: 0, w: 400, h: 300 },
      { file: 'Report.dc.html', x: 0, y: 500, w: 680, h: 900, print: 'flow' as const },
    ],
  }
  return {
    id: 'smoke', title: 'Smoke', slug: 'smoke', kind: 'print', tags: [], currentVersion: 1,
    createdAt: '', updatedAt: '',
    files: { 'Poster.dc.html': FIXED, 'Report.dc.html': FLOW, 'canvas.json': JSON.stringify(manifest) },
    manifest,
    artboards: ['Poster.dc.html', 'Report.dc.html'],
  }
}

/** Width and height straight out of the PNG IHDR chunk. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

const browser = createHeadlessBrowser({ idleMs: 5_000 })
const logger = { info() {}, warn() {}, error() {}, debug() {} } as any
const print = createPrintService({ browser, logger })

afterAll(async () => { await browser.close() })

describe.skipIf(!ENABLED)('print smoke — a real Chromium', () => {
  it('has a browser at all', async () => {
    const status = await browser.status()
    expect(status.available, `${status.reason ?? ''} ${status.remediation ?? ''}`).toBe(true)
  }, 60_000)

  it('renders a fixed artboard to a PNG of exactly its frame', async () => {
    const bytes = await print.png(design(), 'Poster.dc.html')
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(pngSize(bytes)).toEqual({ width: 400, height: 300 })
  }, 60_000)

  it('doubles the pixels for a retina PNG without changing the layout', async () => {
    const bytes = await print.png(design(), 'Poster.dc.html', { scale: 2 })
    expect(pngSize(bytes)).toEqual({ width: 800, height: 600 })
  }, 60_000)

  it('prints a fixed artboard as ONE page at its natural size', async () => {
    const doc = await PDFDocument.load(await print.pdf(design(), { file: 'Poster.dc.html' }))
    expect(doc.getPageCount()).toBe(1)
    // 96 css px per inch, 72 pt per inch: 400px = 300pt, 300px = 225pt.
    expect(Math.round(doc.getPage(0).getWidth())).toBe(300)
    expect(Math.round(doc.getPage(0).getHeight())).toBe(225)
  }, 60_000)

  it('paginates a flow artboard across A4 pages', async () => {
    const doc = await PDFDocument.load(await print.pdf(design(), { file: 'Report.dc.html' }))
    expect(doc.getPageCount()).toBeGreaterThan(1)
    // A4 is 595.28pt wide; Chromium's own A4 constant lands a fraction over.
    expect(doc.getPage(0).getWidth()).toBeGreaterThan(593)
    expect(doc.getPage(0).getWidth()).toBeLessThan(598)
  }, 120_000)

  it('concatenates the canvas keeping each artboard at its own page size', async () => {
    const doc = await PDFDocument.load(await print.pdf(design()))
    expect(doc.getPageCount()).toBeGreaterThan(2)
    expect(Math.round(doc.getPage(0).getWidth())).toBe(300) // the poster
    expect(doc.getPage(1).getWidth()).toBeGreaterThan(593) // the report's first A4 page
  }, 120_000)

  it('refuses an artboard whose logic throws, instead of printing a blank page', async () => {
    const broken = design()
    broken.files['Poster.dc.html'] = FIXED.replace(
      'return { heading: this.props.heading }',
      'return nope.missing.thing',
    )
    await expect(print.pdf(broken, { file: 'Poster.dc.html' })).rejects.toThrow(/did not render/)
  }, 60_000)
})

describe.skipIf(!ENABLED)('print smoke — through the real service', () => {
  // The unit tests hand the print service a Design object built by hand. This
  // one goes the whole way: the file-tree store on disk, the validator gate,
  // and a design read back out of the service — the path a user's export takes.
  it('exports a design that was created through the design service', async () => {
    const root = mkdtempSync(join(tmpdir(), 'eyas-printsmoke-'))
    try {
      const db = createMemoryDb()
      createDesignTables(db)
      const designs = createDesignService(db, createDesignStore(join(root, 'designs')))

      const created = designs.create({
        title: 'Smoke brochure',
        kind: 'print',
        files: {
          'Main.dc.html': FIXED,
          'Report.dc.html': FLOW,
          'canvas.json': JSON.stringify({
            artboards: [
              { file: 'Main.dc.html', x: 0, y: 0, w: 400, h: 300 },
              { file: 'Report.dc.html', x: 0, y: 500, w: 680, h: 900, print: 'flow' },
            ],
          }),
        },
      })

      const stored = designs.get(created.id)!
      const doc = await PDFDocument.load(await print.pdf(stored))
      expect(doc.getPageCount()).toBeGreaterThan(2)
      expect(Math.round(doc.getPage(0).getWidth())).toBe(300)

      const png = await print.png(stored, 'Main.dc.html')
      expect(pngSize(png)).toEqual({ width: 400, height: 300 })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 120_000)
})
