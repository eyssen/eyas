// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { createRePlanner } from '@modules/agent/re-planner'

describe('re-planner provider resolution', () => {
  it('does NOT hard-code a provider/model when the caller omits them', async () => {
    const complete = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        tasksAdded: [], tasksRemoved: [], tasksModified: [], reasoning: 'ok', shouldContinue: true,
      }) }],
    })
    const replanner = createRePlanner({ complete } as any)

    const result = await replanner.replan('goal', { phaseName: 'p', agentResults: [] }, [])

    expect(complete).toHaveBeenCalledTimes(1)
    const req = complete.mock.calls[0][0]
    // Previously this forced provider:'anthropic' + a haiku model, which threw
    // on any non-Anthropic deployment and the outer catch silently no-op'd.
    expect(req.provider).toBeUndefined()
    expect(req.model).toBeUndefined()
    // The response is actually parsed rather than swallowed.
    expect(result.reasoning).toBe('ok')
    expect(result.shouldContinue).toBe(true)
  })

  it('forwards an explicit provider/model when supplied', async () => {
    const complete = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"shouldContinue": true}' }],
    })
    const replanner = createRePlanner({ complete } as any)

    await replanner.replan('goal', { phaseName: 'p', agentResults: [] }, [], {
      provider: 'ollama',
      model: 'llama3',
    })

    const req = complete.mock.calls[0][0]
    expect(req.provider).toBe('ollama')
    expect(req.model).toBe('llama3')
  })
})
