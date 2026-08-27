// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/dc-validate.ts
//
// THE GATE. Every design edit — hand-written, imported, or produced by any
// provider at any executor tier — passes through here before it becomes a
// version. This is what makes a small local model usable and what stops the
// feature from behaving differently when the provider changes.
//
// The checks mirror the Claude Design helper's own refusals, because a canvas
// that fails there is a canvas that will not open there.

import {
  CANVAS_FILE, ENTRY_ARTBOARD, MAX_ENTRY_BYTES, MAX_FILES, MAX_NOTES, MAX_PAGES,
  canvasManifestSchema, entryArtboard, isArtboardName, isImageName,
  type CanvasManifest,
} from './canvas-schema.js'

export interface ValidationIssue {
  /** Machine-stable code so callers can branch without matching prose. */
  code: string
  /** The files entry this is about, when it is about one. */
  path?: string
  message: string
}

export interface ValidationResult {
  ok: boolean
  errors: ValidationIssue[]
  warnings: ValidationIssue[]
  manifest?: CanvasManifest
}

/**
 * `style="color: {{x}} ? a : b"` renders as literal text and is dropped as
 * invalid CSS, silently. The helper warns about it; we refuse it, because an
 * AI edit that produces it has produced a design with an invisible defect.
 */
const TERNARY_AFTER_HOLE_RE = /\}\}\s*\?[^:\n]{0,400}:/

function styleAttributeRanges(source: string): [number, number][] {
  const ranges: [number, number][] = []
  const attr = /style=(["'])/g
  let m: RegExpExecArray | null
  while ((m = attr.exec(source)) !== null) {
    const quote = m[1]
    const start = m.index + m[0].length
    const end = source.indexOf(quote, start)
    if (end === -1) break
    ranges.push([start, end])
    attr.lastIndex = end + 1
  }
  return ranges
}

export function hasTernaryInStyleAttribute(source: string): boolean {
  return styleAttributeRanges(source).some(([start, end]) => TERNARY_AFTER_HOLE_RE.test(source.slice(start, end)))
}

/** Every `src="name.ext"` an artboard references, so we can check it exists. */
export function referencedImages(source: string): string[] {
  const out = new Set<string>()
  for (const m of source.matchAll(/\bsrc="([^"]+)"/g)) {
    const raw = m[1].replace(/^\.\//, '')
    if (isImageName(raw)) out.add(raw)
  }
  for (const m of source.matchAll(/url\(\s*['"]?\.?\/?([^'")]+)['"]?\s*\)/g)) {
    const raw = m[1].trim()
    if (isImageName(raw)) out.add(raw)
  }
  return [...out]
}

function err(code: string, message: string, path?: string): ValidationIssue {
  return path ? { code, path, message } : { code, message }
}

/**
 * Validate a complete canvas: the files record plus the canvas.json inside it.
 * `files` maps a canvas-relative name to its source; images are represented by
 * their name with any placeholder content, since only existence is checked.
 */
export function validateCanvas(files: Record<string, string>): ValidationResult {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  const names = Object.keys(files)
  if (names.length === 0) {
    return { ok: false, errors: [err('empty', 'a canvas needs at least one artboard')], warnings }
  }
  if (names.length > MAX_FILES) {
    errors.push(err('too-many-files', `${names.length} files entries; the editor loads at most ${MAX_FILES}`))
  }

  // ── names and sizes ───────────────────────────────────────────────────────
  const artboards: string[] = []
  const images: string[] = []
  const stems = new Map<string, string>()

  for (const name of names) {
    if (Buffer.byteLength(files[name] ?? '', 'utf8') > MAX_ENTRY_BYTES) {
      errors.push(err('entry-too-large', `is over ${MAX_ENTRY_BYTES} bytes; the editor drops it at load`, name))
    }
    if (name === CANVAS_FILE) continue
    if (name.endsWith('.dc.html')) {
      if (!isArtboardName(name)) {
        errors.push(err('bad-artboard-name', 'artboard names must match <Name>.dc.html with no path separators', name))
        continue
      }
      const stem = name.slice(0, -'.dc.html'.length).toLowerCase()
      const clash = stems.get(stem)
      if (clash) errors.push(err('duplicate-stem', `collides with "${clash}" — artboard stems are unique case-insensitively`, name))
      else stems.set(stem, name)
      artboards.push(name)
    } else if (isImageName(name)) {
      images.push(name)
    } else {
      warnings.push(err('unknown-entry', 'is neither an artboard nor a recognised image type; the editor ignores it', name))
    }
  }

  if (artboards.length === 0) errors.push(err('no-artboards', 'a canvas needs at least one .dc.html artboard'))
  if (artboards.length > 0 && !artboards.includes(ENTRY_ARTBOARD)) {
    warnings.push(err('no-main', `no ${ENTRY_ARTBOARD}; the entry artboard falls back to "${entryArtboard(artboards)}"`))
  }

  // ── artboard sources ──────────────────────────────────────────────────────
  const imageSet = new Set(images)
  for (const name of artboards) {
    const source = files[name] ?? ''
    if (!/<x-dc[\s>]/.test(source)) {
      errors.push(err('missing-x-dc', 'has no <x-dc> root element', name))
    }
    if (/<script\s+data-dc-script[^>]*>\s*<\/script>/.test(source)) {
      errors.push(err('empty-logic', 'has an empty <script data-dc-script> — omit it entirely for a static artboard', name))
    }
    if (hasTernaryInStyleAttribute(source)) {
      errors.push(err('style-ternary', 'has "}} ?" inside a style attribute — operators outside {{ }} are literal text and the declaration is dropped; compute the value in renderVals() and bind it', name))
    }
    for (const ref of referencedImages(source)) {
      if (!imageSet.has(ref)) {
        errors.push(err('missing-image', `references "${ref}", which is not a files entry — it renders as a broken image with no warning`, name))
      }
    }
  }

  // ── canvas.json ───────────────────────────────────────────────────────────
  let manifest: CanvasManifest | undefined
  const rawManifest = files[CANVAS_FILE]
  if (rawManifest !== undefined) {
    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(rawManifest)
    } catch (e) {
      errors.push(err('canvas-json-parse', `does not parse: ${e instanceof Error ? e.message : String(e)}`, CANVAS_FILE))
      return { ok: false, errors, warnings }
    }
    const parsed = canvasManifestSchema.safeParse(parsedJson)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(err('canvas-json-schema', `${issue.path.join('.') || '(root)'}: ${issue.message}`, CANVAS_FILE))
      }
      return { ok: false, errors, warnings }
    }
    manifest = parsed.data

    const pageIds = new Set((manifest.pages ?? []).map((p) => p.id))
    if ((manifest.pages ?? []).length > 0) {
      const seenPage = new Set<string>()
      for (const p of manifest.pages ?? []) {
        if (seenPage.has(p.id)) errors.push(err('duplicate-page-id', `page id "${p.id}" is repeated`, CANVAS_FILE))
        seenPage.add(p.id)
      }
    }
    if ((manifest.pages ?? []).length > MAX_PAGES) {
      errors.push(err('too-many-pages', `the editor keeps only the first ${MAX_PAGES} pages`, CANVAS_FILE))
    }

    const artboardSet = new Set(artboards)
    const seenFile = new Set<string>()
    for (const a of manifest.artboards ?? []) {
      if (!artboardSet.has(a.file)) {
        errors.push(err('unknown-artboard-ref', `lists "${a.file}", which is not a files entry`, CANVAS_FILE))
      }
      if (seenFile.has(a.file)) errors.push(err('duplicate-artboard-ref', `lists "${a.file}" twice`, CANVAS_FILE))
      seenFile.add(a.file)
      if (a.page !== undefined && !pageIds.has(a.page)) {
        errors.push(err('unknown-page-ref', `artboard "${a.file}" names page "${a.page}", which is not listed`, CANVAS_FILE))
      }
    }

    const seenNote = new Set<string>()
    for (const n of manifest.annotations ?? []) {
      if (seenNote.has(n.id)) errors.push(err('duplicate-note-id', `annotation id "${n.id}" is repeated; the editor drops the duplicate`, CANVAS_FILE))
      seenNote.add(n.id)
      if (n.page !== undefined && !pageIds.has(n.page)) {
        errors.push(err('unknown-page-ref', `annotation "${n.id}" names page "${n.page}", which is not listed`, CANVAS_FILE))
      }
    }
    if ((manifest.annotations ?? []).length > MAX_NOTES) {
      errors.push(err('too-many-notes', `the editor keeps only the first ${MAX_NOTES} annotations`, CANVAS_FILE))
    }

    if (manifest.launch) {
      if (manifest.launch.view === 'focused' && !artboardSet.has(manifest.launch.file)) {
        errors.push(err('bad-launch', `launch targets "${manifest.launch.file}", which is not an artboard`, CANVAS_FILE))
      }
      if (manifest.launch.view === 'canvas' && manifest.launch.page !== undefined && !pageIds.has(manifest.launch.page)) {
        errors.push(err('bad-launch', `launch names page "${manifest.launch.page}", which is not listed`, CANVAS_FILE))
      }
    }

    // Overlap is a warning, not an error: the name strip and tweak chips sit
    // above each frame, so touching frames are ugly rather than broken.
    const boxes = (manifest.artboards ?? []).filter((a) => artboardSet.has(a.file))
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          warnings.push(err('overlap', `"${a.file}" and "${b.file}" overlap on the canvas`, CANVAS_FILE))
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, manifest }
}

/** One-line human summary, used as retry feedback for the AI editor. */
export function describeIssues(result: ValidationResult): string {
  return result.errors
    .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
    .join('\n')
}
