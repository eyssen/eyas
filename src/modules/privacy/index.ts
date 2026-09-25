// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { resolve } from 'node:path'
import type { BusSubscription, EyasModule, ModuleContext } from '@core/types'
import { createPolicyStore, createPrivacyPolicyTable } from './policy-store.js'
import { createPrivacyService, type PrivacyService } from './service.js'
import { createEgressFilter, egressRecorderOf, toolLookupOf, type EgressDigest } from './egress-filter.js'
import { egressEventOf, PRIVACY_EGRESS_EVENT } from './egress-audit.js'
import { PRIVACY_INBOUND_MASKED_EVENT, PRIVACY_INBOUND_REFUSED_EVENT } from './errors.js'
import { createPrivacyRoutes } from './routes.js'

/**
 * The privacy.yaml seed, relative to the working directory like the config
 * watcher that hot-reloads it (bootstrap.ts). Every error names the resolved
 * path, so a server started from another directory is visible in the log.
 */
const PRIVACY_YAML = 'config/personality/privacy.yaml'
const PRIVACY_YAML_FILE = 'privacy.yaml'

/**
 * What the privacy module does with the digest of each egress with a
 * detection: warn for warn-class values, note masked calls, and — with audit
 * on — ONE aggregated 'eyas.privacy.egress' event per call (conversation,
 * run, sections, tool names, counts per type; never a value). The per-section
 * masks reach the context inspector from the filter itself (attachEgress).
 */
function reportEgress(digest: EgressDigest, service: PrivacyService, ctx: Pick<ModuleContext, 'bus' | 'logger'>): void {
  // The Privacy page's counters: every remote call, detection or not.
  service.recordEgress(digest)
  const event = egressEventOf(digest)
  if (!event) return
  const where = {
    providerId: event.providerId,
    transport: event.transport,
    conversationId: event.conversationId ?? undefined,
    compositionId: event.compositionId ?? undefined,
  }
  const warnTypes = [...new Set(digest.matches.filter((m) => m.action === 'warn').map((m) => m.type))]
  if (warnTypes.length > 0) {
    ctx.logger.warn({ types: warnTypes, ...where }, 'Privacy: warn-class values in outgoing model traffic')
  }
  if (event.masked > 0) {
    ctx.logger.info({ byType: event.byType, sectionKeys: event.sectionKeys, toolNames: event.toolNames, ...where }, 'Privacy: masked values in outgoing model traffic')
  }
  if (!service.policy().audit) return
  ctx.bus.emit(PRIVACY_EGRESS_EVENT, event)
}

let subscriptions: BusSubscription[] = []
let uninstallEgress: (() => void) | null = null

export const privacyModule: EyasModule = {
  id: 'privacy',
  name: 'Privacy',
  version: '1.0.0',
  type: 'core',
  required: false,
  description: 'PII scanner chain with policy engine — protects sensitive data before it leaves the system',
  // 'auth': the Privacy page's routes are created in onStart, so they must be
  // registered after auth's middleware (deny-by-default authentication, then
  // the /api/v1/privacy/* authenticate + CSRF pair); registered earlier, Hono
  // runs them first and requirePermission never sees an ability (always 401).
  // Every consumer reads ctx.privacy lazily, so starting after auth is safe.
  dependencies: ['model', 'auth'],

  async onRegister(ctx: ModuleContext) {
    createPrivacyPolicyTable(ctx.db)
    ctx.logger.info('Privacy module registered')
  },

  async onStart(ctx: ModuleContext) {
    // The service always exists, even with the policy disabled, so the
    // policy can be switched on again without a restart.
    const store = createPolicyStore({ db: ctx.db, logger: ctx.logger, yamlPath: resolve(PRIVACY_YAML) })
    const service = createPrivacyService({
      store,
      bus: ctx.bus,
      logger: ctx.logger,
      getRecorder: () => egressRecorderOf(ctx),
    })
    ctx.privacy = service

    // Hot swap: a changed privacy.yaml is re-imported until the policy is
    // saved from the UI. A reload failure is re-read too, so its error is
    // logged with the path and recorded for the UI.
    const onYamlEvent = async (data: unknown) => {
      const file = (data as { file?: unknown } | null)?.file
      if (file !== PRIVACY_YAML_FILE) return
      try {
        service.reloadFromYaml()
      } catch (err) {
        ctx.logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Privacy: policy reload failed')
      }
    }
    subscriptions = [
      ctx.bus.on('eyas.config.reloaded', onYamlEvent),
      ctx.bus.on('eyas.config.reload.failed', onYamlEvent),
      // The ingress outcomes the chat route and the channels report (the
      // Privacy page's inbound counters).
      ctx.bus.on(PRIVACY_INBOUND_REFUSED_EVENT, async () => service.recordInboundOutcome('refused')),
      ctx.bus.on(PRIVACY_INBOUND_MASKED_EVENT, async () => service.recordInboundOutcome('masked')),
    ]

    // The filter lives in the raw gateway's egress slot: every attempt of
    // every call (retry and tier-fallback hop included) and embed() pass it,
    // whoever holds the gateway reference. ctx.model is not replaced.
    if (!ctx.modelEgress) {
      ctx.logger.error('Privacy: the model gateway has no egress slot — outgoing model traffic is NOT masked')
    } else {
      try {
        uninstallEgress = ctx.modelEgress.install(createEgressFilter({
          service,
          getToolRegistry: () => toolLookupOf(ctx),
          getRecorder: () => egressRecorderOf(ctx),
          onDigest: (digest) => reportEgress(digest, service, ctx),
          logger: ctx.logger,
        }))
      } catch (err) {
        ctx.logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'Privacy: the egress filter could not be installed — outgoing model traffic is NOT masked',
        )
      }
    }

    createPrivacyRoutes(ctx.http, service, ctx.logger)

    const state = service.state()
    ctx.logger.info(
      { enabled: service.policy().enabled, source: state.source, rulesetVersion: state.rulesetVersion },
      'Privacy module started',
    )
  },

  async onStop() {
    for (const sub of subscriptions) sub.unsubscribe()
    subscriptions = []
    uninstallEgress?.()
    uninstallEgress = null
  },
}
