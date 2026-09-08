// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseAppifactDoc, buildCanvasDocument } from '@modules/design/canvas-io'
import { renderArtboard } from '@modules/design/dc-render'
import { validateCanvas } from '@modules/design/dc-validate'

/**
 * Claude Design interoperability.
 *
 * The fixture is REAL output from the other tool's own seeder, reduced to its
 * state block — the part the importer reads. It exists so the compatibility
 * claim is a test rather than an assertion: if the container shape drifts, or
 * our validator starts refusing something the other tool accepts, this fails.
 *
 * The reverse direction (an EYAS canvas seeding cleanly over there) was
 * verified by running the helper against this canvas's files; it cannot be
 * automated here because the helper needs its 2.4 MB payload, which is not
 * ours to redistribute.
 */
const FIXTURE = resolve(__dirname, '../../fixtures/design/claude-design-seeded-canvas.html')

describe('a canvas seeded by the Claude Design helper', () => {
  const page = readFileSync(FIXTURE, 'utf8')

  it('imports with its title and every file', () => {
    const r = parseAppifactDoc(page)
    expect(r.message ?? '').toBe('')
    expect(r.ok).toBe(true)
    expect(r.title).toBe('EYAS Interop Check')
    expect(Object.keys(r.files!).sort()).toEqual(['Main.dc.html', 'Notes.dc.html', 'canvas.json'])
  })

  it('passes the EYAS validator with no errors', () => {
    const r = parseAppifactDoc(page)
    const v = validateCanvas(r.files!)
    expect(v.errors).toEqual([])
    expect(v.manifest!.artboards).toHaveLength(2)
    expect(v.manifest!.annotations).toHaveLength(1)
    expect(v.manifest!.launch).toEqual({ view: 'canvas' })
  })

  it('renders through the EYAS runtime, tweak chips and all', () => {
    const r = parseAppifactDoc(page)
    const rendered = renderArtboard({
      artboard: { file: 'Main.dc.html', source: r.files!['Main.dc.html'] },
      siblings: { 'Notes.dc.html': r.files!['Notes.dc.html'] },
    })
    expect(rendered.sandbox).toBe('allow-scripts')
    expect(rendered.sandbox).not.toContain('allow-same-origin')
    expect(rendered.propsSpec.accent.editor).toBe('color')
    expect(rendered.srcdoc).toContain('Content-Security-Policy')
  })

  it('round-trips back out into the same container shape', () => {
    const r = parseAppifactDoc(page)
    const doc = buildCanvasDocument(r.title!, r.files!)
    const back = parseAppifactDoc(`<script type="application/json" id="appifact-doc">\n${doc.trim()}\n</script>`)
    expect(back.ok).toBe(true)
    expect(back.files).toEqual(r.files)
  })
})
