// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { buildDesignIndex, renderDesignAnnouncement, renderDesignPart, classifyArtboard } from '@modules/design/design-index'
import type { Design } from '@modules/design/types'

const artboard = (body: string, helmet = '') =>
  `<!doctype html><html><head><script src="./support.js"></script></head><body>
<x-dc>${helmet ? `<helmet><style>${helmet}</style></helmet>` : ''}${body}</x-dc>
</body></html>`

function design(files: Record<string, string>, manifest: any = {}): Design {
  return {
    id: 'd1', title: 'Odoo', slug: 'odoo', kind: 'freeform',
    tags: [], currentVersion: 2, createdAt: '', updatedAt: '',
    files, manifest,
    artboards: Object.keys(files).filter((f) => f.endsWith('.dc.html')).sort(),
  } as Design
}

describe('classifyArtboard — one vocabulary for every design', () => {
  it('reads the canvas title first, because that is what a human wrote', () => {
    expect(classifyArtboard('X.dc.html', 'SCSS Token referencia', '')).toBe('tokens')
    expect(classifyArtboard('X.dc.html', 'Tipográfia', '')).toBe('typography')
    expect(classifyArtboard('X.dc.html', 'Gombok & Űrlapelemek', '')).toBe('components')
    expect(classifyArtboard('X.dc.html', 'UI minták', '')).toBe('patterns')
  })

  it('works in English too', () => {
    expect(classifyArtboard('X.dc.html', 'Colour tokens', '')).toBe('tokens')
    expect(classifyArtboard('X.dc.html', 'Type scale', '')).toBe('typography')
    expect(classifyArtboard('X.dc.html', 'Buttons and inputs', '')).toBe('components')
    expect(classifyArtboard('X.dc.html', 'Landing page', '')).toBe('page')
  })

  it('falls back to the file name when there is no title', () => {
    expect(classifyArtboard('Tokens.dc.html', undefined, '')).toBe('tokens')
    expect(classifyArtboard('Components.dc.html', undefined, '')).toBe('components')
  })

  it('says "other" rather than guessing', () => {
    expect(classifyArtboard('Zebra.dc.html', 'Zebra', '')).toBe('other')
  })
})

describe('buildDesignIndex', () => {
  const d = design({
    'Tokens.dc.html': artboard('<h2>SCSS Token referencia</h2><p style="color:#71639e">a</p><p style="color:#71639e">b</p><p style="color:#017e84">c</p>'),
    'Typography.dc.html': artboard('<h2>Tipográfia</h2><h3>Fejléc skála</h3>', "body{font-family:'Playfair Display',serif}"),
    'Zebra.dc.html': artboard('<div>nothing in particular</div>'),
    'canvas.json': JSON.stringify({ artboards: [
      { file: 'Tokens.dc.html', x: 0, y: 0, w: 780, h: 1100, title: 'SCSS Token referencia' },
      { file: 'Typography.dc.html', x: 0, y: 0, w: 640, h: 720, title: 'Tipográfia' },
    ] }),
  }, { artboards: [
    { file: 'Tokens.dc.html', x: 0, y: 0, w: 780, h: 1100, title: 'SCSS Token referencia' },
    { file: 'Typography.dc.html', x: 0, y: 0, w: 640, h: 720, title: 'Tipográfia' },
  ] })

  it('gives every artboard a role, a title and a size', () => {
    const idx = buildDesignIndex(d)
    const tokens = idx.artboards.find((a) => a.file === 'Tokens.dc.html')!
    expect(tokens.role).toBe('tokens')
    expect(tokens.title).toBe('SCSS Token referencia')
    expect(tokens.chars).toBeGreaterThan(0)
  })

  it('takes the title from the artboard heading when the canvas has none', () => {
    const idx = buildDesignIndex(d)
    expect(idx.artboards.find((a) => a.file === 'Zebra.dc.html')!.title).toBe('Zebra')
  })

  it('reports the colours an artboard actually defines, most-used first', () => {
    const idx = buildDesignIndex(d)
    const tokens = idx.artboards.find((a) => a.file === 'Tokens.dc.html')!
    expect(tokens.colours[0]).toBe('#71639e')
    expect(tokens.colours).toContain('#017e84')
  })

  it('reports the typefaces', () => {
    const idx = buildDesignIndex(d)
    expect(idx.artboards.find((a) => a.file === 'Typography.dc.html')!.fonts).toContain('Playfair Display')
  })

  it('orders the roles so the reusable ones come first', () => {
    // An agent looking for "what colour is a primary button" should meet
    // tokens and typography before a landing page.
    const idx = buildDesignIndex(d)
    expect(idx.artboards.map((a) => a.role).slice(0, 2)).toEqual(['tokens', 'typography'])
  })

  it('ignores canvas.json and images', () => {
    const withImage = design({ ...d.files, 'logo.png': 'AAAA' }, d.manifest)
    expect(buildDesignIndex(withImage).artboards.map((a) => a.file)).not.toContain('logo.png')
  })
})

describe('renderDesignAnnouncement — presence and shape, never content', () => {
  // Named for their roles, which is how classifyArtboard reads them — it uses
  // the file stem and the title, never the body (a body that mentions
  // "pattern" proves nothing). design-prompt.ts teaches this naming.
  const d = design({
    'Tokens.dc.html': artboard('<h2>Tokens</h2><p style="color:#71639e;font-family:SFMono-Regular">x</p>'),
    'Patterns.dc.html': artboard('<h2>UI</h2>' + '<p>x</p>'.repeat(400)),
  })
  const out = () => renderDesignAnnouncement(d, buildDesignIndex(d))

  it('tells the agent to use the design, not merely that one exists', () => {
    expect(out()).toMatch(/follow this design|use this design/i)
  })

  it('says which PARTS exist and what kind of data each holds', () => {
    const text = out()
    expect(text).toContain('tokens')
    expect(text).toContain('colours')       // the KIND of data
    expect(text).toContain('patterns')
  })

  it('hands over no values at all', () => {
    // The point of the change: announce, then fetch. A colour in the
    // announcement is a value every turn pays for whether it is used or not.
    const text = out()
    expect(text).not.toContain('#71639e')
    expect(text).not.toContain('SFMono')
  })

  it('names both fetches — a part, and an artboard for markup', () => {
    const text = out()
    expect(text).toContain('design_read')
    expect(text).toContain('part')
    expect(text).toContain('file')
    expect(text).toContain('d1')
  })

  it('stays flat as the design grows', () => {
    // Per-turn cost must not scale with the canvas. Twenty artboards fold into
    // the same handful of role lines as two.
    const files: Record<string, string> = {}
    for (let n = 0; n < 20; n++) files[`Comp${n}.dc.html`] = artboard(`<h2>Components ${n}</h2><p style="color:#00000${n % 10}">x</p>`)
    const big = design(files)
    expect(renderDesignAnnouncement(big, buildDesignIndex(big)).length).toBeLessThan(900)
    expect(out().length).toBeLessThan(900)
  })

  it('is still an index, never the source', () => {
    expect(out()).not.toContain('<x-dc>')
  })
})

describe('renderDesignPart — what a fetch actually returns', () => {
  const d = design({
    'Tokens.dc.html': artboard('<h2>Tokens</h2><p style="color:#71639e;font-family:SFMono-Regular">x</p>'),
    'Components.dc.html': artboard('<h2>Gombok</h2><button style="background:#28a745">ok</button>'),
  })

  it('returns the derived values for the requested role only', () => {
    const tokens = renderDesignPart(d, buildDesignIndex(d), 'tokens')!
    expect(tokens).toContain('#71639e')
    expect(tokens).toContain('Tokens.dc.html')
    // and nothing from another role
    expect(tokens).not.toContain('#28a745')
  })

  it('points at the file when the answer is markup', () => {
    const components = renderDesignPart(d, buildDesignIndex(d), 'components')!
    expect(components).toContain('Components.dc.html')
    expect(components).toMatch(/read .*file|for the markup/i)
  })

  it('returns null for a role this design has nothing in', () => {
    expect(renderDesignPart(d, buildDesignIndex(d), 'page')).toBeNull()
  })
})
