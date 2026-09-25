// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// B2 on the CLI-MCP tool bridge (how Grok and Kimi reach EYAS tools): the
// folders a bridged call works in come from the server-side binding of the
// turn's secret, never from the request. The security gate (asked through
// the shared permission bridge) uses them for the memory-path policy, so
// another conversation's workspace is refused even when the CLI claims
// otherwise.

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import pino from 'pino'
import {
  BRIDGE_SECRET_HEADER,
  CLI_MCP_TOOLS_CALL_PATH,
  bridgeBindingFromMetadata,
  getBridgeBinding,
  issueBridgeSecret,
  registerCliMcpBridgeRoutes,
  revokeBridgeSecret,
} from '@modules/model/cli-mcp/bridge-routes'
import { createToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor } from '@modules/tools/tool-executor'
import type { ToolContext, ToolImplementation } from '@modules/tools/types'
import { securityGateModule } from '@modules/security-gate/index.js'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { resetPathPolicyForTests } from '@shared/memory-sovereignty/path-policy.js'
import type { ModelGateway } from '@modules/model/types'
import { createMemoryDb } from '../../../helpers/test-db'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../../helpers/memory-sovereignty-fixture'

const logger = pino({ level: 'silent' })

let fx: SovereigntyFixture
beforeAll(() => {
  fx = createSovereigntyFixture()
})
afterEach(() => {
  resetPathPolicyForTests()
  vi.unstubAllEnvs()
})
afterAll(() => {
  fx.cleanup()
})

/** A bridged, non-excluded tool that takes a path (like a document import). */
function importTool(calls: Array<{ input: Record<string, unknown>; ctx?: ToolContext }>): ToolImplementation {
  return {
    name: 'doc_import',
    description: 'Import a file into Documents',
    category: 'custom',
    riskTier: 'green',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    execute: async (input, ctx) => {
      calls.push({ input, ctx })
      return { imported: true }
    },
  }
}

/** The bridge over the real executor and the real security gate of a throw-away instance. */
async function bridgeApp() {
  fx.stubInstanceEnv()
  const model = { listProviders: () => [{ id: 'mock' }], complete: vi.fn(), async *stream() {} } as unknown as ModelGateway
  const registry = createToolRegistry()
  const calls: Array<{ input: Record<string, unknown>; ctx?: ToolContext }> = []
  registry.register(importTool(calls))
  // The gate reads the tool's green tier from the registry, so a clean call
  // is allowed without the judge.
  const gateCtx = { db: createMemoryDb(), model, permissions: createPermissionRegistry(), logger, config: {}, tools: { registry } } as any
  await securityGateModule.onRegister!(gateCtx)
  const executor = createToolExecutor(registry, {
    authorization: {
      getSecurityGate: () => gateCtx.securityGate,
      getAbilityForRole: () => ({ can: () => true }),
    },
  })
  const http = new Hono()
  registerCliMcpBridgeRoutes({ http, toolRegistry: registry, toolExecutor: executor, getSecurityGate: () => gateCtx.securityGate, logger })
  const call = async (secret: string, body: unknown) => {
    const res = await http.request(CLI_MCP_TOOLS_CALL_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [BRIDGE_SECRET_HEADER]: secret },
      body: JSON.stringify(body),
    })
    return (await res.json()) as { content: Array<{ text: string }>; isError: boolean }
  }
  const events = () => gateCtx.db.all(sql`SELECT * FROM security_events WHERE tool_name = 'doc_import'`) as any[]
  return { call, calls, events }
}

describe('CLI-MCP bridge — working folders from the binding (B2)', () => {
  it('(+) refuses another conversation\'s workspace using the binding\'s folders; the tool never runs', async () => {
    const { call, calls, events } = await bridgeApp()
    const secret = issueBridgeSecret({ conversationId: 'conv-1', workingDirectories: [fx.ownWorkspace] })
    const out = await call(secret, { name: 'doc_import', arguments: { path: fx.otherFile } })
    expect(out.isError).toBe(true)
    expect(out.content[0].text).toMatch(/Not this conversation's workspace/)
    expect(calls).toHaveLength(0)
    const rows = events()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ decision: 'deny', checkpoint: 'deterministic', conversation_id: 'conv-1' })
    revokeBridgeSecret(secret)
  })

  it('(−) a file in the turn\'s own workspace goes through, with the folders on the tool context', async () => {
    const { call, calls } = await bridgeApp()
    const secret = issueBridgeSecret({ conversationId: 'conv-1', workingDirectories: [fx.ownWorkspace] })
    const out = await call(secret, { name: 'doc_import', arguments: { path: fx.ownFile } })
    expect(out.isError).toBe(false)
    expect(calls).toHaveLength(1)
    expect(calls[0].ctx?.workingDirectory).toBe(fx.ownWorkspace)
    expect(calls[0].ctx?.workingDirectories).toEqual([fx.ownWorkspace])
    revokeBridgeSecret(secret)
  })

  it('(−) ignores working folders a tools/call body claims for itself', async () => {
    const { call, calls } = await bridgeApp()
    const secret = issueBridgeSecret({ conversationId: 'conv-1', workingDirectories: [fx.ownWorkspace] })
    const out = await call(secret, {
      name: 'doc_import',
      arguments: { path: fx.otherFile },
      context: { workingDirectories: [fx.otherWorkspace], conversationId: 'conv-2' },
    })
    expect(out.isError).toBe(true)
    expect(out.content[0].text).toMatch(/Not this conversation's workspace/)
    expect(calls).toHaveLength(0)
    revokeBridgeSecret(secret)
  })

  it('(+) refuses memory outside EYAS and EYAS\'s own vault even for a binding without folders', async () => {
    const { call, calls } = await bridgeApp()
    const secret = issueBridgeSecret({ conversationId: 'conv-1' })
    const foreign = await call(secret, { name: 'doc_import', arguments: { path: fx.vaultNote } })
    expect(foreign.isError).toBe(true)
    expect(foreign.content[0].text).toMatch(/Memory outside EYAS \(Obsidian vault\)/)
    const eyas = await call(secret, { name: 'doc_import', arguments: { path: fx.eyasVaultNote } })
    expect(eyas.isError).toBe(true)
    expect(eyas.content[0].text).toMatch(/EYAS data directory \(vault\)/)
    expect(calls).toHaveLength(0)
    revokeBridgeSecret(secret)
  })
})

describe('bridge binding folders', () => {
  it('takes the provider\'s roots over the metadata folders', () => {
    const binding = bridgeBindingFromMetadata(
      { conversationId: 'conv-1', workingDirectories: [fx.repo] },
      [fx.ownWorkspace, fx.repo],
    )
    expect(binding.workingDirectories).toEqual([fx.ownWorkspace, fx.repo])
  })

  it('falls back to the metadata folders, then the single working directory', () => {
    expect(bridgeBindingFromMetadata({ workingDirectories: [fx.repo, 'relative/dir'] }).workingDirectories).toEqual([fx.repo])
    expect(bridgeBindingFromMetadata({ workingDirectory: fx.ownWorkspace }).workingDirectories).toEqual([fx.ownWorkspace])
  })

  it('(−) leaves the folders out when none are known', () => {
    expect(bridgeBindingFromMetadata({ conversationId: 'conv-1' })).not.toHaveProperty('workingDirectories')
    expect(bridgeBindingFromMetadata(undefined, [])).not.toHaveProperty('workingDirectories')
  })

  it('stores the folder list as a copy the provider cannot change later', () => {
    const folders = [fx.ownWorkspace]
    const secret = issueBridgeSecret({ conversationId: 'conv-1', workingDirectories: folders })
    folders.push(fx.otherWorkspace)
    expect(getBridgeBinding(secret)?.workingDirectories).toEqual([fx.ownWorkspace])
    revokeBridgeSecret(secret)
  })
})
