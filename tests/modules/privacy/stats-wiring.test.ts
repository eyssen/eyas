// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// D8 — the Privacy page's counters are fed by real traffic: every remote
// model call through the gateway's egress slot, and the ingress outcomes the
// chat route and the channels report on the bus. A local destination and
// events after the module stopped are not counted.

import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createLocalBus } from '@core/bus/local-bus'
import { privacyModule } from '@modules/privacy/index'
import { PRIVACY_INBOUND_MASKED_EVENT, PRIVACY_INBOUND_REFUSED_EVENT } from '@modules/privacy/errors'
import { createModelGateway } from '@modules/model/gateway'
import { createEgressSlot } from '@modules/model/egress'
import type { AIProvider, ModelResponse, StreamEvent } from '@modules/model/types'
import { createMemoryDb } from '../../helpers/test-db'

function provider(id: string, host?: string): AIProvider {
  return {
    id,
    name: id,
    listModels: async () => [],
    ...(host ? { egressHost: () => host } : {}),
    async complete(): Promise<ModelResponse> {
      return { id: 'r', provider: id, model: 'm', content: [], stopReason: 'end', usage: { inputTokens: 0, outputTokens: 0 } }
    },
    async *stream(): AsyncIterable<StreamEvent> {},
  }
}

async function startModule() {
  const egress = createEgressSlot()
  const gateway = createModelGateway(undefined, { egress })
  gateway.registerProvider(provider('remote'))
  gateway.registerProvider(provider('local', '127.0.0.1'))
  const bus = createLocalBus()
  const ctx = {
    model: gateway, modelEgress: egress, http: new Hono(), bus, db: createMemoryDb(),
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  } as any
  await privacyModule.onRegister(ctx)
  await privacyModule.onStart(ctx)
  return { ctx, gateway, bus }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('Privacy stats wiring', () => {
  it('counts every remote gateway call, masked or not, and skips a local destination', async () => {
    const { ctx, gateway } = await startModule()
    await gateway.complete({ provider: 'remote', messages: [{ role: 'user', content: 'mail a@b.com' }] })
    await gateway.complete({ provider: 'remote', messages: [{ role: 'user', content: 'nothing personal' }] })
    await gateway.complete({ provider: 'local', messages: [{ role: 'user', content: 'mail c@d.com' }] })
    expect(ctx.privacy.stats().egress).toEqual({ calls: 2, maskedCalls: 1, byType: { email: 1 } })
    expect(ctx.privacy.stats().byScanner).toEqual({ regex: 1 })
    await privacyModule.onStop(ctx)
  })

  it('counts the refused and masked ingress outcomes reported on the bus', async () => {
    const { ctx, bus } = await startModule()
    const payload = { targetId: null, conversationId: null, source: 'chat', types: ['iban'] }
    bus.emit(PRIVACY_INBOUND_REFUSED_EVENT, payload)
    bus.emit(PRIVACY_INBOUND_REFUSED_EVENT, { ...payload, source: 'telegram' })
    bus.emit(PRIVACY_INBOUND_MASKED_EVENT, payload)
    await flush()
    expect(ctx.privacy.stats().inbound).toMatchObject({ refused: 2, masked: 1 })
    await privacyModule.onStop(ctx)
  })

  it('stops counting bus outcomes once the module stopped (negative)', async () => {
    const { ctx, bus } = await startModule()
    const service = ctx.privacy
    await privacyModule.onStop(ctx)
    bus.emit(PRIVACY_INBOUND_REFUSED_EVENT, { targetId: null, conversationId: null, source: 'chat', types: ['iban'] })
    await flush()
    expect(service.stats().inbound.refused).toBe(0)
  })
})
