// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Drift-source removal: the legacy config/agents/*.yaml seeds duplicated the
// canonical v2 specialists in agent-templates.ts. Both the files and the
// boot-time seedFromDirectory call are gone; only agent-templates.ts remains
// as the source of truth for the built-in specialists.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

describe('legacy config/agents yaml seed removal', () => {
  it('the three legacy seed files no longer exist', () => {
    expect(existsSync(resolve(process.cwd(), 'config/agents/general-assistant.yaml'))).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'config/agents/code-reviewer.yaml'))).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'config/agents/researcher.yaml'))).toBe(false)
  })

  it('the agent module boot code no longer invokes seedFromDirectory', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/modules/agent/index.ts'), 'utf-8')
    expect(source).not.toContain('seedFromDirectory')
    expect(source).not.toContain('config/agents')
  })
})
