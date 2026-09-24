// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D4 — the privacy module installs its egress filter into the raw gateway's
// egress slot and leaves ctx.model alone. A gateway reference captured before
// the module started (the decision engine's triage does exactly that) is
// masked from then on.

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createLocalBus } from '@core/bus/local-bus'
import { privacyModule } from '@modules/privacy/index'
import { createModelGateway } from '@modules/model/gateway'
import { createEgressSlot } from '@modules/model/egress'
import type { AIProvider, ModelRequest, ModelResponse, StreamEvent } from '@modules/model/types'
import { createMemoryDb } from '../../helpers/test-db'

const CARD = '4111 1111 1111 1111'

function remoteProvider() {
  const received: ModelRequest[] = []
  const provider: AIProvider = {
    id: 'remote',
    name: 'remote',
    listModels: async () => [],
    async complete(req): Promise<ModelResponse> {
      received.push(req)
      return { id: 'r', provider: 'remote', model: 'm', content: [], stopReason: 'end', usage: { inputTokens: 0, outputTokens: 0 } }
    },
    async *stream(req): AsyncIterable<StreamEvent> {
      received.push(req)
    },
  }
  return { provider, received }
}

async function startModule(opts: { slot?: boolean } = {}) {
  const egress = opts.slot === false ? undefined : createEgressSlot()
  const gateway = createModelGateway(undefined, { egress })
  const remote = remoteProvider()
  gateway.registerProvider(remote.provider)
  const bus = createLocalBus()
  const detected: unknown[] = []
  const egressEvents: any[] = []
  bus.on('eyas.privacy.detected', async (data) => { detected.push(data) })
  bus.on('eyas.privacy.egress', async (data) => { egressEvents.push(data) })
  const ctx = {
    model: gateway, modelEgress: egress, http: new Hono(), bus, db: createMemoryDb(),
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  } as any
  // Captured BEFORE the privacy module starts, like the decision engine.
  const captured = ctx.model
  await privacyModule.onRegister(ctx)
  await privacyModule.onStart(ctx)
  return { ctx, gateway, captured, remote, detected, egressEvents, egress }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('Privacy module — egress slot install', () => {
  it('installs into ctx.modelEgress and leaves ctx.model untouched', async () => {
    const { ctx, gateway, egress } = await startModule()
    expect(ctx.model).toBe(gateway)
    expect(egress!.current()).toBeDefined()
    expect(ctx.privacy.state()).toMatchObject({ source: 'yaml', seedError: null })
    expect(ctx.logger.error).not.toHaveBeenCalled()
    await privacyModule.onStop(ctx)
  })

  it('masks calls through a gateway reference captured before onStart, and does not throw on a card number', async () => {
    const { ctx, captured, remote } = await startModule()
    await expect(captured.complete({
      provider: 'remote',
      messages: [{ role: 'user', content: `card: ${CARD}` }],
    })).resolves.toBeDefined()
    expect(remote.received[0].messages[0].content).toBe('card: [CREDIT_CARD]')
    await privacyModule.onStop(ctx)
  })

  it('emits ONE aggregated egress event per masked call with audit on — never the value, never per match — and none with audit off (D7)', async () => {
    const { ctx, captured, detected, egressEvents } = await startModule()
    await captured.complete({ provider: 'remote', messages: [{ role: 'user', content: 'a@b.com, c@d.org' }], metadata: { conversationId: 'conv-1' } })
    await flush()
    expect(egressEvents).toHaveLength(1)
    expect(egressEvents[0]).toMatchObject({ targetId: 'conv-1', providerId: 'remote', locality: 'remote', transport: 'gateway', masked: 2, byType: { email: 2 } })
    expect(JSON.stringify(egressEvents)).not.toContain('a@b.com')
    // The per-match event is gone.
    expect(detected).toEqual([])

    ctx.privacy.update({ audit: false })
    await captured.complete({ provider: 'remote', messages: [{ role: 'user', content: 'e@f.com' }] })
    await flush()
    expect(egressEvents).toHaveLength(1)
    await privacyModule.onStop(ctx)
  })

  it('warns once per call for warn-class values and leaves them in the text', async () => {
    const { ctx, captured, remote } = await startModule()
    await captured.complete({ provider: 'remote', messages: [{ role: 'user', content: 'TAJ: 123-456-788' }] })
    expect(remote.received[0].messages[0].content).toBe('TAJ: 123-456-788')
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['taj_number'], providerId: 'remote' }),
      expect.stringContaining('warn-class'),
    )
    await privacyModule.onStop(ctx)
  })

  it('uninstalls on stop: traffic passes unchanged afterwards', async () => {
    const { ctx, captured, remote, egress } = await startModule()
    await privacyModule.onStop(ctx)
    expect(egress!.current()).toBeUndefined()
    await captured.complete({ provider: 'remote', messages: [{ role: 'user', content: `card: ${CARD}` }] })
    expect(remote.received[0].messages[0].content).toBe(`card: ${CARD}`)
  })

  it('logs an error, and does not throw, when the gateway has no egress slot', async () => {
    const { ctx } = await startModule({ slot: false })
    expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining('no egress slot'))
    await privacyModule.onStop(ctx)
  })

  it('re-reads the policy when privacy.yaml is reloaded, and only then', async () => {
    const { ctx } = await startModule()
    const reload = vi.spyOn(ctx.privacy, 'reloadFromYaml')

    ctx.bus.emit('eyas.config.reloaded', { file: 'memory.yaml', data: {} })
    await flush()
    expect(reload).not.toHaveBeenCalled()

    ctx.bus.emit('eyas.config.reloaded', { file: 'privacy.yaml', data: {} })
    ctx.bus.emit('eyas.config.reload.failed', { file: 'privacy.yaml', reason: 'bad yaml' })
    await flush()
    expect(reload).toHaveBeenCalledTimes(2)

    await privacyModule.onStop(ctx)
    ctx.bus.emit('eyas.config.reloaded', { file: 'privacy.yaml', data: {} })
    await flush()
    expect(reload).toHaveBeenCalledTimes(2)
  })
})
