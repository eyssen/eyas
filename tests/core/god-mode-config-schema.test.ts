// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { configSchema } from '@core/config/schema'

describe('God Mode config schema', () => {
  it('defaults godMode flags on an empty agent block', () => {
    const parsed = configSchema.parse({})
    expect(parsed.agent.godModeEnabled).toBe(true)
    expect(parsed.agent.godModeMinParticipants).toBe(2)
    expect(parsed.agent.godModeMaxParticipants).toBe(5)
  })

  it('accepts explicit godMode overrides within bounds', () => {
    const parsed = configSchema.parse({
      agent: {
        godModeEnabled: false,
        godModeMinParticipants: 3,
        godModeMaxParticipants: 8,
      },
    })
    expect(parsed.agent.godModeEnabled).toBe(false)
    expect(parsed.agent.godModeMinParticipants).toBe(3)
    expect(parsed.agent.godModeMaxParticipants).toBe(8)
  })

  it('rejects godModeMinParticipants below 2', () => {
    const result = configSchema.safeParse({
      agent: { godModeMinParticipants: 1 },
    })
    expect(result.success).toBe(false)
  })

  it('rejects godModeMaxParticipants above 8', () => {
    const result = configSchema.safeParse({
      agent: { godModeMaxParticipants: 9 },
    })
    expect(result.success).toBe(false)
  })
})
