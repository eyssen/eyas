// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { composeHeartbeat, CANNED_HEARTBEAT_TITLE } from '@modules/proactive-assistant/heartbeat-composer.js'
import {
  auxEmpty,
  auxError,
  auxNone,
  auxOk,
  createFakeAuxiliaryModel,
  createGatewayBackedAuxiliaryModel,
} from '../../helpers/fake-auxiliary-model.js'

describe('composeHeartbeat', () => {
  it('composes the body from the background model under the heartbeat purpose when enabled', async () => {
    const aux = createFakeAuxiliaryModel(auxOk('A couple of board items are overdue — worth a look.'))

    const result = await composeHeartbeat({ auxiliaryModel: aux }, { boardStuck: 2 }, ['board: stuck/overdue tasks (2)'], true)

    expect(result.body).toBe('A couple of board items are overdue — worth a look.')
    expect(result.title).not.toBe(CANNED_HEARTBEAT_TITLE)
    expect(aux.calls).toHaveLength(1)
    expect(aux.calls[0].purpose).toBe('heartbeat')
    expect(aux.calls[0].user).toContain('board: stuck/overdue tasks (2)')
  })

  it('reaches the gateway isolated, with the instruction in request.system and no system message', async () => {
    const { aux, requests } = createGatewayBackedAuxiliaryModel({ answer: 'Two items need you.' })

    const result = await composeHeartbeat({ auxiliaryModel: aux }, { boardStuck: 2 }, ['board: stuck/overdue tasks (2)'], true)

    expect(result.body).toBe('Two items need you.')
    expect(requests).toHaveLength(1)
    expect(requests[0].isolated).toBe(true)
    expect(requests[0].system).toMatch(/briefing your owner/)
    expect(requests[0].messages.every((m) => m.role === 'user')).toBe(true)
    expect(requests[0].metadata).toMatchObject({ purpose: 'heartbeat', origin: 'pipeline' })
  })

  it('keeps the canned title+body with no model call when the feature flag is disabled', async () => {
    const aux = createFakeAuxiliaryModel(auxOk('composed'))

    const result = await composeHeartbeat({ auxiliaryModel: aux }, { boardStuck: 2 }, ['board: stuck/overdue tasks (2)'], false)

    expect(result).toEqual({ title: CANNED_HEARTBEAT_TITLE, body: 'board: stuck/overdue tasks (2)' })
    expect(aux.calls).toHaveLength(0)
  })

  it('keeps the canned title+body when no background model is wired, even if enabled', async () => {
    const result = await composeHeartbeat({}, { boardStuck: 2 }, ['board: stuck/overdue tasks (2)'], true)

    expect(result).toEqual({ title: CANNED_HEARTBEAT_TITLE, body: 'board: stuck/overdue tasks (2)' })
  })

  it('keeps the canned title+body when the service has no eligible model, even if enabled', async () => {
    const aux = createFakeAuxiliaryModel(auxNone())

    const result = await composeHeartbeat({ auxiliaryModel: aux }, {}, ['scheduler: failed jobs (1)'], true)

    expect(result).toEqual({ title: CANNED_HEARTBEAT_TITLE, body: 'scheduler: failed jobs (1)' })
  })

  it('makes zero model calls on a Grok-only install', async () => {
    const { aux, requests } = createGatewayBackedAuxiliaryModel({ providers: ['grok-cli'], tiers: [] })

    const result = await composeHeartbeat({ auxiliaryModel: aux }, {}, ['scheduler: failed jobs (1)'], true)

    expect(result).toEqual({ title: CANNED_HEARTBEAT_TITLE, body: 'scheduler: failed jobs (1)' })
    expect(requests).toHaveLength(0)
  })

  it('keeps the canned title+body when the call fails or answers nothing', async () => {
    for (const step of [auxError('model down'), auxEmpty()]) {
      const aux = createFakeAuxiliaryModel(step)
      const result = await composeHeartbeat({ auxiliaryModel: aux }, {}, ['scheduler: failed jobs (1)'], true)
      expect(result).toEqual({ title: CANNED_HEARTBEAT_TITLE, body: 'scheduler: failed jobs (1)' })
    }
  })

  it('joins multiple reasons into the canned body with newlines', async () => {
    const reasons = ['board: stuck/overdue tasks (2)', 'system: health alerts (1)']

    const result = await composeHeartbeat({}, {}, reasons, true)

    expect(result.body).toBe(reasons.join('\n'))
  })
})
