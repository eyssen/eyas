import type { ErrorHandler } from 'hono'
import type { Logger } from 'pino'

export function createErrorHandler(logger?: Logger): ErrorHandler {
  return (err, c) => {
    const status = 'status' in err ? (err.status as number) : 500
    const message = err.message || 'Internal Server Error'
    if (status >= 500) {
      if (logger) {
        logger.error({ err, method: c.req.method, path: c.req.path }, 'HTTP %d error', status)
      } else {
        console.error('[HTTP %d] %s %s: %s', status, c.req.method, c.req.path, err.stack ?? err.message)
      }
    }
    return c.json({ error: message, status }, status as any)
  }
}

/** @deprecated Use createErrorHandler(logger) for pino-based logging */
export const errorHandler: ErrorHandler = createErrorHandler()
