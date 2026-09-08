// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { MiddlewareHandler } from 'hono'

/**
 * Request body-size limit middleware.
 *
 * Protects JSON/form API endpoints from slow-DoS-via-giant-body and
 * memory-exhaustion attacks. Two checks, in order:
 *
 *   1. Content-Length header — cheap shortcut. If the client told us
 *      up front how big the body is and it exceeds the limit, reject
 *      with 413 before any bytes are consumed.
 *   2. Stream measurement — for chunked / missing Content-Length
 *      requests we re-wrap c.req.raw so the reader counts bytes and
 *      aborts once the cap is hit.
 *
 * Defaults to 1 MiB which is ample for EYAS's JSON endpoints (agent
 * prompts, config payloads). Document / file uploads that need larger
 * bodies should mount a separate instance with `limit: 25 * 1024 * 1024`
 * just on their route.
 */

export interface BodyLimitOverride {
  /** Path prefix this limit applies to, e.g. '/api/v1/design/'. */
  prefix: string
  /** Max body size in bytes for paths under `prefix`. */
  limit: number
}

export interface BodyLimitOptions {
  /** Max body size in bytes. Default 1 MiB. */
  limit?: number
  /** Message returned in the 413 response body. */
  message?: string
  /**
   * HTTP methods that carry a body. Requests with other methods skip
   * the check entirely so GET / HEAD responses aren't measured.
   * Default: POST, PUT, PATCH, DELETE.
   */
  methods?: string[]
  /**
   * Per-prefix caps. Resolved by LONGEST matching prefix, so a narrower rule
   * beats a broader one. Kept inside this middleware rather than mounted as a
   * second instance: two instances both run, and the global one would still
   * reject the request the narrower one just allowed.
   */
  overrides?: BodyLimitOverride[]
}

const DEFAULT_LIMIT = 1024 * 1024 // 1 MiB
const DEFAULT_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

export function createBodyLimitMiddleware(
  options: BodyLimitOptions = {},
): MiddlewareHandler {
  const baseLimit = options.limit ?? DEFAULT_LIMIT
  // Longest prefix first so the first match is the most specific one.
  const overrides = [...(options.overrides ?? [])].sort((a, b) => b.prefix.length - a.prefix.length)

  function limitFor(pathname: string): number {
    for (const o of overrides) {
      if (pathname.startsWith(o.prefix)) return o.limit
    }
    return baseLimit
  }

  const message = options.message ?? 'Request body too large'
  const methods = new Set((options.methods ?? DEFAULT_METHODS).map(m => m.toUpperCase()))

  return async (c, next) => {
    if (!methods.has(c.req.method)) {
      return next()
    }

    // Effective cap for THIS request — the base limit unless a longer, more
    // specific prefix override matches.
    const limit = limitFor(new URL(c.req.url).pathname)

    // Cheap check first — Content-Length is a single integer, no stream
    // work required. If the client is honest about size we reject
    // without buffering anything.
    const cl = c.req.header('content-length')
    if (cl) {
      const n = Number(cl)
      if (Number.isFinite(n) && n > limit) {
        return c.json({ error: message, limit, size: n }, 413)
      }
    }

    // Stream check — only kicks in when the client omitted
    // Content-Length or lied about it. We replace c.req.raw.body with
    // a counting reader that aborts once the limit is hit. This uses
    // the standard Web Streams API (supported in Bun, Node 18+).
    const raw = c.req.raw
    if (raw.body && !raw.bodyUsed) {
      const limited = wrapWithLimit(raw.body, limit)
      // Replace the Request body with our gated stream. Hono reads via
      // c.req.json()/text()/blob() which all go through c.req.raw.
      try {
        const newReq = new Request(raw.url, {
          method: raw.method,
          headers: raw.headers,
          body: limited.stream,
          // @ts-expect-error 'duplex' is required when body is a stream in some runtimes
          duplex: 'half',
        })
        ;(c.req as any).raw = newReq
      } catch {
        // If the runtime doesn't let us swap the Request we fall back
        // to trusting the content-length check above. Better than
        // crashing the request.
      }

      // Wire the rejection path — the limited stream throws when
      // exceeded, which surfaces on the first c.req.json()/text() call
      // from the downstream handler. We catch it here and return 413
      // consistently.
      try {
        await next()
      } catch (err: any) {
        if (err && err.__bodyLimitExceeded) {
          return c.json({ error: message, limit }, 413)
        }
        throw err
      }
      return
    }

    return next()
  }
}

/**
 * Wrap a ReadableStream so the cumulative byte count is compared against
 * `limit` on every chunk. Throws a tagged error on the reader thread the
 * moment the limit is crossed — callers that invoke c.req.json() after
 * the middleware fired will surface the error there.
 */
function wrapWithLimit(stream: ReadableStream<Uint8Array>, limit: number): {
  stream: ReadableStream<Uint8Array>
} {
  let seen = 0
  const reader = stream.getReader()
  const limited = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.close()
        return
      }
      seen += value.byteLength
      if (seen > limit) {
        const err = Object.assign(new Error('body exceeds limit'), {
          __bodyLimitExceeded: true,
        })
        controller.error(err)
        return
      }
      controller.enqueue(value)
    },
    cancel() {
      reader.cancel().catch(() => { /* ignore — nothing to do */ })
    },
  })
  return { stream: limited }
}

/** Pre-built middleware with default 1 MiB limit. */
export const bodyLimitMiddleware = createBodyLimitMiddleware()
