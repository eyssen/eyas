// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type { EyasModule, ModuleContext } from '@core/types'
import { createHomeTables } from './schema.js'
import { createLayoutService } from './layout-service.js'
import { createHomeRoutes } from './routes.js'
import type { PulseModuleDeps, SetupStatusModuleDeps } from './routes.js'

export const homeModule: EyasModule = {
  id: 'home',
  name: 'Home',
  version: '1.0.0',
  type: 'core',
  required: true,
  description: 'Customisable home page — widget catalogue, per-user layout, pulse and setup aggregates.',
  // 'auth' is a hard dependency, not just a data need: Hono composes
  // middleware/handlers strictly in REGISTRATION order, so home's routes must
  // be created only after auth's onStart has mounted the deny-by-default
  // catch-all + CSRF middleware (see routes.ts's '/api/v1/home/*' block) —
  // otherwise requests to a route registered first bypass auth entirely,
  // hitting `requirePermission` with no ability set (401, silent login-bounce).
  // This is *why* createHomeRoutes moved out of onRegister and into onStart.
  dependencies: ['permissions', 'auth'],
  capabilities: ['widget-grid'],
  frontend: {
    widgets: [{ id: 'home.pulse', titleKey: 'home.widget.pulse.title' }],
  },

  async onRegister(ctx: ModuleContext) {
    createHomeTables(ctx.db)
    const layouts = createLayoutService(ctx.db)

    // `home` registers before mission-control/scheduler/security-gate/agent
    // in bootstrap order (see bootstrap.ts), so these MUST be lazy getters —
    // capturing `(ctx as any).missionControl` etc. here would freeze them at
    // `undefined` forever and the pulse tile would silently report zeros.
    // Same pattern as proactive-assistant/index.ts's `get eventStore()`.
    const pulse: PulseModuleDeps = {
      get missionControl() { return ctx.hasModule('mission-control') ? (ctx as any).missionControl : undefined },
      get scheduler() { return ctx.hasModule('scheduler') ? (ctx as any).scheduler : undefined },
      get securityGate() { return ctx.hasModule('security-gate') ? (ctx as any).securityGate : undefined },
      // agent/daily-stats.ts's per-user costTodayUsd (fix round 1, I-1) — not
      // security-gate's ownership logic, just the daily cost rollup.
      get agentDailyStats() { return ctx.hasModule('agent') ? (ctx as any).agentDailyStats : undefined },
    }

    // Same lazy-getter requirement as `pulse` above — board/search/memory/
    // prompt-wizard/agent/communication/ingress/disaster-recovery/
    // security-gate all register after `home`. `model`/`providerConfig` are
    // the exception: the model module registers BEFORE `home` (bootstrap.ts)
    // and is a required core module, so ctx.model/ctx.providerConfig are
    // always already set here.
    const setup: SetupStatusModuleDeps = {
      get board() { return ctx.hasModule('board') ? (ctx as any).board : undefined },
      get search() { return ctx.hasModule('search') ? (ctx as any).search : undefined },
      get memory() { return ctx.hasModule('memory') ? (ctx as any).memory : undefined },
      get promptWizard() { return ctx.hasModule('prompt-wizard') ? (ctx as any).promptWizard : undefined },
      get agents() { return ctx.hasModule('agent') ? (ctx as any).agents : undefined },
      get communication() { return ctx.hasModule('communication') ? (ctx as any).communication : undefined },
      get ingress() { return ctx.hasModule('ingress') ? (ctx as any).ingress : undefined },
      get backup() { return ctx.hasModule('disaster-recovery') ? (ctx as any).backup : undefined },
      get securityGate() { return ctx.hasModule('security-gate') ? (ctx as any).securityGate : undefined },
      model: ctx.model,
      providerConfig: ctx.providerConfig,
    }

    ;(ctx as any).home = { layouts, pulse, setup }
    ctx.logger.info('Home module registered')
  },

  async onStart(ctx: ModuleContext) {
    // Route creation happens here, not in onRegister: 'auth' now resolves
    // before 'home' (see the dependency comment above), so by the time this
    // runs, auth's onStart has already mounted its auth/CSRF middleware —
    // createHomeRoutes below is guaranteed to register after it.
    const home = (ctx as any).home
    createHomeRoutes(ctx.http, { layouts: home.layouts, listModules: ctx.listModules, logger: ctx.logger, pulse: home.pulse, setup: home.setup })
    ctx.logger.info('Home module started')
  },
  async onStop() {},
}
