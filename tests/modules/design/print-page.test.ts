// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { ARTBOARD_CSP, buildArtboardSpec } from '@modules/design/dc-render'
import { buildPrintDocument } from '@modules/design/print-page'
import { DC_RUNTIME_SOURCE } from '@modules/design/dc-runtime-source'

const SOURCE = `<!doctype html>
<html><head><script src="./support.js"></script></head>
<body>
<x-dc>
<helmet><style>body { font-family: Georgia, serif }</style></helmet>
<h1>{{title}}</h1>
</x-dc>
<script data-dc-script data-props='{"title": {"default": "Hello"}}'>
class Component extends DCLogic { renderVals() { return { title: this.props.title } } }
</script>
</body></html>`

function specOf(source = SOURCE) {
  return buildArtboardSpec({ artboard: { file: 'Main.dc.html', source } }).spec
}

describe('buildPrintDocument — shared with the preview', () => {
  it('carries the same CSP as the sandboxed preview, so the two cannot drift', () => {
    const html = buildPrintDocument({ spec: specOf(), mode: 'fixed', width: 794, height: 1123 })
    expect(html).toContain(ARTBOARD_CSP)
  })

  it('embeds the runtime exactly once', () => {
    const html = buildPrintDocument({ spec: specOf(), mode: 'fixed', width: 400, height: 300 })
    const marker = 'window.__dcMountArtboard ='
    expect(html.split(marker).length - 1).toBe(1)
    expect(html).toContain(DC_RUNTIME_SOURCE.slice(0, 80))
  })

  it('escapes the spec so an artboard that contains </script> cannot truncate the page', () => {
    // This is the exact failure the Claude Design interop round-trip caught in
    // the canvas document builder. The print document is the second place the
    // same JSON gets inlined.
    const nasty = SOURCE.replace('<h1>{{title}}</h1>', '<h1>a</script><b>b</b></h1>')
    const html = buildPrintDocument({ spec: specOf(nasty), mode: 'fixed', width: 100, height: 100 })
    const jsonBlock = html.slice(
      html.indexOf('id="dc-spec">') + 'id="dc-spec">'.length,
      html.indexOf('</script>', html.indexOf('id="dc-spec">')),
    )
    expect(jsonBlock).not.toContain('</script')
    expect(jsonBlock).toContain('\\u003c')
    expect(JSON.parse(jsonBlock.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>')).template).toContain('</script>')
  })
})

describe('buildPrintDocument — fixed', () => {
  const html = buildPrintDocument({ spec: specOf(), mode: 'fixed', width: 794, height: 1123 })

  it('pins the page box to the artboard frame', () => {
    expect(html).toContain('width: 794px')
    expect(html).toContain('height: 1123px')
  })

  it('clips, so a sub-pixel overflow cannot spill onto a blank second page', () => {
    expect(html).toMatch(/#dc-page\s*\{[^}]*overflow:\s*hidden/)
  })

  it('asks the browser to keep backgrounds, which is off by default when printing', () => {
    expect(html).toContain('print-color-adjust: exact')
  })
})

describe('buildPrintDocument — flow', () => {
  const html = buildPrintDocument({ spec: specOf(), mode: 'flow', width: 680 })

  it('sets the column width and centres it', () => {
    expect(html).toMatch(/#dc-page\s*\{[^}]*width:\s*680px/)
    expect(html).toMatch(/#dc-page\s*\{[^}]*margin:\s*0 auto/)
  })

  it('never clips, because clipping is what stops pagination', () => {
    expect(html).not.toMatch(/#dc-page\s*\{[^}]*overflow:\s*hidden/)
  })

  it('does not pin a page height', () => {
    expect(html).not.toMatch(/html,\s*body\s*\{[^}]*height:\s*\d/)
  })
})

describe('buildPrintDocument — readiness', () => {
  it('flags the document ready once the artboard has mounted', () => {
    const html = buildPrintDocument({ spec: specOf(), mode: 'fixed', width: 100, height: 100 })
    expect(html).toContain('data-dc-ready')
  })

  it('records a mount failure on the document instead of printing a blank page', () => {
    const html = buildPrintDocument({ spec: specOf(), mode: 'fixed', width: 100, height: 100 })
    expect(html).toContain('data-dc-error')
    expect(html).toMatch(/catch\s*\(/)
  })
})
