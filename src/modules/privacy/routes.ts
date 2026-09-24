// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The Privacy page's API: the policy (read with read SecurityEvent, changed
// with manage SecurityEvent), the scan tester and the traffic counters. A
// detected value never leaves through any of these endpoints.

import type { Context, Hono } from 'hono'
import type { Logger } from 'pino'
import { z } from 'zod'
import { requirePermission } from '@modules/permissions/middleware'
import type { AppAbility } from '@modules/permissions/roles'
import type { PrivacyService } from './service.js'
import {
  MAX_CUSTOM_PATTERNS,
  MAX_LOCAL_HOSTS,
  PRIVACY_ACTIONS,
  PrivacyPolicyValidationError,
  type PolicyIssue,
} from './policy.js'
import { BUILTIN_PII_TYPES } from './types.js'

const ScanBodySchema = z.object({
  text: z.string().min(1).max(100_000),
})

/** The error code of a refused policy document; `issues` carries the Zod paths and codes. */
export const INVALID_POLICY_CODE = 'invalid_policy' as const

function invalidPolicy(issues: PolicyIssue[]) {
  return {
    error: INVALID_POLICY_CODE,
    code: INVALID_POLICY_CODE,
    message: `Invalid privacy policy: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
    issues,
  }
}

/** The signed-in user (set by the auth middleware), for the audit of a policy change. */
function userIdOf(c: Context): string | null {
  const id: unknown = c.get('userId')
  return typeof id === 'string' && id ? id : null
}

/** The policy as the Privacy page edits it, with where it came from. */
function policyView(service: PrivacyService, c: Context) {
  const state = service.state()
  const ability = c.get('ability') as AppAbility | undefined
  return {
    policy: service.policy(),
    version: state.version,
    source: state.source,
    seedError: state.seedError,
    updatedAt: state.updatedAt,
    rulesetVersion: state.rulesetVersion,
    builtinTypes: [...BUILTIN_PII_TYPES],
    actions: [...PRIVACY_ACTIONS],
    limits: { customPatterns: MAX_CUSTOM_PATTERNS, localHosts: MAX_LOCAL_HOSTS },
    canManage: ability?.can('manage', 'SecurityEvent') ?? false,
  }
}

export function createPrivacyRoutes(app: Hono, service: PrivacyService, logger: Pick<Logger, 'info'>) {
  app.get('/api/v1/privacy/policy', requirePermission('read', 'SecurityEvent'), (c) => {
    return c.json(policyView(service, c))
  })

  // Replaces the whole policy (PrivacyPolicySchema: omitted fields take their
  // defaults). The saved policy is UI-managed from then on, applies from the
  // next call, and is audited as eyas.privacy.policy.updated.
  app.put('/api/v1/privacy/policy', requirePermission('manage', 'SecurityEvent'), async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json(invalidPolicy([{ path: '(root)', code: 'invalid_json', message: 'the body is not valid JSON' }]), 400)
    }
    const userId = userIdOf(c)
    try {
      service.update(body, { userId })
    } catch (err) {
      if (err instanceof PrivacyPolicyValidationError) return c.json(invalidPolicy(err.issues), 400)
      throw err
    }
    logger.info({ version: service.state().version, userId }, 'Privacy policy saved from the UI')
    return c.json(policyView(service, c))
  })

  // The scan tester: what the saved policy does to a text — each detection
  // with its action, the verdict a NEW message with this text gets, and the
  // text as a remote model receives it. Not counted in /stats.
  app.post('/api/v1/privacy/scan', requirePermission('manage', 'SecurityEvent'), async (c) => {
    const parsed = ScanBodySchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) {
      return c.json({ error: 'text must be a non-empty string of at most 100000 characters' }, 400)
    }
    const result = service.preview(parsed.data.text)

    logger.info({ matchCount: result.matches.length, refused: result.inbound.refused }, 'Privacy scan executed')

    return c.json({
      enabled: result.enabled,
      rulesetVersion: result.rulesetVersion,
      matches: result.matches.map((m) => ({
        type: m.type,
        start: m.start,
        end: m.end,
        scanner: m.scanner,
        action: m.action,
        // The detected value itself is never returned.
        value: '***',
      })),
      inbound: result.inbound,
      egressPreview: result.egressText,
    })
  })

  app.get('/api/v1/privacy/stats', requirePermission('read', 'SecurityEvent'), (c) => {
    return c.json(service.stats())
  })
}
