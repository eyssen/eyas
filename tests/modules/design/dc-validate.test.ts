// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { validateCanvas, hasTernaryInStyleAttribute, referencedImages, describeIssues } from '@modules/design/dc-validate'
import { MAX_FILES, MAX_ENTRY_BYTES } from '@modules/design/canvas-schema'

const artboard = (body = '<div>hi</div>') => `<!doctype html>
<html><head><meta charset="utf-8"><script src="./support.js"></script></head>
<body><x-dc><helmet><style>body{margin:0}</style></helmet>${body}</x-dc></body></html>`

const codes = (r: ReturnType<typeof validateCanvas>) => r.errors.map((e) => e.code)

function canvas(over: Record<string, unknown> = {}) {
  return JSON.stringify({ artboards: [{ file: 'Main.dc.html', x: 0, y: 0, w: 800, h: 600 }], ...over })
}

describe('validateCanvas — happy paths', () => {
  it('accepts a single-artboard canvas with no manifest', () => {
    const r = validateCanvas({ 'Main.dc.html': artboard() })
    expect(r.ok, describeIssues(r)).toBe(true)
  })

  it('accepts a full manifest with pages, annotations and launch', () => {
    const r = validateCanvas({
      'Main.dc.html': artboard(),
      'Pricing.dc.html': artboard(),
      'canvas.json': JSON.stringify({
        artboards: [
          { file: 'Main.dc.html', x: 0, y: 0, w: 800, h: 600, page: 'p1' },
          { file: 'Pricing.dc.html', x: 900, y: 0, w: 800, h: 600, page: 'p2', print: 'flow' },
        ],
        annotations: [{ id: 'note-1', x: 0, y: -140, w: 240, text: 'brief', page: 'p1', color: 'blue' }],
        pages: [{ id: 'p1', name: 'Flows' }, { id: 'p2', name: 'Print' }],
        launch: { view: 'canvas', page: 'p2' },
      }),
    })
    expect(r.ok, describeIssues(r)).toBe(true)
    expect(r.manifest!.pages).toHaveLength(2)
  })
})

describe('validateCanvas — structural refusals', () => {
  it('refuses an empty canvas and one with no artboards', () => {
    expect(validateCanvas({}).errors[0].code).toBe('empty')
    expect(codes(validateCanvas({ 'logo.png': 'x' }))).toContain('no-artboards')
  })

  it('refuses an artboard without an <x-dc> root', () => {
    expect(codes(validateCanvas({ 'Main.dc.html': '<html><body><div/></body></html>' }))).toContain('missing-x-dc')
  })

  it('refuses an empty data-dc-script', () => {
    const src = artboard() + '<script data-dc-script></script>'
    expect(codes(validateCanvas({ 'Main.dc.html': src }))).toContain('empty-logic')
  })

  it('refuses a bad artboard name and a path separator', () => {
    expect(codes(validateCanvas({ 'Main.dc.html': artboard(), 'nested/Bad.dc.html': artboard() }))).toContain('bad-artboard-name')
  })

  it('refuses case-insensitively duplicate stems', () => {
    const r = validateCanvas({ 'Card.dc.html': artboard(), 'card.dc.html': artboard() })
    expect(codes(r)).toContain('duplicate-stem')
  })

  it('warns when there is no Main artboard', () => {
    const r = validateCanvas({ 'Hero.dc.html': artboard() })
    expect(r.ok).toBe(true)
    expect(r.warnings.map((w) => w.code)).toContain('no-main')
  })

  it('refuses an over-large entry', () => {
    const r = validateCanvas({ 'Main.dc.html': artboard('x'.repeat(MAX_ENTRY_BYTES)) })
    expect(codes(r)).toContain('entry-too-large')
  })

  it('refuses more files than the editor loads', () => {
    const files: Record<string, string> = {}
    for (let i = 0; i <= MAX_FILES; i++) files[`A${i}.dc.html`] = artboard()
    expect(codes(validateCanvas(files))).toContain('too-many-files')
  })
})

describe('validateCanvas — the silent-failure traps', () => {
  it('refuses a ternary after a hole inside a style attribute', () => {
    const src = artboard('<div style="color: {{x}} ? red : blue">t</div>')
    expect(codes(validateCanvas({ 'Main.dc.html': src }))).toContain('style-ternary')
  })

  it('allows a ternary outside a style attribute', () => {
    const src = artboard('<div>{{x}} ? not a style : fine</div>')
    expect(validateCanvas({ 'Main.dc.html': src }).ok).toBe(true)
  })

  it('refuses an image reference with no matching files entry', () => {
    const src = artboard('<img src="logo.png">')
    const r = validateCanvas({ 'Main.dc.html': src })
    expect(codes(r)).toContain('missing-image')
    expect(validateCanvas({ 'Main.dc.html': src, 'logo.png': 'bytes' }).ok).toBe(true)
  })

  it('accepts ./-prefixed and CSS url() references', () => {
    const src = artboard('<img src="./a.png"><div style="background:url(./b.jpg)"></div>')
    expect(validateCanvas({ 'Main.dc.html': src, 'a.png': 'x', 'b.jpg': 'x' }).ok).toBe(true)
  })
})

describe('validateCanvas — canvas.json', () => {
  it('refuses unparseable JSON', () => {
    expect(codes(validateCanvas({ 'Main.dc.html': artboard(), 'canvas.json': '{ nope' }))).toContain('canvas-json-parse')
  })

  it('refuses a stray top-level key', () => {
    const r = validateCanvas({ 'Main.dc.html': artboard(), 'canvas.json': canvas({ mystery: true }) })
    expect(codes(r)).toContain('canvas-json-schema')
  })

  it('refuses an artboard entry that names a missing file', () => {
    const r = validateCanvas({
      'Main.dc.html': artboard(),
      'canvas.json': JSON.stringify({ artboards: [{ file: 'Ghost.dc.html', x: 0, y: 0, w: 1, h: 1 }] }),
    })
    expect(codes(r)).toContain('unknown-artboard-ref')
  })

  it('refuses a duplicate artboard reference', () => {
    const r = validateCanvas({
      'Main.dc.html': artboard(),
      'canvas.json': JSON.stringify({ artboards: [
        { file: 'Main.dc.html', x: 0, y: 0, w: 1, h: 1 },
        { file: 'Main.dc.html', x: 5, y: 5, w: 1, h: 1 },
      ] }),
    })
    expect(codes(r)).toContain('duplicate-artboard-ref')
  })

  it('refuses a page reference that is not listed', () => {
    const r = validateCanvas({
      'Main.dc.html': artboard(),
      'canvas.json': canvas({ artboards: [{ file: 'Main.dc.html', x: 0, y: 0, w: 1, h: 1, page: 'ghost' }] }),
    })
    expect(codes(r)).toContain('unknown-page-ref')
  })

  it('refuses a duplicate annotation id and a bad id shape', () => {
    const dup = validateCanvas({
      'Main.dc.html': artboard(),
      'canvas.json': canvas({ annotations: [
        { id: 'n1', x: 0, y: 0, w: 200, text: 'a' },
        { id: 'n1', x: 0, y: 0, w: 200, text: 'b' },
      ] }),
    })
    expect(codes(dup)).toContain('duplicate-note-id')

    const bad = validateCanvas({
      'Main.dc.html': artboard(),
      'canvas.json': canvas({ annotations: [{ id: 'has space', x: 0, y: 0, w: 200, text: 'a' }] }),
    })
    expect(codes(bad)).toContain('canvas-json-schema')
  })

  it('refuses a launch that targets a missing artboard or page', () => {
    expect(codes(validateCanvas({
      'Main.dc.html': artboard(),
      'canvas.json': canvas({ launch: { view: 'focused', file: 'Ghost.dc.html' } }),
    }))).toContain('bad-launch')

    expect(codes(validateCanvas({
      'Main.dc.html': artboard(),
      'canvas.json': canvas({ launch: { view: 'canvas', page: 'ghost' } }),
    }))).toContain('bad-launch')
  })

  it('refuses an unknown launch view', () => {
    const r = validateCanvas({
      'Main.dc.html': artboard(),
      'canvas.json': canvas({ launch: { view: 'grid' } }),
    })
    expect(codes(r)).toContain('canvas-json-schema')
  })

  it('warns, not errors, on overlapping frames', () => {
    const r = validateCanvas({
      'Main.dc.html': artboard(),
      'B.dc.html': artboard(),
      'canvas.json': JSON.stringify({ artboards: [
        { file: 'Main.dc.html', x: 0, y: 0, w: 500, h: 500 },
        { file: 'B.dc.html', x: 100, y: 100, w: 500, h: 500 },
      ] }),
    })
    expect(r.ok).toBe(true)
    expect(r.warnings.map((w) => w.code)).toContain('overlap')
  })
})

describe('helpers', () => {
  it('hasTernaryInStyleAttribute only looks inside style attributes', () => {
    expect(hasTernaryInStyleAttribute('<i style="a: {{x}} ? b : c">')).toBe(true)
    expect(hasTernaryInStyleAttribute('<i title="a: {{x}} ? b : c">')).toBe(false)
  })

  it('referencedImages ignores non-image srcs', () => {
    expect(referencedImages('<script src="./support.js"></script><img src="a.png">')).toEqual(['a.png'])
  })

  it('describeIssues renders path-prefixed lines', () => {
    const r = validateCanvas({ 'Main.dc.html': '<div/>' })
    expect(describeIssues(r)).toContain('Main.dc.html:')
  })
})
