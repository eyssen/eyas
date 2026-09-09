// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createOrchestrationBroadcaster } from '@modules/agent/orchestration-broadcaster.js'
import type { OrchestrationEvent } from '@shared/orchestration-events.js'

const evt: OrchestrationEvent = {
  runId: 'run1',
  nodeId: 'n1',
  parentId: null,
  seq: 1,
  payload: { type: 'run_started', goal: 'do it' },
}

describe('createOrchestrationBroadcaster', () => {
  it('broadcasts to the orchestration:<runId> topic with an "orchestration" envelope', () => {
    const broadcast = vi.fn()
    const b = createOrchestrationBroadcaster({ broadcast })
    b.emit(evt)
    expect(broadcast).toHaveBeenCalledWith('orchestration:run1', { event: 'orchestration', data: evt })
  })

  it('topicFor derives the topic', () => {
    const b = createOrchestrationBroadcaster({ broadcast: vi.fn() })
    expect(b.topicFor('abc')).toBe('orchestration:abc')
  })
})
