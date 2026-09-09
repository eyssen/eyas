// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/dc-render.ts
//
// Composes the srcdoc an artboard renders into, and the iframe attributes that
// contain it.
//
// This file is the security boundary for the whole design feature. Artboards
// execute AI-authored JavaScript, which is only acceptable because:
//
//   - the iframe is `sandbox="allow-scripts"` and NEVER `allow-same-origin`.
//     Together they would give the script the parent's origin, and EYAS's
//     session is an httpOnly cookie with a header-presence CSRF check — a
//     script with the origin could drive the entire API as the logged-in user.
//   - the srcdoc carries its own CSP with `connect-src 'none'`, so the artboard
//     cannot phone home. The single carve-out is Google Fonts, the one external
//     host the Design Components format admits.
//   - the runtime moves <helmet> content into <head> but drops any <script>
//     there, so styling cannot smuggle a second execution path.
//
// Changing any of those is a security decision, not a refactor.

import { DC_RUNTIME_SOURCE } from './dc-runtime-source.js'
import { defaultProps, parseArtboard, type ParsedArtboard } from './dc-template.js'

/** Google Fonts is the only external origin the format admits. */
const FONT_STYLE_SRC = 'https://fonts.googleapis.com'
const FONT_SRC = 'https://fonts.gstatic.com'

/**
 * The same two origins as an allow-list, for the print pipeline's route fence.
 * Derived from the constants above so the CSP and the fence cannot disagree.
 */
export const FONT_ORIGINS: readonly string[] = [FONT_STYLE_SRC, FONT_SRC]

export const ARTBOARD_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  `style-src 'unsafe-inline' ${FONT_STYLE_SRC}`,
  `font-src data: ${FONT_SRC}`,
  "img-src data: blob:",
  "media-src data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

/**
 * The sandbox token list. `allow-scripts` is required — the format executes.
 * `allow-same-origin` must never appear; with allow-scripts it nullifies the
 * sandbox entirely.
 */
export const ARTBOARD_SANDBOX = 'allow-scripts'

export interface RenderableArtboard {
  /** Artboard file name, e.g. Main.dc.html */
  file: string
  /** Raw .dc.html source. */
  source: string
}

export interface RenderInput {
  artboard: RenderableArtboard
  /** Sibling artboards available to <dc-import>, keyed by their stem. */
  siblings?: Record<string, string>
  /** Bare filename → data: URI. */
  images?: Record<string, string>
  /** Tweak overrides applied on top of the declared data-props defaults. */
  props?: Record<string, unknown>
}

export interface RenderResult {
  srcdoc: string
  sandbox: string
  /** Props that surface as tweak chips above the frame. */
  propsSpec: ParsedArtboard['props']
  preview?: { width?: number; height?: number }
}

/**
 * Everything the runtime needs to mount one artboard. Serialised into the
 * document as JSON; the runtime reads it back and never sees the file.
 */
export interface ArtboardSpec {
  template: string
  helmet: string
  logic: string | null
  defaults: Record<string, unknown>
  props: Record<string, unknown>
  images: Record<string, string>
  imports: Record<string, { template: string; logic: string | null; defaults: Record<string, unknown> }>
}

export interface BuiltArtboard {
  spec: ArtboardSpec
  propsSpec: ParsedArtboard['props']
  preview?: { width?: number; height?: number }
}

export function escapeForScript(json: string): string {
  // A `</script` inside the JSON would close the block early. Escaping the
  // opening angle bracket is the load-bearing part; the rest is belt-and-braces.
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** Strip the `.dc.html` suffix — dc-import addresses siblings by stem. */
export function artboardStem(file: string): string {
  return file.endsWith('.dc.html') ? file.slice(0, -'.dc.html'.length) : file
}

/**
 * Parse an artboard and its siblings into the runtime's mount spec.
 *
 * Split out from renderArtboard because the print pipeline needs the same spec
 * in a different document — a top-level page rather than an iframe srcdoc,
 * because Chromium refuses to paginate content inside a frame. One parser, one
 * spec shape, two shells.
 */
export function buildArtboardSpec(input: RenderInput): BuiltArtboard {
  const parsed = parseArtboard(input.artboard.source)

  const imports: ArtboardSpec['imports'] = {}
  for (const [file, source] of Object.entries(input.siblings ?? {})) {
    const stem = artboardStem(file)
    try {
      const child = parseArtboard(source)
      imports[stem] = { template: child.template, logic: child.logic, defaults: defaultProps(child.props) }
    } catch {
      // A sibling that will not parse simply cannot be imported; the runtime
      // renders a visible "Missing component" placeholder for it.
    }
  }

  return {
    spec: {
      template: parsed.template,
      helmet: parsed.helmet,
      logic: parsed.logic,
      defaults: defaultProps(parsed.props),
      props: input.props ?? {},
      images: input.images ?? {},
      imports,
    },
    propsSpec: parsed.props,
    ...(parsed.preview ? { preview: parsed.preview } : {}),
  }
}

export function renderArtboard(input: RenderInput): RenderResult {
  const built = buildArtboardSpec(input)
  const spec = built.spec

  const srcdoc = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${ARTBOARD_CSP}">
<style>html,body{margin:0;padding:0}#dc-root{min-height:1px}</style>
</head>
<body>
<div id="dc-root"></div>
<script type="application/json" id="dc-spec">${escapeForScript(JSON.stringify(spec))}</script>
<script>
${DC_RUNTIME_SOURCE}
;(function () {
  var raw = document.getElementById('dc-spec').textContent;
  var spec = JSON.parse(raw);
  spec.reportHeight = function () {
    try {
      var h = document.documentElement.scrollHeight;
      parent.postMessage({ type: 'dc:height', height: h }, '*');
    } catch (e) { /* no parent, or a stricter embedder — height stays fixed */ }
  };
  window.__dcMountArtboard(spec);
})();
</script>
</body>
</html>`

  return {
    srcdoc,
    sandbox: ARTBOARD_SANDBOX,
    propsSpec: built.propsSpec,
    ...(built.preview ? { preview: built.preview } : {}),
  }
}
