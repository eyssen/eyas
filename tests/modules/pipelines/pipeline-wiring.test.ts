// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createMemoryDb } from '../../helpers/test-db'
import { createArtifactTables } from '../../../src/modules/artifacts/schema'
import { createArtifactService } from '../../../src/modules/artifacts/artifact-service'
import { createPipelineTables } from '../../../src/modules/pipelines/ticket-to-code/schema'
import { ticketToCodePipelineModule } from '../../../src/modules/pipelines/ticket-to-code/index'
import type { ModuleContext, EyasConfig } from '../../../src/core/types'

/**
 * Minimal fake ModuleContext exercising only what
 * ticketToCodePipelineModule.onStart actually reads: config.pipelines,
 * secrets.get, ctx.agents.executeAgent, ctx.artifacts, ctx.conversations,
 * ctx.http, ctx.logger, ctx.db. Everything else is stubbed/unused.
 */
function buildFakeCtx(overrides: {
  enabled?: boolean
  configured?: boolean
  tokenPresent?: boolean
  withAgents?: boolean
} = {}): ModuleContext {
  const { enabled = true, configured = true, tokenPresent = true, withAgents = true } = overrides

  const db = createMemoryDb()
  createArtifactTables(db)
  createPipelineTables(db)
  const artifacts = createArtifactService(db)

  const conversations = {
    get: (id: string) =>
      id === 'c1'
        ? { id: 'c1', title: 'A ticket', messages: [{ role: 'user', content: 'ticket body' }] }
        : null,
  }

  const executeAgent = async (_conversationId: string, _agentId: string, _task: string) => '{}'

  const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any

  const ticketToCode: EyasConfig['pipelines']['ticketToCode'] = {
    enabled,
    prProvider: configured ? 'gitea' : null,
    prBaseUrl: configured ? 'https://gitea.internal.example' : null,
    prOwner: configured ? 'infra' : null,
    prRepo: configured ? 'r' : null,
    prBaseBranch: 'main',
    approvalGates: { 'pr-open': true },
  }

  const secrets = {
    get: async (name: string) => (tokenPresent && name === 'pipeline-pr-token' ? 'tok_test' : null),
  }

  const fakeCtx: any = {
    config: { pipelines: { ticketToCode } } as EyasConfig,
    db,
    bus: { emit() {}, on: () => ({ subject: '', id: '', unsubscribe() {} }), off() {} },
    http: new Hono(),
    logger,
    secrets,
    conversations,
    hasModule: () => false,
    getModule: () => {
      throw new Error('getModule not implemented in fake ctx')
    },
  }
  if (withAgents) {
    fakeCtx.agents = { executeAgent }
    fakeCtx.artifacts = artifacts
  }

  return fakeCtx as ModuleContext
}

describe('ticket-to-code pipeline module wiring (onStart)', () => {
  it('enabled + configured PR provider + token present → assembles ctx.pipelineDeps and mounts routes', async () => {
    const ctx = buildFakeCtx({ enabled: true, configured: true, tokenPresent: true })

    await ticketToCodePipelineModule.onStart(ctx)

    const deps = (ctx as any).pipelineDeps
    expect(deps).toBeDefined()
    expect(deps.ticketSource).toBeDefined()
    expect(deps.agentRunner).toBeDefined()
    expect(deps.artifacts).toBeDefined()
    expect(deps.prClient).toBeDefined()
    expect(deps.checkpoint).toBeDefined()

    const routes = (ctx.http as Hono).routes
    expect(
      routes.some((r) => r.method === 'POST' && r.path.includes('/pipelines/ticket-to-code/start')),
    ).toBe(true)
    expect(
      routes.some((r) => r.method === 'GET' && r.path === '/api/v1/pipelines/ticket-to-code/:id'),
    ).toBe(true)
  })

  it('disabled (config.pipelines.ticketToCode.enabled=false) → ctx.pipelineDeps not set, no routes mounted', async () => {
    const ctx = buildFakeCtx({ enabled: false })

    await ticketToCodePipelineModule.onStart(ctx)

    expect((ctx as any).pipelineDeps).toBeUndefined()
    expect((ctx as any).ticketToCodePipeline).toBeUndefined()
    const routes = (ctx.http as Hono).routes
    expect(routes.some((r) => r.path.includes('/pipelines/ticket-to-code'))).toBe(false)
  })

  it('enabled but PR provider not configured → stays inert, no routes mounted', async () => {
    const ctx = buildFakeCtx({ enabled: true, configured: false })

    await ticketToCodePipelineModule.onStart(ctx)

    expect((ctx as any).pipelineDeps).toBeUndefined()
    const routes = (ctx.http as Hono).routes
    expect(routes.some((r) => r.path.includes('/pipelines/ticket-to-code'))).toBe(false)
  })

  it('enabled + configured but the pipeline-pr-token secret is missing → stays inert', async () => {
    const ctx = buildFakeCtx({ enabled: true, configured: true, tokenPresent: false })

    await ticketToCodePipelineModule.onStart(ctx)

    expect((ctx as any).pipelineDeps).toBeUndefined()
  })

  it('enabled + configured + token present but agent/artifacts modules unavailable → stays inert', async () => {
    const ctx = buildFakeCtx({ enabled: true, configured: true, tokenPresent: true, withAgents: false })

    await ticketToCodePipelineModule.onStart(ctx)

    expect((ctx as any).pipelineDeps).toBeUndefined()
  })
})
