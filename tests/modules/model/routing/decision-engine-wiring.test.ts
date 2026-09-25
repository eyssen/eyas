// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// C7 wiring (GAPMISSED-MISSED-1): the model module builds the decision engine
// in its onStart, BEFORE privacy and tracing replace ctx.model. The engine
// must therefore read ctx.model per call and send the triage classifier
// through ctx.auxiliaryModel — never through the gateway it saw at start-up.
//
// The three host-CLI submodules are mocked so the outcome never depends on
// the binaries installed on the machine running the suite.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createTestDb } from '../../../helpers/test-db'
import { createSetupRegistry } from '@modules/setup/registry'
import type { ModuleContext } from '@core/types'
import type { AIProvider, ModelGateway, ModelInfo, ModelRequest, ModelResponse } from '@modules/model/types'

vi.mock('@modules/model/submodules/claude-code/manifest.js', () => ({
  isClaudeRuntimeUsable: async () => false,
  claudeCodeManifest: { id: 'model.claude-code', name: 'Claude Code CLI', parentModule: 'model', enabled: true },
}))
vi.mock('@modules/model/submodules/grok-cli/manifest.js', () => ({
  isGrokCliAvailable: async () => false,
  grokCliManifest: { id: 'model.grok-cli', name: 'Grok CLI', parentModule: 'model', enabled: true },
}))
vi.mock('@modules/model/submodules/kimi-cli/manifest.js', () => ({
  isKimiCliAvailable: async () => false,
  kimiCliManifest: { id: 'model.kimi-cli', name: 'Kimi CLI', parentModule: 'model', enabled: true },
}))

const logger: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return logger } }
const testDb = createTestDb('decision-engine-wiring')
afterEach(() => testDb.cleanup())

// No keyword rule matches this, so the Triage tier's model is asked.
const UNPLACEABLE = 'hello there, my friend'

function buildCtx(db: any): ModuleContext {
  return {
    db,
    logger,
    http: new Hono(),
    setup: createSetupRegistry(db),
    secrets: { get: async () => null, set: async () => {}, delete: async () => false, list: async () => [], has: async () => false },
  } as unknown as ModuleContext
}

function info(provider: string, id: string): ModelInfo {
  return { id, name: id, provider, contextWindow: 1000, maxOutputTokens: 100, supportsTools: true, supportsImages: false, supportsStreaming: true }
}

function provider(id: string, complete: (req: ModelRequest) => Promise<ModelResponse>): AIProvider {
  return { id, name: id, async listModels() { return [] }, complete, async *stream() { throw new Error('no stream') } }
}

/** Boot the model module, register `id` with three models and put the routing tiers on it. */
async function boot(id: string, complete: (req: ModelRequest) => Promise<ModelResponse>) {
  const db = testDb.open()
  const { modelModule } = await import('@modules/model/index')
  const ctx = buildCtx(db)
  await modelModule.onRegister!(ctx)
  await modelModule.onStart!(ctx)

  ctx.providerConfig.ensureProvider(id)
  ctx.providerConfig.updateProvider(id, { enabled: true })
  ctx.providerConfig.upsertModels(id, [info(id, `${id}-small`), info(id, `${id}-mid`), info(id, `${id}-big`)])
  ctx.model.registerProvider(provider(id, complete))
  for (const [tier, model] of [['triage', 'small'], ['quick', 'small'], ['standard', 'mid'], ['complex', 'big']] as const) {
    db.run(sql`UPDATE routing_tiers SET provider_id = ${id}, model_id = ${`${id}-${model}`}, enabled = 1 WHERE tier = ${tier}`)
  }

  // A wrapper module (tracing, privacy) replaces ctx.model after the model
  // module's onStart — exactly the moment the decision engine already exists.
  const inner = ctx.model
  const seen: ModelRequest[] = []
  const wrapped: ModelGateway = {
    registerProvider: (p) => inner.registerProvider(p),
    unregisterProvider: (p) => inner.unregisterProvider(p),
    getProvider: (p) => inner.getProvider(p),
    listProviders: () => inner.listProviders(),
    listAllModels: () => inner.listAllModels(),
    complete: (req) => { seen.push(req); return inner.complete(req) },
    stream: (req) => inner.stream(req),
    embed: (req) => inner.embed(req),
  }
  ctx.model = wrapped
  const engine = (ctx as any).decisionEngine as import('@modules/model/routing/decision-engine').DecisionEngine
  return { engine, seen }
}

const answering = (text: string) => vi.fn(async (req: ModelRequest): Promise<ModelResponse> => ({
  id: 'r', provider: req.provider!, model: req.model ?? 'unknown',
  content: [{ type: 'text', text }], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 },
}))

describe('model module — the decision engine\'s triage goes through the current ctx.model', () => {
  it('a wrapper installed after onStart sees the isolated triage call (positive)', async () => {
    const complete = answering('{"category": "chat", "complexity": "complex"}')
    const { engine, seen } = await boot('acme-api', complete)

    const decision = await engine.route(UNPLACEABLE, { conversationId: 'conv-3' })

    expect(complete).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ provider: 'acme-api', model: 'acme-api-small', isolated: true })
    expect(seen[0].metadata).toMatchObject({ purpose: 'triage', origin: 'interactive', conversationId: 'conv-3' })
    expect(decision).toMatchObject({ tier: 'complex', provider: 'acme-api', model: 'acme-api-big', strategy: 'triage' })
  })

  it('a CLI that cannot run isolated calls is never asked to classify (negative)', async () => {
    const complete = answering('{"category": "chat", "complexity": "complex"}')
    const { engine, seen } = await boot('grok-cli', complete)

    const decision = await engine.route(UNPLACEABLE)

    expect(complete).not.toHaveBeenCalled()
    expect(seen).toHaveLength(0)
    // The keyword result: a short unmatched message is 'simple' → the Quick tier.
    expect(decision).toMatchObject({ tier: 'quick', model: 'grok-cli-small', confidence: 0.3 })
  })
})
