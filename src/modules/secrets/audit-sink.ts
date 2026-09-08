// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ModuleContext } from '@core/types'
import type { SecretsAuditSink } from './types.js'
import type { AuditService } from '@modules/audit/service'

/**
 * Bridge the secrets registry's audit hooks to the audit module's service.
 *
 * Lazy per-call resolution: the audit module places its service on ctx during
 * its own onRegister, and wiring order must never silently drop denied-access
 * entries. When the audit module is absent we fall back to the structured
 * logger so the events are never fully lost. The registry guarantees no secret
 * VALUES ever reach this sink — only metadata (name, scope, role). The sink
 * never throws: a failing audit write must not mask ScopeDeniedError.
 */
export function createSecretsAuditSink(ctx: ModuleContext): SecretsAuditSink {
  const service = () => (ctx as any).audit as AuditService | undefined

  return {
    logDenied(input) {
      try {
        const audit = service()
        if (audit) audit.log({ ...input, module: 'secrets', result: 'denied' })
        else ctx.logger.warn(input, 'Secrets scope denied (audit module unavailable)')
      } catch (err) {
        ctx.logger.warn({ err, input }, 'Secrets audit sink failed')
      }
    },
    logPrivileged(input) {
      try {
        const audit = service()
        if (audit) audit.log({ ...input, module: 'secrets', result: 'success' })
        else ctx.logger.info(input, 'Privileged secrets access (audit module unavailable)')
      } catch (err) {
        ctx.logger.warn({ err, input }, 'Secrets audit sink failed')
      }
    },
  }
}
