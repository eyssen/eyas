// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/print-page.ts
//
// The document an artboard is printed from.
//
// Why this is not the preview's srcdoc: Chromium will not paginate content
// inside an iframe. It lays the frame out as a fixed box and clips whatever
// overflows, so a `print: 'flow'` artboard in a frame would come out as one
// page with the rest of the document missing. Printing therefore puts the
// artboard in the TOP-LEVEL document.
//
// That gives up the sandbox attribute, so the isolation has to come from
// elsewhere, and it does — three layers, all in shared/headless-browser and
// print-service:
//
//   1. a throwaway BrowserContext: no cookies, no storage, opaque origin;
//   2. every request aborted in the browser process except the two Google
//      Fonts origins the format admits;
//   3. the same ARTBOARD_CSP meta tag as the preview, imported rather than
//      re-typed, so the two can never drift.
//
// Nothing here reaches EYAS's origin, because there is no EYAS origin in this
// browser: the page is set with setContent(), never fetched from the server.

import { ARTBOARD_CSP, escapeForScript, type ArtboardSpec } from './dc-render.js'
import { DC_RUNTIME_SOURCE } from './dc-runtime-source.js'

export interface PrintPageInput {
  spec: ArtboardSpec
  /** fixed = one page at natural size; flow = let the browser paginate. */
  mode: 'fixed' | 'flow'
  /** The artboard frame width in CSS px. For flow this is the column width. */
  width: number
  /** The artboard frame height in CSS px. Required for fixed, ignored for flow. */
  height?: number
}

function fixedCss(width: number, height: number): string {
  return `@page { margin: 0 }
html, body { width: ${width}px; height: ${height}px; }
#dc-page { width: ${width}px; height: ${height}px; overflow: hidden; }
#dc-root { width: 100%; min-height: 100%; }`
}

function flowCss(width: number): string {
  return `#dc-page { width: ${width}px; margin: 0 auto; }
#dc-root { width: 100%; }`
}

export function buildPrintDocument(input: PrintPageInput): string {
  const layout =
    input.mode === 'fixed'
      ? fixedCss(input.width, input.height ?? input.width)
      : flowCss(input.width)

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${ARTBOARD_CSP}">
<style>
* { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
html, body { margin: 0; padding: 0; background: #ffffff; }
${layout}
</style>
</head>
<body>
<div id="dc-page"><div id="dc-root"></div></div>
<script type="application/json" id="dc-spec">${escapeForScript(JSON.stringify(input.spec))}</script>
<script>
${DC_RUNTIME_SOURCE}
;(function () {
  var el = document.documentElement;
  try {
    var spec = JSON.parse(document.getElementById('dc-spec').textContent);
    window.__dcMountArtboard(spec);
    el.setAttribute('data-dc-ready', '1');
  } catch (e) {
    // A blank page is the worst possible export: it looks like a design that
    // renders to nothing. Record the failure so the service can refuse.
    el.setAttribute('data-dc-error', String(e && e.message ? e.message : e));
    el.setAttribute('data-dc-ready', '1');
  }
})();
</script>
</body>
</html>`
}
