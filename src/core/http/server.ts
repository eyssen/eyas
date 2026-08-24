import { Hono } from 'hono'
import { createCorsMiddleware } from './middleware/cors.js'
import { errorHandler } from './middleware/error-handler.js'
import { securityHeadersMiddleware } from './middleware/security-headers.js'
import { bodyLimitMiddleware } from './middleware/body-limit.js'
import { getVersion } from '@core/version.js'

export { createWSConnectionRegistry } from './websocket.js'
export type { WSConnectionRegistry, WSConnection, WSMessage } from './websocket.js'
export { createWSBridge } from './ws-bridge.js'

export function createApp(allowedOrigins?: string[]) {
  const app = new Hono()
  // Security headers run BEFORE routes so every response — including
  // early errors surfaced by the error handler and 404s — carries them.
  // CORS runs after so preflight responses still get the hardened headers.
  app.use('*', securityHeadersMiddleware)
  app.use('*', createCorsMiddleware(allowedOrigins))
  // 1 MiB global body cap. Routes that legitimately accept larger bodies
  // (document uploads, vault imports) should mount their own
  // createBodyLimitMiddleware({ limit: … }) on their subpath BEFORE
  // routing lands here so the tighter limit wins.
  app.use('*', bodyLimitMiddleware)
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
