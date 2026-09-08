// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll, vi } from 'vitest'
import type { ToolRegistry } from '@modules/tools/tool-registry'
import { createDeterministicGate } from '@modules/security-gate/deterministic-gate'
import { DEFAULT_CONFIG } from '@modules/security-gate/types'
import { buildProductionToolRegistry } from '../helpers/production-tool-registry'

/**
 * Contract test: EVERY tool the production boot path registers must be
 * classifiable by the deterministic security gate. An unclassified tool is
 * escalated fail-closed to the LLM judge — which, on a deployment without a
 * judge-capable provider, means the tool is simply unusable. This test is the
 * guard that adding a builtin tool without a tier is caught at CI time, not
 * by an agent hitting a wall mid-run.
 */

let registry: ToolRegistry
let toolNames: string[]
let getService: ReturnType<typeof vi.fn>
/** `getService` call count captured the instant registration finished. */
let getServiceCallsAtRegistration: number

beforeAll(async () => {
  // Full production tool set — builtins AND the agent-owned tools (see the
  // helper's header for why sweeping only the builtins is a trap).
  //
  // `getService` is a spy so the lazy contract is actually PINNED rather than
  // merely described: a factory that eagerly captured its service
  // (`const svc = getService()` at construction) would still satisfy every
  // behavioural test in this suite while being permanently dead in production
  // — precisely the defect this task fixed.
  getService = vi.fn(() => ({}))
  registry = await buildProductionToolRegistry({
    getService: getService as unknown as (id: string) => any,
  })
  getServiceCallsAtRegistration = getService.mock.calls.length

  toolNames = registry.list().map(t => t.name)
})

describe('registry ↔ security-gate tier contract', () => {
  it('resolves module services lazily — never at registration, only per call', async () => {
    // The whole point of the F1 wiring: onRegister runs before every onStart,
    // so anything captured while registering is `undefined` forever.
    expect(getServiceCallsAtRegistration).toBe(0)

    // …and the getter really is consulted when the tool runs, so this pins
    // "lazy", not merely "never touched". `list_projects` resolves ctx.board
    // through the wiring; the stub service has no `.projects`, so it fails
    // soft instead of throwing.
    const before = getService.mock.calls.length
    const output = await registry.get('list_projects')!.execute({}, undefined as any)

    expect(getService.mock.calls.length).toBeGreaterThan(before)
    expect((output as any).error).toMatch(/not ready/i)
  })

  it('registers the full builtin set without a duplicate-name collision', () => {
    expect(toolNames.length).toBeGreaterThan(20)
    expect(new Set(toolNames).size).toBe(toolNames.length)
  })

  it('gives every registered tool a valid risk tier', () => {
    const invalid = registry.list().filter(t => !['green', 'yellow', 'red'].includes(t.riskTier))
    expect(invalid.map(t => t.name)).toEqual([])
  })

  it('classifies every registered tool — none falls through to the fail-closed judge path', () => {
    const gate = createDeterministicGate(DEFAULT_CONFIG, {
      getRegistryTier: name => registry.get(name)?.riskTier,
    })

    const unclassified = toolNames.filter(name => /unclassified/.test(gate.check(name, {}).reason))

    expect(unclassified).toEqual([])
  })

  it('allows the enlivened green-tier tools deterministically', () => {
    const gate = createDeterministicGate(DEFAULT_CONFIG, {
      getRegistryTier: name => registry.get(name)?.riskTier,
    })

    // The agent-facing read-only tools the F1 wiring brought back to life.
    // `research` is deliberately absent — it does web egress, so it is yellow
    // (see the escalation test below).
    const green = [
      'search_memory', 'search_indexed', 'list_search_sources', 'search_knowledge', 'get_page',
      'list_documents', 'read_document', 'list_projects', 'get_conversation_status',
      'send_agent_message', 'read_agent_messages',
    ]

    for (const name of green) {
      expect(registry.has(name), `${name} is not registered`).toBe(true)
      const check = gate.check(name, {})
      expect(check.decision, `${name} was not allowed deterministically`).toBe('allow')
      expect(check.riskTier).toBe('green')
    }
  })

  it('sends the web-egress tools to the judge instead of allowing them outright', () => {
    const gate = createDeterministicGate(DEFAULT_CONFIG, {
      getRegistryTier: name => registry.get(name)?.riskTier,
    })

    // `research` performs web search + source fetching — the same exfiltration
    // surface that makes WebFetch/WebSearch yellow.
    expect(registry.get('research')!.riskTier).toBe('yellow')

    for (const name of ['research', 'WebFetch', 'WebSearch']) {
      const check = gate.check(name, {})
      expect(check.riskTier, `${name} should be yellow`).toBe('yellow')
      expect(check.decision, `${name} should escalate, not allow`).toBe('escalate')
      expect(check.reason).not.toMatch(/unclassified/)
    }
  })

  it('keeps the config-declared green list consistent with the registry tiers', () => {
    const mismatched = DEFAULT_CONFIG.riskTiers.green
      .filter(name => registry.has(name))
      .filter(name => registry.get(name)!.riskTier !== 'green')

    expect(mismatched).toEqual([])
  })
})
