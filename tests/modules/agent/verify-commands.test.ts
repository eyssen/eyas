// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { runVerifyCommands } from '@modules/agent/verify-commands'

describe('runVerifyCommands', () => {
  it('returns ok for empty command list', async () => {
    const r = await runVerifyCommands([], process.cwd())
    expect(r.ok).toBe(true)
    expect(r.results).toHaveLength(0)
  })

  it('passes when command exits 0', async () => {
    const r = await runVerifyCommands(
      [{ name: 'true', command: 'true', args: [] }],
      process.cwd(),
    )
    expect(r.ok).toBe(true)
    expect(r.results[0]?.ok).toBe(true)
  })

  it('fails when command exits non-zero', async () => {
    const r = await runVerifyCommands(
      [{ name: 'false', command: 'false', args: [] }],
      process.cwd(),
    )
    expect(r.ok).toBe(false)
    expect(r.missing[0]).toMatch(/verify:false/)
  })
})
