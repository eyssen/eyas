// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { renderArtboard, ARTBOARD_CSP, ARTBOARD_SANDBOX, artboardStem } from '@modules/design/dc-render'

const source = (body = '<p>hi</p>', script = '') => `<!doctype html>
<html><head><script src="./support.js"></script></head>
<body><x-dc><helmet><style>body{margin:0}</style></helmet>${body}</x-dc>${script}</body></html>`

const render = (over: Record<string, unknown> = {}) =>
  renderArtboard({ artboard: { file: 'Main.dc.html', source: source() }, ...over } as any)

describe('the sandbox contract', () => {
  it('grants allow-scripts and NEVER allow-same-origin', () => {
    expect(ARTBOARD_SANDBOX).toContain('allow-scripts')
    expect(ARTBOARD_SANDBOX).not.toContain('allow-same-origin')
    expect(render().sandbox).toBe(ARTBOARD_SANDBOX)
  })

  it('forbids network egress and framing, and allows only Google Fonts', () => {
    expect(ARTBOARD_CSP).toContain("connect-src 'none'")
    expect(ARTBOARD_CSP).toContain("frame-src 'none'")
    expect(ARTBOARD_CSP).toContain("form-action 'none'")
    expect(ARTBOARD_CSP).toContain("base-uri 'none'")
    expect(ARTBOARD_CSP).toContain('https://fonts.googleapis.com')
    expect(ARTBOARD_CSP).toContain('https://fonts.gstatic.com')
    // No other host may appear anywhere in the policy.
    const hosts = ARTBOARD_CSP.match(/https?:\/\/[^\s;]+/g) ?? []
    expect(hosts.sort()).toEqual(['https://fonts.googleapis.com', 'https://fonts.gstatic.com'])
  })

  it('puts the CSP into the srcdoc itself', () => {
    expect(render().srcdoc).toContain(`<meta http-equiv="Content-Security-Policy" content="${ARTBOARD_CSP}">`)
  })
})

describe('spec serialisation', () => {
  it('escapes < so artboard source cannot close the spec script block', () => {
    const r = render({ artboard: { file: 'Main.dc.html', source: source('<p>a</p><!-- </script> --><b>b</b>') } })
    const between = r.srcdoc.slice(r.srcdoc.indexOf('id="dc-spec"'), r.srcdoc.indexOf('</script>', r.srcdoc.indexOf('id="dc-spec"')))
    expect(between).not.toContain('</script')
    expect(between).toContain('\\u003c')
  })

  it('carries the template, helmet and images through', () => {
    const r = render({ images: { 'logo.png': 'data:image/png;base64,AAA' } })
    expect(r.srcdoc).toContain('\\u003cp\\u003ehi')
    expect(r.srcdoc).toContain('data:image/png;base64,AAA')
  })
})

describe('props and siblings', () => {
  it('exposes the declared props spec for the tweak chips', () => {
    const r = render({
      artboard: {
        file: 'Main.dc.html',
        source: source('<h1 style="color: {{accent}}">x</h1>', `<script data-dc-script data-props='{"accent":{"editor":"color","default":"#b45309"}}'>class Component extends DCLogic { renderVals() { return { accent: this.props.accent } } }</script>`),
      },
    })
    expect(r.propsSpec.accent.editor).toBe('color')
  })

  it('carries $preview through as the frame size hint', () => {
    const r = render({
      artboard: {
        file: 'Main.dc.html',
        source: source('<p>x</p>', `<script data-dc-script data-props='{"$preview":{"width":390,"height":844}}'>class Component extends DCLogic {}</script>`),
      },
    })
    expect(r.preview).toEqual({ width: 390, height: 844 })
  })

  it('registers siblings by stem for dc-import', () => {
    const r = render({ siblings: { 'Card.dc.html': source('<span>card</span>') } })
    expect(r.srcdoc).toContain('"Card"')
  })

  it('skips a sibling that will not parse rather than failing the render', () => {
    const r = render({ siblings: { 'Broken.dc.html': '<html>no x-dc</html>' } })
    expect(r.srcdoc).not.toContain('"Broken"')
    expect(r.srcdoc).toContain('dc-root')
  })
})

describe('artboardStem', () => {
  it('strips the suffix and leaves other names alone', () => {
    expect(artboardStem('Card.dc.html')).toBe('Card')
    expect(artboardStem('logo.png')).toBe('logo.png')
  })
})
