// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { parseAppifactDoc, buildCanvasDocument, buildStandalonePage } from '@modules/design/canvas-io'

const artboard = '<x-dc><helmet><style>body{margin:0}</style></helmet><p>hi</p></x-dc>'

function page(state: unknown, opener = '<script type="application/json" id="appifact-doc">') {
  return `<!doctype html><html><head></head><body>
${opener}
${JSON.stringify(state)}
</script>
<script>/* the editor payload would be here */</script>
</body></html>`
}

const validState = (over: Record<string, unknown> = {}) => ({
  title: 'Spring Menu Poster',
  content: { files: { 'Main.dc.html': artboard } },
  ...over,
})

describe('parseAppifactDoc', () => {
  it('extracts the title and files from a published page', () => {
    const r = parseAppifactDoc(page(validState()))
    expect(r.ok).toBe(true)
    expect(r.title).toBe('Spring Menu Poster')
    expect(Object.keys(r.files!)).toEqual(['Main.dc.html'])
  })

  it('tolerates a data-id attribute on the state block', () => {
    const r = parseAppifactDoc(page(validState(), '<script type="application/json" id="appifact-doc" data-id="abcdefgh12345678">'))
    expect(r.ok).toBe(true)
  })

  it('reports a page with no state block', () => {
    const r = parseAppifactDoc('<html><body>nothing</body></html>')
    expect(r.ok).toBe(false)
    expect(r.message).toContain('no appifact-doc state block')
  })

  it('reports a truncated / unparseable state block', () => {
    const r = parseAppifactDoc('<script type="application/json" id="appifact-doc">\n{ "title": \n</script>')
    expect(r.ok).toBe(false)
    expect(r.message).toContain('does not parse')
  })

  it('refuses a live-store page rather than importing a stale seed', () => {
    const r = parseAppifactDoc(page(validState({ store: 'db' })))
    expect(r.ok).toBe(false)
    expect(r.message).toContain('live store')
  })

  it('reports a state block with no content.files', () => {
    expect(parseAppifactDoc(page({ title: 'x' })).message).toContain('no content.files')
  })

  it('notes dropped comments instead of silently losing them', () => {
    const r = parseAppifactDoc(page(validState({ comments: [{ id: 1 }, { id: 2 }] })))
    expect(r.ok).toBe(true)
    expect(r.notes.join(' ')).toContain('2 comment(s) were dropped')
  })

  it('refuses an unsafe file name', () => {
    const r = parseAppifactDoc(page({ title: 'x', content: { files: { '../evil.dc.html': artboard } } }))
    expect(r.ok).toBe(false)
    expect(r.message).toContain('unsafe file name')
  })

  it('skips a non-string entry with a note', () => {
    const r = parseAppifactDoc(page({ title: 'x', content: { files: { 'Main.dc.html': artboard, 'weird.dc.html': 42 } } }))
    expect(r.ok).toBe(true)
    expect(r.notes.join(' ')).toContain('not a string')
  })

  it('runs the validator and refuses an invalid canvas', () => {
    const r = parseAppifactDoc(page({ title: 'x', content: { files: { 'Main.dc.html': '<div>no root</div>' } } }))
    expect(r.ok).toBe(false)
    expect(r.validation!.errors.map((e) => e.code)).toContain('missing-x-dc')
  })

  it('surfaces validator warnings as notes on a successful import', () => {
    const r = parseAppifactDoc(page({ title: 'x', content: { files: { 'Hero.dc.html': artboard } } }))
    expect(r.ok).toBe(true)
    expect(r.notes.join(' ')).toContain('entry artboard falls back')
  })
})

describe('buildCanvasDocument', () => {
  it('round-trips through parseAppifactDoc', () => {
    const doc = buildCanvasDocument('Round trip', { 'Main.dc.html': artboard })
    const r = parseAppifactDoc(`<script type="application/json" id="appifact-doc">\n${doc.trim()}\n</script>`)
    expect(r.ok).toBe(true)
    expect(r.title).toBe('Round trip')
    expect(r.files!['Main.dc.html']).toBe(artboard)
  })
})

describe('buildStandalonePage', () => {
  const frames = [
    { file: 'Main.dc.html', srcdoc: '<html><body>"quoted" & <b>bold</b></body></html>', sandbox: 'allow-scripts', x: 0, y: 0, w: 800, h: 600 },
  ]

  it('embeds each artboard as a sandboxed iframe', () => {
    const html = buildStandalonePage('Deck', frames)
    expect(html).toContain('sandbox="allow-scripts"')
    expect(html).not.toContain('allow-same-origin')
    expect(html).toContain('srcdoc="')
  })

  it('escapes the srcdoc so quotes cannot break out of the attribute', () => {
    const html = buildStandalonePage('Deck', frames)
    expect(html).toContain('&quot;quoted&quot;')
    expect(html).toContain('&lt;b&gt;bold')
  })

  it('sizes the canvas to fit the frames', () => {
    const html = buildStandalonePage('Deck', [{ ...frames[0], x: 1000, y: 500, w: 400, h: 300 }])
    expect(html).toContain('width: 1480px')
    expect(html).toContain('height: 880px')
  })

  it('escapes the title', () => {
    expect(buildStandalonePage('<script>x</script>', frames)).toContain('&lt;script&gt;')
  })
})
