// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { composeHeartbeat, CANNED_HEARTBEAT_TITLE } from '@modules/proactive-assistant/heartbeat-composer.js'

describe('composeHeartbeat', () => {
  it('composes a human-voiced title/body from a stub model when enabled', async () => {
    const complete = vi.fn(async () => ({
      content: [{ type: 'text', text: 'A couple of board items are overdue — worth a look.' }],
    })) as any
    const ctx = { model: { complete } }

    const result = await composeHeartbeat(ctx, { boardStuck: 2 }, ['board: stuck/overdue tasks (2)'], true)

    expect(result.body).toBe('A couple of board items are overdue — worth a look.')
    expect(result.title).not.toBe(CANNED_HEARTBEAT_TITLE)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('falls back to the canned title+body when the feature flag is disabled (no model call)', async () => {
    const complete = vi.fn(async () => ({ content: [{ type: 'text', text: 'composed' }] })) as any
    const ctx = { model: { complete } }

    const result = await composeHeartbeat(ctx, { boardStuck: 2 }, ['board: stuck/overdue tasks (2)'], false)

    expect(result).toEqual({ title: CANNED_HEARTBEAT_TITLE, body: 'board: stuck/overdue tasks (2)' })
    expect(complete).not.toHaveBeenCalled()
  })

  it('falls back to the canned title+body when ctx.model is absent, even if enabled', async () => {
    const ctx = {}

    const result = await composeHeartbeat(ctx, { boardStuck: 2 }, ['board: stuck/overdue tasks (2)'], true)

    expect(result).toEqual({ title: CANNED_HEARTBEAT_TITLE, body: 'board: stuck/overdue tasks (2)' })
  })

  it('falls back to the canned title+body when model.complete throws, even if enabled', async () => {
    const complete = vi.fn(async () => { throw new Error('model down') }) as any
    const ctx = { model: { complete } }

    const result = await composeHeartbeat(ctx, {}, ['scheduler: failed jobs (1)'], true)

    expect(result).toEqual({ title: CANNED_HEARTBEAT_TITLE, body: 'scheduler: failed jobs (1)' })
  })

  it('joins multiple reasons into the canned body with newlines', async () => {
    const ctx = {}
    const reasons = ['board: stuck/overdue tasks (2)', 'system: health alerts (1)']

    const result = await composeHeartbeat(ctx, {}, reasons, true)

    expect(result.body).toBe(reasons.join('\n'))
  })
})
