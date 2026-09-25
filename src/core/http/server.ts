import { Hono } from 'hono'
import { createCorsMiddleware } from './middleware/cors.js'
import { errorHandler } from './middleware/error-handler.js'
import { securityHeadersMiddleware } from './middleware/security-headers.js'
import { createBodyLimitMiddleware, type BodyLimitOverride } from './middleware/body-limit.js'
import { getVersion } from '@core/version.js'

export { createWSConnectionRegistry } from './websocket.js'
export type { WSConnectionRegistry, WSConnection, WSMessage } from './websocket.js'
export { createWSBridge } from './ws-bridge.js'

export interface CreateAppOptions {
  /**
   * Per-prefix body-size caps. The 1 MiB global default is right for JSON
   * APIs and wrong for uploads; a module cannot raise it from its own routes
   * because this middleware is mounted first, on '*'.
   */
  bodyLimitOverrides?: BodyLimitOverride[]
}

export function createApp(allowedOrigins?: string[], options: CreateAppOptions = {}) {
  const app = new Hono()
  // Security headers run BEFORE routes so every response — including
  // early errors surfaced by the error handler and 404s — carries them.
  // CORS runs after so preflight responses still get the hardened headers.
  app.use('*', securityHeadersMiddleware)
  app.use('*', createCorsMiddleware(allowedOrigins))
  // 1 MiB global body cap, raised per prefix for routes that legitimately
  // accept larger bodies (document uploads, design imports).
  // A second middleware instance would NOT work: both run, and this one would
  // still reject what the narrower one just allowed.
  app.use('*', createBodyLimitMiddleware({
    overrides: [
      { prefix: '/api/v1/documents/', limit: 25 * 1024 * 1024 },
      { prefix: '/api/v1/designs/', limit: 8 * 1024 * 1024 },
      ...(options.bodyLimitOverrides ?? []),
    ],
  }))
  app.onError(errorHandler)

  // A2A agent card — must be at well-known path (not under /api/v1/)
  app.get('/.well-known/agent-card.json', (c) => {
    const cardGenerator = (app as any)._agentCardGenerator as (() => import('@modules/communication/submodules/a2a/types.js').AgentCard) | undefined
    if (!cardGenerator) {
      return c.json({ error: 'Agent card not configured' }, 503)
    }
    return c.json(cardGenerator())
  })

  app.get('/api/v1/health', (c) => {
    return c.json({
      status: 'ok',
      version: getVersion(),
      timestamp: new Date().toISOString(),
    })
  })

  app.notFound((c) => {
    return c.json({ error: 'Not Found', status: 404 }, 404)
  })

  return app
}
