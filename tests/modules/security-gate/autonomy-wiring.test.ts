// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The security-gate module must, on register, create the autonomy tables, seed
// the 15 categories, register the 'Autonomy' CASL subject, and expose the
// policy on the gate so the runner / routes can consult it.

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { securityGateModule } from '@modules/security-gate/index.js'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { WS_TOPICS } from '@shared/ws-topics.js'

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} }

function registerCtx(extra: Record<string, unknown> = {}) {
  const db = createMemoryDb()
  const registry = createPermissionRegistry()
  return {
    registry,
    ctx: { db, model: {}, permissions: registry, logger: noopLogger, ...extra } as any,
  }
}

describe('security-gate onRegister — autonomy wiring', () => {
  it('seeds autonomy categories and exposes the policy on the gate', async () => {
    const { ctx, registry } = registerCtx()

    await securityGateModule.onRegister!(ctx)

    expect(ctx.securityGate).toBeDefined()
    expect(ctx.securityGate.autonomyPolicy).toBeDefined()
    expect(ctx.securityGate.autonomyPolicy.listCategories()).toHaveLength(15)
    // The 'Autonomy' CASL subject is registered.
    expect(registry.getRegisteredSubjects().some((s: any) => s.subject === 'Autonomy')).toBe(true)
  })

  // An approval blocks the requesting agent until a human acts on it, so the
  // enqueue has to be observable the moment it happens.
  it('an enqueued approval announces itself on the bus and the autonomy topic', async () => {
    const emit = vi.fn()
    const broadcast = vi.fn()
    const { ctx } = registerCtx({ bus: { emit, on: vi.fn(), off: vi.fn() }, wsRegistry: { broadcast } })

    await securityGateModule.onRegister!(ctx)
    const id = ctx.securityGate.autonomyPolicy.createApproval({
      category: 'ops_apply',
      toolName: 'ops.apply',
      reason: 'cluster drift',
    })

    expect(emit).toHaveBeenCalledWith('autonomy:approval-requested', {
      approvalId: id, category: 'ops_apply', toolName: 'ops.apply', reason: 'cluster drift',
    })
    expect(broadcast).toHaveBeenCalledWith(WS_TOPICS.autonomy, {
      event: 'autonomy:approval-requested',
      data: { category: 'ops_apply', approvalId: id },
    })
  })

  it('an enqueue still succeeds when no WS registry is attached yet', async () => {
    const { ctx } = registerCtx({ bus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } })

    await securityGateModule.onRegister!(ctx)
    const id = ctx.securityGate.autonomyPolicy.createApproval({ category: 'payment' })

    expect(ctx.securityGate.autonomyPolicy.getApproval(id)?.status).toBe('pending')
  })

  it('the routes emit wrapper mirrors every autonomy:* event onto the topic, thinned', async () => {
    const emit = vi.fn()
    const broadcast = vi.fn()
    const routeEmit: Array<(e: string, p: any) => void> = []
    vi.doMock('@modules/security-gate/routes.js', () => ({
      createSecurityGateRoutes: (_app: any, _db: any, _cfg: any, _pol: any, e: any) => { routeEmit.push(e) },
    }))
    const { ctx } = registerCtx({
      bus: { emit, on: vi.fn(), off: vi.fn() },
      wsRegistry: { broadcast },
      http: {},
    })

    await securityGateModule.onRegister!(ctx)
    await securityGateModule.onStart!(ctx)
    const forward = routeEmit[0]!

    // An operator decision must reach every other open dashboard...
    forward('autonomy:approval-resolved', { approvalId: 7, status: 'approved', decidedBy: 'alice' })
    expect(emit).toHaveBeenCalledWith('autonomy:approval-resolved', { approvalId: 7, status: 'approved', decidedBy: 'alice' })
    // ...but the frame carries only the refetch id — never who decided, or how.
    expect(broadcast).toHaveBeenCalledWith(WS_TOPICS.autonomy, {
      event: 'autonomy:approval-resolved',
      data: { approvalId: 7 },
    })

    // Non-autonomy events stay off the topic entirely.
    broadcast.mockClear()
    forward('security:something-else', { foo: 1 })
    expect(broadcast).not.toHaveBeenCalled()

    vi.doUnmock('@modules/security-gate/routes.js')
  })

  // D5 — TTL sweep. The scheduler module is optional (security-gate doesn't
  // depend on it), so the wiring must be guarded rather than assumed present.
  describe('onStart — hourly approval TTL sweep', () => {
    it("registers 'security.approvals.sweep' and expiring a stale row emits autonomy:approval-expired (bus + thin WS frame)", async () => {
      const emit = vi.fn()
      const broadcast = vi.fn()
      const registerHandler = vi.fn()
      const create = vi.fn()
      const list = vi.fn(() => [] as any[])
      const { ctx } = registerCtx({
        bus: { emit, on: vi.fn(), off: vi.fn() },
        wsRegistry: { broadcast },
        http: new Hono(),
        hasModule: (id: string) => id === 'scheduler',
        scheduler: { registerHandler, create, list },
      })

      await securityGateModule.onRegister!(ctx)
      await securityGateModule.onStart!(ctx)

      expect(registerHandler).toHaveBeenCalledWith('security.approvals.sweep', expect.any(Function))
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ handler: 'security.approvals.sweep', triggerType: 'cron' }))

      const id = ctx.securityGate.autonomyPolicy.createApproval({
        category: 'data_delete', conversationId: 'c1', runId: 'run-1', expiresAt: '2020-01-01T00:00:00.000Z',
      })
      emit.mockClear()
      broadcast.mockClear()

      const sweep = registerHandler.mock.calls[0]![1] as () => void
      sweep()

      expect(emit).toHaveBeenCalledWith('autonomy:approval-expired', { approvalId: id, runId: 'run-1' })
      expect(broadcast).toHaveBeenCalledWith(WS_TOPICS.autonomy, {
        event: 'autonomy:approval-expired',
        data: { approvalId: id, runId: 'run-1' },
      })
      expect(ctx.securityGate.autonomyPolicy.getApproval(id)?.status).toBe('expired')
    })

    it('does not register a second job when one is already listed', async () => {
      const registerHandler = vi.fn()
      const create = vi.fn()
      const list = vi.fn(() => [{ handler: 'security.approvals.sweep' }] as any[])
      const { ctx } = registerCtx({
        bus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
        wsRegistry: { broadcast: vi.fn() },
        http: new Hono(),
        hasModule: (id: string) => id === 'scheduler',
        scheduler: { registerHandler, create, list },
      })

      await securityGateModule.onRegister!(ctx)
      await securityGateModule.onStart!(ctx)

      expect(registerHandler).toHaveBeenCalledWith('security.approvals.sweep', expect.any(Function))
      expect(create).not.toHaveBeenCalled()
    })

    it('skips scheduler wiring entirely (no throw) when ctx.hasModule is absent — matches a bare test ModuleContext', async () => {
      const { ctx } = registerCtx({
        bus: { emit: vi.fn(), on: vi.fn(), off: vi.fn() },
        wsRegistry: { broadcast: vi.fn() },
        http: new Hono(),
      })

      await securityGateModule.onRegister!(ctx)
      await expect(securityGateModule.onStart!(ctx)).resolves.not.toThrow()
    })
  })
})
