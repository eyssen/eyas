// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Security: skill-generation routes drive AI generation and ADOPT generated
// skills into the running system. They must require authentication + the
// SkillProposal CASL permission. (The factory is not mounted by default today,
// but it must be secure-by-default for when it is wired.)

import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createSkillGenerationRoutes } from '@modules/skill-generation/routes.js'

const deps = {
  traceSource: { listSuccessfulTraces: () => [] },
  extractor: { extract: () => [] },
  generator: { generate: async () => ({}) },
  abRunner: { runExperiment: async () => ({}) },
  adopter: { process: async () => ({}) },
  logger: { error() {}, info() {}, warn() {}, debug() {} },
  lookupSkill: async () => null,
  lookupExperiment: async () => null,
  lookupCandidate: async () => null,
}

function mount(ability?: { can: (a: string, s: string) => boolean }) {
  const app = new Hono()
  if (ability) app.use('*', async (c, next) => { (c as any).set('ability', ability); await next() })
  createSkillGenerationRoutes(app as any, deps as any)
  return app
}

describe('skill-generation routes require auth + SkillProposal permission', () => {
  it('returns 401 for an unauthenticated candidate listing', async () => {
    const res = await mount().request('/api/v1/skill-generation/candidates')
    expect(res.status).toBe(401)
  })

  it('returns 401 for an unauthenticated adopt', async () => {
    const res = await mount().request('/api/v1/skill-generation/experiments/x/adopt', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('returns 403 when the ability denies SkillProposal', async () => {
    const res = await mount({ can: () => false }).request('/api/v1/skill-generation/candidates')
    expect(res.status).toBe(403)
  })

  it('allows the candidate listing when the ability grants it', async () => {
    const res = await mount({ can: () => true }).request('/api/v1/skill-generation/candidates')
    expect(res.status).toBe(200)
  })
})
