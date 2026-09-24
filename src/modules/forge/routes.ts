// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Hono } from 'hono'
import { requirePermission } from '@modules/permissions/middleware'
import type { createFeedbackCollector } from './feedback-collector.js'
import type { createFrictionAnalyzer } from './friction-analyzer.js'
import type { createProposalStore } from './proposal-store.js'
import type { createProposalEngine } from './proposal-engine.js'
import type { createExperimentRunner } from './experiment-runner.js'
import type { createProposalApplier } from './applier.js'
import type { createSoulProposalApplier } from './soul-proposal-applier.js'
import type { ForgeTarget } from './types.js'

export interface ForgeServices {
  collector: ReturnType<typeof createFeedbackCollector>
  analyzer: ReturnType<typeof createFrictionAnalyzer>
  proposalStore: ReturnType<typeof createProposalStore>
  proposalEngine: ReturnType<typeof createProposalEngine>
  experimentRunner: ReturnType<typeof createExperimentRunner>
  applier: ReturnType<typeof createProposalApplier>
  /** Optional: wired by registerPhase6ForgeTools when prompt-wizard is available */
  soulApplier?: ReturnType<typeof createSoulProposalApplier>
}

export function createForgeRoutes(app: Hono, services: ForgeServices) {
  const { collector, analyzer, proposalStore, proposalEngine, experimentRunner, applier, soulApplier } = services
  const api = new Hono()

  // List feedback for a target
  api.get('/forge/feedback', requirePermission('read', 'Forge'), (c) => {
    const target = c.req.query('target') as ForgeTarget | undefined
    const targetId = c.req.query('targetId')
    if (!target || !targetId) {
      return c.json({ error: 'target and targetId query params are required' }, 400)
    }
    if (target !== 'skill' && target !== 'tool') {
      return c.json({ error: 'target must be "skill" or "tool"' }, 400)
    }
    const feedback = collector.listForTarget(target, targetId)
    return c.json({ feedback })
  })

  // Record new feedback
  api.post('/forge/feedback', requirePermission('write', 'Forge'), async (c) => {
    const body = await c.req.json()
    if (!body.target || !body.targetId || !body.conversationId || typeof body.useful !== 'boolean') {
      return c.json({ error: 'target, targetId, conversationId, and useful are required' }, 400)
    }
    if (body.target !== 'skill' && body.target !== 'tool') {
      return c.json({ error: 'target must be "skill" or "tool"' }, 400)
    }
    const feedback = collector.record(body)
    return c.json({ feedback }, 201)
  })

  // List proposals with optional status/target filter
  api.get('/forge/proposals', requirePermission('read', 'Forge'), (c) => {
    const status = c.req.query('status')
    const target = c.req.query('target') // 'soul' | 'skill' | 'tool' | undefined
    const validStatuses = ['pending', 'testing', 'approved', 'rejected', 'applied']
    const statusFilter = status && validStatuses.includes(status) ? status : undefined
    let proposals = proposalStore.list(statusFilter)
    if (target) {
      proposals = proposals.filter((p) => p.target === target)
    }
    return c.json({ proposals })
  })

  // Get single proposal
  api.get('/forge/proposals/:id', requirePermission('read', 'Forge'), (c) => {
    const proposal = proposalStore.get(c.req.param('id'))
    if (!proposal) return c.json({ error: 'Not found' }, 404)
    return c.json({ proposal })
  })

  // Approve and apply proposal — for soul proposals dispatches to soulApplier
  api.post('/forge/proposals/:id/apply', requirePermission('manage', 'Forge'), async (c) => {
    const proposal = proposalStore.get(c.req.param('id'))
    if (!proposal) return c.json({ error: 'Not found' }, 404)
    if (proposal.status !== 'pending' && proposal.status !== 'testing') {
      return c.json({ error: `Cannot apply proposal with status "${proposal.status}"` }, 400)
    }
    if ((proposal as any).target === 'soul') {
      if (!soulApplier) {
        return c.json({ error: 'Soul applier not available (prompt-wizard module not loaded)' }, 503)
      }
      const result = await soulApplier.apply(proposal.id)
      return c.json({ proposal: proposalStore.get(proposal.id), applyResult: result })
    }
    const result = applier.apply(proposal)
    proposalStore.updateStatus(proposal.id, result.success ? 'applied' : 'approved')
    return c.json({ proposal: proposalStore.get(proposal.id), applyResult: result })
  })

  // Approve and apply proposal (legacy alias — kept for backward compat)
  api.post('/forge/proposals/:id/approve', requirePermission('manage', 'Forge'), async (c) => {
    const proposal = proposalStore.get(c.req.param('id'))
    if (!proposal) return c.json({ error: 'Not found' }, 404)
    if (proposal.status !== 'pending' && proposal.status !== 'testing') {
      return c.json({ error: `Cannot approve proposal with status "${proposal.status}"` }, 400)
    }
    if ((proposal as any).target === 'soul') {
      if (!soulApplier) {
        return c.json({ error: 'Soul applier not available (prompt-wizard module not loaded)' }, 503)
      }
      const result = await soulApplier.apply(proposal.id)
      return c.json({ proposal: proposalStore.get(proposal.id), applyResult: result })
    }
    const result = applier.apply(proposal)
    proposalStore.updateStatus(proposal.id, result.success ? 'applied' : 'approved')
    return c.json({ proposal: proposalStore.get(proposal.id), applyResult: result })
  })

  // Reject proposal — for soul proposals dispatches to soulApplier
  api.post('/forge/proposals/:id/reject', requirePermission('manage', 'Forge'), async (c) => {
    const proposal = proposalStore.get(c.req.param('id'))
    if (!proposal) return c.json({ error: 'Not found' }, 404)
    if (proposal.status !== 'pending' && proposal.status !== 'testing') {
      return c.json({ error: `Cannot reject proposal with status "${proposal.status}"` }, 400)
    }
    if ((proposal as any).target === 'soul' && soulApplier) {
      await soulApplier.reject(proposal.id)
      return c.json({ proposal: proposalStore.get(proposal.id) })
    }
    proposalStore.updateStatus(proposal.id, 'rejected')
    return c.json({ proposal: proposalStore.get(proposal.id) })
  })

  // Start experiment for proposal
  api.post('/forge/proposals/:id/test', requirePermission('manage', 'Forge'), (c) => {
    const proposal = proposalStore.get(c.req.param('id'))
    if (!proposal) return c.json({ error: 'Not found' }, 404)
    if (proposal.status !== 'pending') {
      return c.json({ error: `Cannot test proposal with status "${proposal.status}"` }, 400)
    }
    const experiment = experimentRunner.create(proposal.id)
    return c.json({ experiment })
  })

  // List experiments for proposal
  api.get('/forge/experiments/:proposalId', requirePermission('read', 'Forge'), (c) => {
    const experiments = experimentRunner.listForProposal(c.req.param('proposalId'))
    return c.json({ experiments })
  })

  // Manual trigger scan
  api.post('/forge/scan', requirePermission('manage', 'Forge'), async (c) => {
    const patterns = analyzer.analyze()
    let created = 0
    for (const pattern of patterns) {
      const proposals = await proposalEngine.generateFromFriction(pattern)
      created += proposals.length
    }
    return c.json({ patterns: patterns.length, proposalsCreated: created })
  })

  app.route('/api/v1', api)
}
