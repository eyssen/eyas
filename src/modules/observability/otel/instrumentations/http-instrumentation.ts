// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { formatTraceparent, parseTraceparent } from '../context.js'
import type { Attributes, Span, Tracer } from '../types.js'

/**
 * Duck-typed Hono-style context so we don't take a hard dep on Hono here.
 * Wire up: in `src/modules/http/*` use `app.use('*', honoOtelMiddleware(tracer))`.
 */
export interface MinimalHonoContext {
  req: {
    method: string
    path?: string
    url: string
    header(name: string): string | undefined
    raw?: { route?: string } | undefined
  }
  res: { headers: { set(name: string, value: string): void } }
}

export type MinimalHonoNext = () => Promise<void>

export function honoOtelMiddleware(tracer: Tracer) {
  return async (c: MinimalHonoContext, next: MinimalHonoNext): Promise<void> => {
    const parent = parseTraceparent(c.req.header('traceparent'))
    const route = c.req.raw?.route ?? c.req.path ?? new URL(c.req.url).pathname
    const attrs: Attributes = {
      'http.method': c.req.method.toUpperCase(),
      'http.route': route,
      'http.url': c.req.url,
    }
    await tracer.startActiveSpan(
      `${c.req.method.toUpperCase()} ${route}`,
      { kind: 'SERVER', attributes: attrs, parent: parent ?? null },
      async (span: Span) => {
        // Inject response traceparent so callers can correlate.
        c.res.headers.set('traceparent', formatTraceparent(span.context))
        try {
          await next()
          // Hono sets status on c.res indirectly; we rely on exceptions only
          // for error signalling here. Callers can enrich via getActiveSpan().
          span.setStatus({ code: 'OK' })
        } catch (err) {
          span.setAttribute('http.status_code', 500)
          span.recordException(err)
          span.setStatus({ code: 'ERROR', message: String((err as Error)?.message ?? err) })
          throw err
        }
      },
    )
  }
}

/**
 * Helper to annotate the active HTTP span once the response status is known.
 * Call from a late middleware or route handler:
 *   setHttpStatus(tracer.getActiveSpan(), 200)
 */
export function setHttpStatus(span: Span | undefined, status: number): void {
  if (!span || !span.isRecording()) return
  span.setAttribute('http.status_code', status)
  if (status >= 500) span.setStatus({ code: 'ERROR', message: `HTTP ${status}` })
}
