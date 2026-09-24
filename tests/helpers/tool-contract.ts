// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { vi } from 'vitest'
import { createToolRegistry, type ToolRegistry } from '@modules/tools/tool-registry.js'
import {
  createToolExecutor,
  type ExecutionResult,
  type ExecutorSecurityGate,
} from '@modules/tools/tool-executor.js'
import type { ToolAbility, ToolContext, ToolImplementation } from '@modules/tools/types.js'

/**
 * Contract-test harness for tool implementations (built on by the tool-seam
 * fix tasks). It wires a REAL tool-registry + REAL tool-executor with the F0
 * authorization choke point ACTIVE — every `run()` call goes through CASL
 * and the security gate exactly like production, via a recording allow-gate
 * stub rather than a bypass (`authorization: 'disabled'` would prove
 * nothing about the choke point).
 *
 * IMPORTANT for future callers: the `tools` array passed in here is what a
 * module's `createXTools(service)` factory RETURNS, not the factory itself.
 * The `service` object you hand to that factory MUST be shaped exactly the
 * way `src/modules/tools/index.ts` builds it from `ctx` (e.g. `(ctx as
 * any).memory`, `(ctx as any).search`, ...) — mirroring production wiring
 * is the whole point of a contract test; a mock service shaped differently
 * from the real module context proves nothing.
 *
 * Note for future callers: a `requiresApproval` tool is denied by the
 * autonomy-ladder step (tool-executor.ts step 4) unless you either pass
 * `{ securityPipelineHandled: true }` in `ctxExtra` (trusted in-process
 * caller) or stub an L3 `autonomyPolicy` on `gate` — see
 * tests/modules/tools/executor-authorization.test.ts cases 10-13 for the
 * exact shape.
 */

const silentLogger: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
}

const allowAll: ToolAbility = { can: () => true }

const VALID_RISK_TIERS = new Set(['green', 'yellow', 'red'])

export type RecordingGate = ExecutorSecurityGate & { validateToolCall: ReturnType<typeof vi.fn> }

export interface ToolContractHarness {
  registry: ToolRegistry
  gate: RecordingGate
  run(
    toolName: string,
    input: Record<string, unknown>,
    ctxExtra?: Partial<ToolContext>,
  ): Promise<ExecutionResult>
  /** Tool names registered with a `riskTier` outside 'green' | 'yellow' | 'red'. */
  invalidRiskTiers(): string[]
}

export function createToolContractHarness(tools: ToolImplementation[]): ToolContractHarness {
  const registry = createToolRegistry()
  for (const tool of tools) registry.register(tool)

  const gate: RecordingGate = {
    validateToolCall: vi.fn(async () => ({
      decision: 'allow' as const,
      reason: 'contract harness: allow',
      riskTier: 'green' as const,
    })),
  } as unknown as RecordingGate

  const executor = createToolExecutor(registry, {
    authorization: {
      getSecurityGate: () => gate,
      getAbilityForRole: () => allowAll,
    },
  })

  return {
    registry,
    gate,
    run(toolName, input, ctxExtra = {}) {
      const ctx: ToolContext = {
        conversationId: 'contract-c1',
        userId: 'contract-u1',
        agentId: 'contract-a1',
        logger: silentLogger,
        actor: { kind: 'agent', role: 'agent' },
        ...ctxExtra,
      }
      return executor.execute(toolName, input, ctx)
    },
    invalidRiskTiers() {
      return registry
        .list()
        .filter(t => !VALID_RISK_TIERS.has(t.riskTier))
        .map(t => t.name)
    },
  }
}
