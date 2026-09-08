// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/canvas-schema.ts
//
// The canvas.json contract, transcribed from the Claude Design helper's own
// validator so a file authored in either tool is accepted by both.
//
// The rules that are easy to get wrong and silent when you do:
//   - exactly four top-level keys; anything else is never read by the editor
//   - an artboard file must exist as a files entry
//   - artboard stems are unique CASE-INSENSITIVELY
//   - annotation ids are unique, 1-40 chars of [A-Za-z0-9_-]
//   - a `page` reference must name a listed page
//   - `launch` has exactly two shapes, and its target must exist

import { z } from 'zod'

export const MAX_FILES = 200
export const MAX_ENTRY_BYTES = 2 * 1024 * 1024
export const MAX_NOTES = 200
export const MAX_NOTE_TEXT = 5000
export const MAX_PAGES = 40

export const ARTBOARD_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9 _.-]{0,80}\.dc\.html$/
export const IMAGE_STEM_RE = /^[A-Za-z0-9_-][A-Za-z0-9 _.-]{0,80}$/
export const NOTE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.svg'] as const

export const ENTRY_ARTBOARD = 'Main.dc.html'
export const CANVAS_FILE = 'canvas.json'

export const NOTE_KINDS = ['note', 'title1'] as const
export const NOTE_SIZES = ['s', 'm', 'l', 'xl', 'xxl'] as const
export const NOTE_COLORS = ['gray', 'red', 'orange', 'green', 'teal', 'blue', 'purple', 'pink'] as const

export const artboardEntrySchema = z.strictObject({
  file: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite(),
  h: z.number().finite(),
  title: z.string().max(200).optional(),
  expand: z.enum(['fit', 'fill']).optional(),
  print: z.enum(['fixed', 'flow']).optional(),
  page: z.string().optional(),
  is_interactive: z.boolean().optional(),
})

export const annotationSchema = z.strictObject({
  id: z.string().regex(NOTE_ID_RE, 'note id must be 1-40 chars of letters, digits, - or _'),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().min(120).max(2000),
  text: z.string().max(MAX_NOTE_TEXT),
  page: z.string().optional(),
  kind: z.enum(NOTE_KINDS).optional(),
  size: z.enum(NOTE_SIZES).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  color: z.enum(NOTE_COLORS).optional(),
})

export const pageSchema = z.strictObject({
  id: z.string().regex(NOTE_ID_RE, 'page id must be 1-40 chars of letters, digits, - or _'),
  name: z.string().min(1).max(200),
})

export const launchSchema = z.union([
  z.strictObject({ view: z.literal('canvas'), page: z.string().optional() }),
  z.strictObject({ view: z.literal('focused'), file: z.string().min(1) }),
])

export const canvasManifestSchema = z.strictObject({
  artboards: z.array(artboardEntrySchema).max(MAX_FILES).optional(),
  annotations: z.array(annotationSchema).max(MAX_NOTES).optional(),
  pages: z.array(pageSchema).max(MAX_PAGES).optional(),
  launch: launchSchema.optional(),
})

export type CanvasManifest = z.infer<typeof canvasManifestSchema>
export type ArtboardEntry = z.infer<typeof artboardEntrySchema>
export type CanvasAnnotation = z.infer<typeof annotationSchema>
export type CanvasPage = z.infer<typeof pageSchema>

export function isArtboardName(name: string): boolean {
  return ARTBOARD_NAME_RE.test(name) && !name.includes('..') && !/[/\\]/.test(name)
}

export function isImageName(name: string): boolean {
  if (name.includes('..') || /[/\\]/.test(name)) return false
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return false
  const ext = name.slice(dot).toLowerCase()
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext) && IMAGE_STEM_RE.test(name.slice(0, dot))
}

/** The artboard a focused open lands on: Main if present, else the first by name. */
export function entryArtboard(names: string[]): string | null {
  const sorted = names.filter((n) => n.endsWith('.dc.html')).sort()
  if (sorted.includes(ENTRY_ARTBOARD)) return ENTRY_ARTBOARD
  return sorted[0] ?? null
}
