// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { buildTestHarness, loadTicketFixture } from './_helpers'
import { createTicketToCodeOrchestrator } from '../../../../src/modules/pipelines/ticket-to-code/orchestrator'
import { createTicketToCodeRoutes } from '../../../../src/modules/pipelines/ticket-to-code/routes'
import { errorHandler } from '@core/http/middleware/error-handler'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import type { AppAbility } from '@modules/permissions/roles'
import type { RoleId } from '@modules/permissions/types'

function registerPipelineSubject() {
  const reg = createPermissionRegistry()
  reg.registerSubject('Pipeline', {
    actions: ['read', 'create', 'approve', 'manage'],
    defaults: {
      owner: ['manage'],
      admin: ['manage'],
      user: ['read', 'create', 'approve'],
      agent: ['read', 'create'],
      guest: ['read'],
    },
  })
  return reg
}

function createApp(orchestrator: ReturnType<typeof createTicketToCodeOrchestrator>, ability: AppAbility) {
  const app = new Hono<{ Variables: { ability: AppAbility } }>()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('ability', ability)
    await next()
  })
  const logger = { info: () => {}, warn: () => {}, error: () => {} } as any
  createTicketToCodeRoutes(app, orchestrator, logger)
  return app
}

const happyAgents = {
  'product-owner': {
    text: '',
    json: {
      problem: 'Admins need a validated bulk CSV import for partners today',
      personas: [{ name: 'Admin', goals: ['Upload CSV'] }],
      successMetrics: ['TTV < 5m'],
      requirements: { functional: ['Validate VAT'] },
      outOfScope: [],
      openQuestions: [],
    },
  },
  'architect': {
    text: '',
    json: {
      summary: 'CSV import pipeline with streaming validation',
      architecture: {
        components: [{ name: 'Importer', responsibility: 'Parse + validate' }],
        dataFlow: [],
      },
      interfaces: [],
      dataModel: [],
      risks: [],
      alternatives: [],
    },
  },
  'developer': {
    text: '',
    json: {
      summary: 'Add importer',
      branch: 'feature/x',
      files: [{ path: 'a.ts', action: 'add' as const, newContent: '// x' }],
    },
  },
  'qa-engineer': {
    text: '',
    json: {
      testPlan: {
        scope: 'Smoke tests for the new importer endpoint',
        environments: ['ci'],
        cases: [
          {
            id: 'TC-1',
            title: 'Smoke',
            kind: 'unit' as const,
            steps: ['run'],
            expected: 'ok',
            severity: 'smoke' as const,
          },
        ],
      },
      reviewComments: [],
    },
  },
}

describe('Ticket-to-code routes', () => {
  const json = { 'Content-Type': 'application/json' }
  let db: any
  let orch: ReturnType<typeof createTicketToCodeOrchestrator>
  let ownerApp: Hono<any>
  let guestApp: Hono<any>

  beforeEach(() => {
    const fixture = loadTicketFixture('ticket-feature-request')
    const harness = buildTestHarness({
      tickets: { [`${fixture.source}:${fixture.id}`]: fixture },
      agentResponses: happyAgents,
    })
    db = harness.db
    orch = createTicketToCodeOrchestrator(db, harness.deps)
    const registry = registerPipelineSubject()
    const ownerAbility = buildAbilityForRole('owner' as RoleId, registry)
    const guestAbility = buildAbilityForRole('guest' as RoleId, registry)
    ownerApp = createApp(orch, ownerAbility)
    guestApp = createApp(orch, guestAbility)
  })

  it('denies guest on POST /start', async () => {
    const res = await guestApp.request('/api/v1/pipelines/ticket-to-code/start', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ ticketSource: 'board', ticketId: 'task-4201' }),
    })
    expect(res.status).toBe(403)
  })

  it('allows owner to start a pipeline and returns 201', async () => {
    const res = await ownerApp.request('/api/v1/pipelines/ticket-to-code/start', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ ticketSource: 'board', ticketId: 'task-4201' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.run.status).toBe('completed')
  })

  it('validates ticketSource on start', async () => {
    const res = await ownerApp.request('/api/v1/pipelines/ticket-to-code/start', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ ticketSource: 'magic', ticketId: 'x' }),
    })
    expect(res.status).toBe(400)
  })

  it('GET :id returns state, 404 for unknown id', async () => {
    const res1 = await ownerApp.request('/api/v1/pipelines/ticket-to-code/start', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ ticketSource: 'board', ticketId: 'task-4201' }),
    })
    const created = await res1.json()

    const res2 = await ownerApp.request(`/api/v1/pipelines/ticket-to-code/${created.run.id}`)
    expect(res2.status).toBe(200)

    const res3 = await ownerApp.request('/api/v1/pipelines/ticket-to-code/does-not-exist')
    expect(res3.status).toBe(404)
  })

  it('approve rejects unknown stage with 400 and non-awaiting stage with 409', async () => {
    const res1 = await ownerApp.request('/api/v1/pipelines/ticket-to-code/start', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ ticketSource: 'board', ticketId: 'task-4201' }),
    })
    const created = await res1.json()

    const res2 = await ownerApp.request(
      `/api/v1/pipelines/ticket-to-code/${created.run.id}/approve/nope`,
      { method: 'POST' },
    )
    expect(res2.status).toBe(400)

    const res3 = await ownerApp.request(
      `/api/v1/pipelines/ticket-to-code/${created.run.id}/approve/ingest`,
      { method: 'POST' },
    )
    expect(res3.status).toBe(409)
  })

  it('cancel + resume lifecycle on a gated run', async () => {
    const res1 = await ownerApp.request('/api/v1/pipelines/ticket-to-code/start', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        ticketSource: 'board',
        ticketId: 'task-4201',
        config: { approvalGates: { review: true } },
      }),
    })
    const created = await res1.json()
    expect(created.run.status).toBe('waiting_approval')

    const res2 = await ownerApp.request(
      `/api/v1/pipelines/ticket-to-code/${created.run.id}/cancel`,
      { method: 'POST' },
    )
    const cancelled = await res2.json()
    expect(cancelled.run.status).toBe('cancelled')

    const res3 = await ownerApp.request(
      `/api/v1/pipelines/ticket-to-code/${created.run.id}/resume`,
      { method: 'POST' },
    )
    expect(res3.status).toBe(200)
  })

  it('GET list returns the created runs', async () => {
    await ownerApp.request('/api/v1/pipelines/ticket-to-code/start', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ ticketSource: 'board', ticketId: 'task-4201' }),
    })
    const res = await ownerApp.request('/api/v1/pipelines/ticket-to-code')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
  })
})
