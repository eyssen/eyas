// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/cli/utils/public-assets.ts
//
// Serves public assets (logos, favicons, fonts) from <dataDir>/public/.
//
// Three things make this its own route rather than a documents endpoint:
// documents forces Content-Disposition: attachment, its local provider's
// getUrl() returns null, and every Hono response carries
// Cross-Origin-Resource-Policy: same-origin — so a documents-hosted logo can
// load in neither an email client nor an exported HTML page.
//
// This route is mounted in main.ts's Bun.serve handler, ABOVE the SPA
// catch-all and therefore OUTSIDE Hono. It gets none of the app's security
// middleware, so it sets its own headers and serves an allow-listed set of
// binary types only. Never add .html, .js or .svg here: this origin holds the
// session cookie, and an inline-served document from it is a stored-XSS
// vector.

import { existsSync, statSync } from 'fs'
import { extname, resolve } from 'path'

export const PUBLIC_ASSET_PREFIX = '/assets/'

/** Binary asset types only — nothing the browser will execute or parse as markup. */
const ASSET_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

function isUnderRoot(candidate: string, root: string): boolean {
  const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root
  return candidate === normalizedRoot || candidate.startsWith(normalizedRoot + '/')
}

/**
 * Resolve `pathname` under `publicRoot` and return a Response, or null when
 * the path is not an asset request, escapes the root, has a disallowed
 * extension, or does not exist.
 */
export function tryServePublicAsset(pathname: string, publicRoot: string): Response | null {
  if (!pathname.startsWith(PUBLIC_ASSET_PREFIX)) return null

  let relative: string
  try {
    relative = decodeURIComponent(pathname.slice(PUBLIC_ASSET_PREFIX.length)).replace(/^\/+/, '')
  } catch {
    // Malformed percent-encoding — not a path we will serve.
    return null
  }
  if (!relative) return null

  const ext = extname(relative).toLowerCase()
  const mime = ASSET_MIME_TYPES[ext]
  if (!mime) return null

  const root = resolve(publicRoot)
  const candidate = resolve(root, relative)
  if (!isUnderRoot(candidate, root)) return null
  if (!existsSync(candidate)) return null

  try {
    if (!statSync(candidate).isFile()) return null
  } catch {
    return null
  }

  return new Response(Bun.file(candidate), {
    headers: {
      'Content-Type': mime,
      // Deliberate: this is the one EYAS origin an email client or an exported
      // page may pull from.
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
      // Asset filenames are content-hashed, so a long
      // immutable cache is safe.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
