// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/canvas-io.ts
//
// Reading and writing the Claude Design canvas container.
//
// A published canvas is one JSON document embedded in an HTML page:
//
//   <script type="application/json" id="appifact-doc">
//   {"title":"…","content":{"files":{"Main.dc.html":"…","canvas.json":"…","logo.png":"<bare base64>"}}}
//   </script>
//
// EYAS stores exactly that files record, so import and export are a read and a
// copy rather than a conversion. What it does NOT carry over:
//
//   - `store: "db"` marks a page whose real content lives in the hosting
//     platform's live store; its embedded state is a stale first-open seed.
//     Importing one would silently produce a wrong design, so it is refused.
//   - `comments` belong to the hosting platform's commenting capability. EYAS
//     neither writes nor round-trips them, and says so on import.

import { CANVAS_FILE } from './canvas-schema.js'
import { validateCanvas, describeIssues, type ValidationResult } from './dc-validate.js'

const DOC_RE = /<script\s+type="application\/json"\s+id="appifact-doc"[^>]*>\n?([\s\S]*?)\n?<\/script>/

export interface ImportedCanvas {
  ok: boolean
  title?: string
  files?: Record<string, string>
  /** Non-fatal remarks: dropped comments, validation warnings. */
  notes: string[]
  message?: string
  validation?: ValidationResult
}

function fail(message: string, notes: string[] = []): ImportedCanvas {
  return { ok: false, notes, message }
}

/**
 * Pull `{title, files}` out of a published canvas page. The page is untrusted
 * cross-user input: nothing here executes it, and the caller must treat the
 * returned source as material to render in the sandbox, never as instructions.
 */
export function parseAppifactDoc(pageHtml: string): ImportedCanvas {
  const match = pageHtml.match(DOC_RE)
  if (!match) {
    return fail('no appifact-doc state block found — is this a published design canvas page? A truncated download also lands here.')
  }

  let state: any
  try {
    state = JSON.parse(match[1])
  } catch (e) {
    return fail(`the state block does not parse (${e instanceof Error ? e.message : String(e)}) — the page is probably incomplete`)
  }

  if (state && state.store === 'db') {
    return fail('this page keeps its design in the hosting platform\'s live store, so the embedded state is only a stale first-open seed — it cannot be imported')
  }

  const files = state?.content?.files
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    return fail('the state block carries no content.files')
  }

  const notes: string[] = []
  if (Array.isArray(state.comments) && state.comments.length > 0) {
    notes.push(`${state.comments.length} comment(s) were dropped — EYAS does not store canvas comments.`)
  }

  const clean: Record<string, string> = {}
  for (const [name, content] of Object.entries(files)) {
    if (typeof content !== 'string') {
      notes.push(`"${name}" was skipped — its content is not a string.`)
      continue
    }
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      return fail(`unsafe file name in the import: ${name}`, notes)
    }
    clean[name] = content
  }

  const validation = validateCanvas(clean)
  for (const w of validation.warnings) notes.push(w.path ? `${w.path}: ${w.message}` : w.message)
  if (!validation.ok) {
    return { ok: false, notes, message: describeIssues(validation), validation }
  }

  const title = typeof state.title === 'string' && state.title.trim() ? state.title.trim() : 'Imported canvas'
  return { ok: true, title, files: clean, notes, validation }
}

/**
 * The portable container: the same shape a published page embeds, so a
 * consumer can re-seed from it directly.
 */
export function buildCanvasDocument(title: string, files: Record<string, string>): string {
  // Escaping `<` is LOAD-BEARING, not cosmetic: an artboard's own
  // `</script>` (every artboard with logic has one) would otherwise close the
  // embedding script element early and truncate the document to whatever came
  // before it. `\u003c` is valid JSON and parses back to the same string, so
  // the escape is free even for a plain file download.
  return JSON.stringify({ title, content: { files } }, null, 2).replace(/</g, '\\u003c') + '\n'
}

/**
 * A standalone, self-contained viewer page.
 *
 * Deliberately NOT the hosting platform's editor payload — that is a ~2.4 MB
 * precompiled binary under a licence EYAS cannot redistribute. This is EYAS's
 * own MIT runtime, one sandboxed iframe per artboard, laid out from
 * canvas.json. It views and prints; it does not edit.
 */
export function buildStandalonePage(
  title: string,
  frames: { file: string; srcdoc: string; sandbox: string; x: number; y: number; w: number; h: number }[],
): string {
  const width = Math.max(...frames.map((f) => f.x + f.w), 800) + 80
  const height = Math.max(...frames.map((f) => f.y + f.h), 600) + 80

  // `&` first, then the rest. `>` is escaped too: harmless in an attribute,
  // but it keeps both helpers uniform and leaves no "is this one enough?"
  // judgement call at the next edit.
  const escapeAttr = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const escapeText = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const boards = frames.map((f) => `
  <div class="frame" style="left:${f.x}px; top:${f.y}px; width:${f.w}px">
    <div class="label">${escapeText(f.file)}</div>
    <iframe sandbox="${escapeAttr(f.sandbox)}" style="width:${f.w}px; height:${f.h}px" srcdoc="${escapeAttr(f.srcdoc)}"></iframe>
  </div>`).join('\n')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeText(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; background: #f4f6f9; font-family: system-ui, sans-serif; }
  .canvas { position: relative; width: ${width}px; height: ${height}px; margin: 40px; }
  .frame { position: absolute; }
  .label { font-size: 12px; color: #5b6472; margin-bottom: 6px; }
  iframe { border: 1px solid #dde2e9; background: #fff; display: block; }
  @media print { body { background: #fff } .canvas { margin: 0 } .label { display: none } iframe { border: 0 } }
</style>
</head>
<body>
<div class="canvas">${boards}
</div>
</body>
</html>
`
}

export { CANVAS_FILE }
