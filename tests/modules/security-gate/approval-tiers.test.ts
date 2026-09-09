// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect } from 'vitest'
import {
  createApprovalTierPolicy,
  DEFAULT_APPROVAL_CONFIG,
  type ApprovalMode,
} from '@modules/security-gate/approval-tiers'

/**
 * Phase 3F — approval tier tests.
 *
 * The policy decides whether a *permitted* tool call still needs human
 * approval. These tests pin down the mode matrix and the precedence of
 * overrides (per-tool > per-user > per-tier > global) since that ordering
 * is the primary UX contract.
 */

describe('createApprovalTierPolicy', () => {
  describe('autopilot mode', () => {
    const policy = createApprovalTierPolicy({ mode: 'autopilot' })

    it('auto-allows green tools without approval', () => {
      const d = policy.decide('search_memory', 'green')
      expect(d.action).toBe('auto')
    })

    it('auto-allows even red tools without approval', () => {
      const d = policy.decide('run_command', 'red')
      expect(d.action).toBe('auto')
    })
  })

  describe('paranoid mode', () => {
    const policy = createApprovalTierPolicy({ mode: 'paranoid', requirePreviewForRed: true })

    it('requires approval for green tier', () => {
      const d = policy.decide('search_memory', 'green')
      expect(d.action).toBe('approve')
      if (d.action === 'approve') expect(d.requiresPreview).toBe(false)
    })

    it('requires approval + preview for red tier when requirePreviewForRed is on', () => {
      const d = policy.decide('run_command', 'red')
      expect(d.action).toBe('approve')
      if (d.action === 'approve') expect(d.requiresPreview).toBe(true)
    })

    it('requires approval without preview for red when requirePreviewForRed=false', () => {
      const p = createApprovalTierPolicy({ mode: 'paranoid', requirePreviewForRed: false })
      const d = p.decide('run_command', 'red')
      expect(d.action).toBe('approve')
      if (d.action === 'approve') expect(d.requiresPreview).toBe(false)
    })
  })

  describe('balanced mode', () => {
    const policy = createApprovalTierPolicy({ mode: 'balanced' })

    it('auto-allows green tools', () => {
      const d = policy.decide('search_memory', 'green')
      expect(d.action).toBe('auto')
    })

    it('requires approval for yellow tier', () => {
      const d = policy.decide('save_memory', 'yellow')
      expect(d.action).toBe('approve')
      if (d.action === 'approve') expect(d.requiresPreview).toBe(false)
    })

    it('requires approval + preview for red tier by default', () => {
      // DEFAULT_APPROVAL_CONFIG turns on requirePreviewForRed
      const p = createApprovalTierPolicy({ mode: 'balanced', requirePreviewForRed: true })
      const d = p.decide('run_command', 'red')
      expect(d.action).toBe('approve')
      if (d.action === 'approve') expect(d.requiresPreview).toBe(true)
    })
  })

  describe('override precedence', () => {
    it('per-tool override beats global mode', () => {
      const policy = createApprovalTierPolicy({
        mode: 'autopilot',
        perTool: { run_command: 'paranoid' },
      })
      expect(policy.decide('run_command', 'red').action).toBe('approve')
      // Other tools still auto
      expect(policy.decide('save_memory', 'yellow').action).toBe('auto')
    })

    it('per-user override beats per-tier and global', () => {
      const policy = createApprovalTierPolicy({
        mode: 'autopilot',
        perUser: { alice: 'paranoid' },
        perRiskTier: { red: 'balanced' },
      })
      expect(policy.decide('run_command', 'red', { userId: 'alice' }).action).toBe('approve')
      // Bob not listed → falls through to perRiskTier → red=balanced → still approve
      const bob = policy.decide('run_command', 'red', { userId: 'bob' })
      expect(bob.action).toBe('approve')
      // Bob + green → balanced → auto
      expect(policy.decide('search_memory', 'green', { userId: 'bob' }).action).toBe('auto')
    })

    it('per-tool wins over per-user', () => {
      const policy = createApprovalTierPolicy({
        mode: 'autopilot',
        perUser: { alice: 'paranoid' },
        perTool: { search_memory: 'autopilot' },
      })
      // Alice asking for search_memory: per-tool says autopilot even though
      // Alice globally is paranoid.
      expect(policy.decide('search_memory', 'green', { userId: 'alice' }).action).toBe('auto')
    })

    it('call-site modeOverride beats everything', () => {
      const policy = createApprovalTierPolicy({
        mode: 'autopilot',
        perTool: { run_command: 'autopilot' },
        perUser: { alice: 'autopilot' },
      })
      const d = policy.decide('run_command', 'red', { userId: 'alice', modeOverride: 'paranoid' })
      expect(d.action).toBe('approve')
    })

    it('per-risk-tier override is applied when nothing more specific matches', () => {
      const policy = createApprovalTierPolicy({
        mode: 'autopilot',
        perRiskTier: { red: 'paranoid' },
      })
      expect(policy.decide('run_command', 'red').action).toBe('approve')
      expect(policy.decide('save_memory', 'yellow').action).toBe('auto')
      expect(policy.decide('search_memory', 'green').action).toBe('auto')
    })
  })

  describe('resolveMode', () => {
    it('reports the effective mode without producing an action', () => {
      const policy = createApprovalTierPolicy({
        mode: 'balanced',
        perTool: { run_command: 'paranoid' },
      })
      expect(policy.resolveMode('run_command', 'red')).toBe('paranoid')
      expect(policy.resolveMode('search_memory', 'green')).toBe('balanced')
    })
  })

  describe('DEFAULT_APPROVAL_CONFIG', () => {
    it('defaults to autopilot — new deployments opt out of approval prompts', () => {
      // Rationale: turning approvals on by default would break existing tests
      // and surprise users. We ship the least restrictive mode; operators
      // explicitly opt in to paranoid/balanced.
      expect(DEFAULT_APPROVAL_CONFIG.mode).toBe<ApprovalMode>('autopilot')
      expect(DEFAULT_APPROVAL_CONFIG.requirePreviewForRed).toBe(true)
    })
  })
})
