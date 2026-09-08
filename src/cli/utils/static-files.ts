// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { existsSync, statSync } from 'fs'
import { extname, join, resolve } from 'path'

/** MIME types for static file serving (web UI + docs). */
export const STATIC_MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  // Pagefind search index fragments
  '.pf_meta': 'application/octet-stream',
  '.pf_fragment': 'application/octet-stream',
  '.pf_index': 'application/octet-stream',
}

function isUnderRoot(filePath: string, root: string): boolean {
  const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root
  return filePath === normalizedRoot || filePath.startsWith(normalizedRoot + '/')
}

function fileResponse(filePath: string): Response {
  const ext = extname(filePath).toLowerCase()
  return new Response(Bun.file(filePath), {
    headers: {
      'Content-Type': STATIC_MIME_TYPES[ext] || 'application/octet-stream',
    },
  })
}

/**
 * Resolve a path under `root` to an existing file (directory → index.html).
 * Returns null if nothing matches. Path traversal outside root is rejected.
 */
export function resolveStaticFile(root: string, relativePath: string): string | null {
  const cleaned = relativePath.replace(/^\/+/, '')
  const candidate = resolve(root, cleaned || '.')
  if (!isUnderRoot(candidate, root)) return null

  if (existsSync(candidate)) {
    try {
      const st = statSync(candidate)
      if (st.isFile()) return candidate
      if (st.isDirectory()) {
        const index = join(candidate, 'index.html')
        if (existsSync(index) && statSync(index).isFile()) return index
      }
    } catch {
      return null
    }
  }

  // extensionless clean URLs: /en/getting-started → …/getting-started.html or …/getting-started/index.html
  const asHtml = `${candidate}.html`
  if (existsSync(asHtml)) {
    try {
      if (statSync(asHtml).isFile()) return asHtml
    } catch {
      /* ignore */
    }
  }
  const asIndex = join(candidate, 'index.html')
  if (existsSync(asIndex)) {
    try {
      if (statSync(asIndex).isFile()) return asIndex
    } catch {
      /* ignore */
    }
  }

  return null
}

/**
 * Serve the Starlight docs mounted at `/docs`.
 * Dist was built with `base: '/docs'`, so on-disk layout is dist/en/…, dist/_astro/…
 * while the public URL is /docs/en/…, /docs/_astro/…
 *
 * Returns null if the request is not under `/docs`.
 */
export function tryServeDocs(pathname: string, docsDistDir: string): Response | null {
  if (pathname !== '/docs' && !pathname.startsWith('/docs/')) return null

  let rel = pathname === '/docs' || pathname === '/docs/'
    ? 'index.html'
    : decodeURIComponent(pathname.slice('/docs/'.length))

  if (rel.endsWith('/')) rel = `${rel}index.html`

  const filePath = resolveStaticFile(docsDistDir, rel)
  if (filePath) return fileResponse(filePath)

  // Fallback: docs root index (language redirect page)
  const fallback = resolveStaticFile(docsDistDir, 'index.html')
  if (fallback) {
    return new Response(Bun.file(fallback), {
      status: 404,
      headers: { 'Content-Type': STATIC_MIME_TYPES['.html'] },
    })
  }

  return new Response('Documentation not found', { status: 404 })
}

/**
 * Serve the React SPA from web dist (unknown paths → index.html).
 */
export function tryServeWebSpa(pathname: string, webDistDir: string): Response {
  const requested =
    pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\//, '')
  const filePath = resolveStaticFile(webDistDir, requested)
  if (filePath) return fileResponse(filePath)

  const index = join(webDistDir, 'index.html')
  return new Response(Bun.file(index), {
    headers: { 'Content-Type': STATIC_MIME_TYPES['.html'] },
  })
}
