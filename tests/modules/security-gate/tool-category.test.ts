// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// tool → autonomy-category mapping is the linchpin: a destructive tool that is
// not explicitly mapped must NEVER fall through to "no autonomy gate". The
// fail-safe is: any RED-tier tool with no explicit/pattern match is treated as
// the strictest (locked) category, so it can never run autonomously. Benign
// green tools map to null (governed by the risk-tier gate, not autonomy).

import { describe, it, expect } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import {
  createAutonomyTables,
  createAutonomyPolicy,
  categoryForTool,
  EXPLICIT_TOOL_CATEGORY,
} from '@modules/security-gate/autonomy-policy.js'
import { DEFAULT_CONFIG } from '@modules/security-gate/types.js'
import { buildProductionToolRegistry } from '../../helpers/production-tool-registry'

function policy() {
  const db = createMemoryDb()
  createAutonomyTables(db)
  const p = createAutonomyPolicy(db)
  p.seedDefaults()
  return p
}

describe('categoryForTool', () => {
  it('maps every RED-tier built-in tool to a LOCKED (autonomous-forbidden) category', () => {
    const p = policy()
    for (const tool of DEFAULT_CONFIG.riskTiers.red) {
      const cat = categoryForTool(tool, 'red')
      expect(cat, `red tool ${tool} must map to a category`).toBeTruthy()
      expect(p.resolve(cat as string).locked, `red tool ${tool} → category must be locked`).toBe(true)
    }
  })

  it('an unmapped NEW red tool fails safe to the strictest category', () => {
    const p = policy()
    const cat = categoryForTool('some_brand_new_destructive_tool', 'red')
    expect(cat).toBeTruthy()
    expect(p.resolve(cat as string).locked).toBe(true)
  })

  it('benign green built-in tools are NOT autonomy-gated (null)', () => {
    for (const tool of DEFAULT_CONFIG.riskTiers.green) {
      expect(categoryForTool(tool, 'green'), `green tool ${tool} should not be autonomy-gated`).toBeNull()
    }
  })

  it('maps sensitive operation families by name pattern', () => {
    expect(categoryForTool('delete_document', 'yellow')).toBe('data_delete')
    expect(categoryForTool('make_payment', 'yellow')).toBe('payment')
    expect(categoryForTool('send_email', 'yellow')).toBe('email_send')
    expect(categoryForTool('send_telegram_message', 'yellow')).toBe('external_message')
    expect(categoryForTool('publish_post', 'yellow')).toBe('publish_content')
  })

  it('does not treat in-process agent messaging as an outbound message', () => {
    // `send_agent_message` writes to agent_messages inside the current run —
    // the `^send_` pattern is for real egress channels, not this one.
    expect(categoryForTool('send_agent_message', 'green')).toBeNull()
    expect(categoryForTool('read_agent_messages', 'green')).toBeNull()
  })

  it('never lets a null override defeat the RED fail-safe', async () => {
    // EXPLICIT_TOOL_CATEGORY short-circuits BEFORE the `riskTier === 'red'`
    // fail-safe, so a `null` entry naming a red-tier tool would silently make
    // a destructive tool autonomy-ungated. Nothing in the mapping itself
    // prevents that — this assertion does, permanently.
    //
    // The registry MUST include the agent-owned tools: the only null-valued
    // entry today is `send_agent_message`, which `registerBuiltinTools` does
    // not register. Sweeping a builtins-only registry would make every
    // `registry.get(name)?.riskTier` check below pass against `undefined`.
    const registry = await buildProductionToolRegistry()

    const exempted = Object.entries(EXPLICIT_TOOL_CATEGORY)
      .filter(([, category]) => category === null)
      .map(([name]) => name)
    expect(exempted.length).toBeGreaterThan(0) // guard stays meaningful

    for (const name of exempted) {
      // Guard-of-the-guard: a rename would otherwise silently make the tier
      // assertion below vacuous again.
      const tool = registry.get(name)
      expect(tool, `${name} is exempted but not in the production registry`).toBeDefined()
      expect(tool!.riskTier, `${name} is exempted but registered RED`).not.toBe('red')
      expect(DEFAULT_CONFIG.riskTiers.red, `${name} is exempted but config-RED`).not.toContain(name)
    }
  })
})
