// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import type { Logger } from 'pino'
import { requirePermission } from '@modules/permissions/middleware'
import type { ScannerChain } from './scanner-chain.js'
import type { PolicyRule } from './types.js'
import { applyPolicy } from './policy-engine.js'

export function createPrivacyRoutes(
  app: Hono,
  chain: ScannerChain,
  rules: PolicyRule[],
  logger: Logger,
) {
  // Test endpoint: submit text and get scan results
  app.post('/api/v1/privacy/scan', requirePermission('manage', 'SecurityEvent'), async (c) => {
    const body = await c.req.json<{ text?: string }>()
    if (!body.text) return c.json({ error: 'text field required' }, 400)

    const matches = await chain.scan(body.text)
    const result = applyPolicy(body.text, matches, rules)

    logger.info({ matchCount: matches.length, blocked: result.blocked }, 'Privacy scan executed')

    return c.json({
      matches: matches.map((m) => ({
        type: m.type,
        start: m.start,
        end: m.end,
        confidence: m.confidence,
        scanner: m.scanner,
        // Do not return the actual PII value in API response
        value: '***',
      })),
      blocked: result.blocked,
      reason: result.reason,
      warnings: result.warnings,
      routeToLocal: result.routeToLocal,
      sanitizedText: result.sanitizedText,
    })
  })

  // Stats endpoint
  app.get('/api/v1/privacy/stats', requirePermission('read', 'SecurityEvent'), (c) => {
    return c.json(chain.getStats())
  })
}
