// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/design-store.ts
//
// The design file tree. Mechanics come from shared/file-tree-store.ts; this
// file adds the canvas-specific names and the image convention.
//
// Layout under <root>/<designId>/:
//   Main.dc.html          the entry artboard
//   <Name>.dc.html        sibling artboards
//   canvas.json           layout manifest
//   <image>.png           BARE BASE64 text, not bytes
//   versions/<n>/…        snapshots
//
// Images are stored as bare base64 rather than binary, matching the container
// format itself: Claude Design's `files` record holds bare base64 under the
// filename, the runtime wraps it into a data: URI at render time, and a stored
// `data:` prefix double-wraps into a broken image. Keeping the on-disk form
// identical to the wire form means export is a copy, not a conversion — and it
// keeps the store text-only.

import { createFileTreeStore, FileTreePathError, type FileTreeStore } from '@shared/file-tree-store.js'
import { CANVAS_FILE, ENTRY_ARTBOARD, isImageName } from './canvas-schema.js'

export { FileTreePathError as DesignPathError }
export { CANVAS_FILE, ENTRY_ARTBOARD }

export type DesignStore = FileTreeStore

export function createDesignStore(root: string): DesignStore {
  return createFileTreeStore(root)
}

/** MIME type for the data: URI wrapper, by image extension. */
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
}

export function imageMimeFor(name: string): string | null {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  return IMAGE_MIME[name.slice(dot).toLowerCase()] ?? null
}

/**
 * Turn the image entries of a files record into `name → data: URI`, ready for
 * the runtime's literal substitution. A stored `data:` prefix is stripped
 * rather than double-wrapped, because that is the exact silent failure the
 * format warns about.
 */
export function imageDataUris(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, content] of Object.entries(files)) {
    if (!isImageName(name)) continue
    const mime = imageMimeFor(name)
    if (!mime) continue
    const bare = content.trim().replace(/^data:[^;]+;base64,/, '')
    out[name] = `data:${mime};base64,${bare}`
  }
  return out
}

/** The artboard entries of a files record, in stable order. */
export function artboardFiles(files: Record<string, string>): string[] {
  return Object.keys(files).filter((f) => f.endsWith('.dc.html')).sort()
}
