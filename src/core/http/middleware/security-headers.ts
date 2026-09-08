// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { MiddlewareHandler } from 'hono'

/**
 * HTTP security headers middleware (Helmet-equivalent, zero deps).
 *
 * Applies a hardened baseline of response headers the browser uses to
 * defend the app against common attack classes. Each header has been
 * chosen to be safe for:
 *   - JSON API responses (the bulk of /api/v1/*)
 *   - the SPA shell served from /
 *   - WebSocket upgrade responses (headers are ignored by WS clients,
 *     harmless for non-browser consumers)
 *
 * Headers set (per OWASP Secure Headers Project 2026):
 *
 *   X-Content-Type-Options: nosniff
 *     Prevents browsers from MIME-sniffing a response away from the
 *     declared Content-Type. Critical for JSON APIs so a crafted
 *     response body isn't interpreted as HTML or JS.
 *
 *   X-Frame-Options: DENY
 *     Blocks the page from being embedded in an <iframe> — defeats
 *     clickjacking. If a future embed use case emerges, switch to
 *     SAMEORIGIN or configure CSP frame-ancestors.
 *
 *   Referrer-Policy: strict-origin-when-cross-origin
 *     Sends the full referer to same-origin requests but only the origin
 *     (no path/query) cross-origin — avoids leaking URL-embedded tokens
 *     to third parties.
 *
 *   X-DNS-Prefetch-Control: off
 *     Stops the browser speculatively resolving domains named in the
 *     response — useful for privacy and for not revealing internal host
 *     names to DNS observers.
 *
 *   X-Permitted-Cross-Domain-Policies: none
 *     Adobe Flash-era but still set by modern hardeners — denies
 *     cross-domain policy files that some legacy plugins would honour.
 *
 *   Strict-Transport-Security: max-age=31536000; includeSubDomains
 *     Forces HTTPS for a year once the browser sees the header. Only
 *     emitted when the request itself arrived over HTTPS (or a trusted
 *     forwarded-proto). Set `hsts: false` to disable during local dev.
 *
 *   Content-Security-Policy: (configurable)
 *     Default is a self-only policy suitable for an SPA + JSON API.
 *     Operators with an external CDN / third-party script host pass a
 *     custom value via options.csp.
 *
 *   Permissions-Policy: camera=(), microphone=(), geolocation=()
 *     Denies powerful browser APIs that EYAS never needs. Extend via
 *     options.permissionsPolicy when a genuine use case emerges.
 *
 *   Cross-Origin-Opener-Policy: same-origin
 *   Cross-Origin-Embedder-Policy: require-corp (optional — breaks some
 *     third-party assets; off by default)
 *
 * Not set:
 *   - Server / X-Powered-By: we remove these in case the runtime adds
 *     them automatically (Node's Server: hidden behind Bun, but Bun may
 *     add its own).
 */

export interface SecurityHeadersOptions {
  /**
   * Content-Security-Policy value. Pass null/undefined to omit, pass a
   * custom string for a tailored policy. Default: a strict self-only
   * policy safe for the SPA + JSON API.
   */
  csp?: string | null
  /**
   * Strict-Transport-Security value. Default:
   * 'max-age=31536000; includeSubDomains'. Pass false to disable (useful
   * for local development where requests arrive over plain http).
   */
  hsts?: string | false
  /** Permissions-Policy value. Default denies camera, mic, geolocation. */
  permissionsPolicy?: string
  /**
   * If true, set Cross-Origin-Embedder-Policy: require-corp. Breaks
   * cross-origin assets that don't send CORP headers — leave off unless
   * you've audited every third-party resource.
   */
  crossOriginEmbedderPolicy?: boolean
  /**
   * Trust X-Forwarded-Proto: https when deciding to emit HSTS. Enable
   * only when running behind a TLS-terminating proxy you control.
   */
  trustForwardedProto?: boolean
}

const DEFAULT_CSP = [
  "default-src 'self'",
  // 'unsafe-inline' is needed for the current Vite build's inline script
  // hashes; once we ship nonce-based CSP we can tighten this.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // images may come from blobs (uploads) and data: URIs (favicons, SVG)
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  // No frames — we already send X-Frame-Options: DENY. CSP
  // frame-ancestors is the modern equivalent; keep both.
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

const DEFAULT_HSTS = 'max-age=31536000; includeSubDomains'
const DEFAULT_PERMISSIONS = 'camera=(), microphone=(), geolocation=()'

/**
 * Build the security-headers Hono middleware with the given options.
 * Defaults are chosen to be safe for the typical EYAS deployment: SPA
 * shell + JSON API behind a TLS-terminating proxy.
 */
export function createSecurityHeadersMiddleware(
  options: SecurityHeadersOptions = {},
): MiddlewareHandler {
  const csp = options.csp === undefined ? DEFAULT_CSP : options.csp
  const hsts = options.hsts === undefined ? DEFAULT_HSTS : options.hsts
  const permissionsPolicy = options.permissionsPolicy ?? DEFAULT_PERMISSIONS
  const coep = options.crossOriginEmbedderPolicy === true
  const trustForwardedProto = options.trustForwardedProto === true

  return async (c, next) => {
    await next()

    // Static headers first — applied to every response.
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('X-Frame-Options', 'DENY')
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    c.header('X-DNS-Prefetch-Control', 'off')
    c.header('X-Permitted-Cross-Domain-Policies', 'none')
    c.header('Cross-Origin-Opener-Policy', 'same-origin')
    c.header('Cross-Origin-Resource-Policy', 'same-origin')
    if (coep) c.header('Cross-Origin-Embedder-Policy', 'require-corp')

    if (csp) c.header('Content-Security-Policy', csp)
    if (permissionsPolicy) c.header('Permissions-Policy', permissionsPolicy)

    // HSTS only when we can be sure the request was HTTPS. Sending HSTS
    // over plain http would instruct the browser to upgrade but the
    // header itself might have come from a test client; we err on the
    // side of emitting it when the proxy hint is trusted OR the URL
    // itself shows https.
    if (hsts) {
      const isHttps =
        (trustForwardedProto && c.req.header('x-forwarded-proto') === 'https') ||
        safeUrl(c.req.url)?.protocol === 'https:'
      if (isHttps) c.header('Strict-Transport-Security', hsts)
    }

    // Strip identifiable server signature if the runtime added one.
    // Removing is idempotent — no-op when the header wasn't there.
    try {
      c.res.headers.delete('Server')
      c.res.headers.delete('X-Powered-By')
    } catch {
      // Some Hono adapters freeze the Headers instance; don't crash.
    }
  }
}

function safeUrl(raw: string): URL | null {
  try { return new URL(raw) } catch { return null }
}

/** Pre-built middleware with sensible defaults. */
export const securityHeadersMiddleware = createSecurityHeadersMiddleware()
