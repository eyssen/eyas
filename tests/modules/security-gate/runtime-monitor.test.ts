import { describe, it, expect, beforeEach } from 'vitest'
import { createRuntimeMonitor } from '@modules/security-gate/runtime-monitor'
import { DEFAULT_CONFIG } from '@modules/security-gate/types'
import type { SecurityGateConfig } from '@modules/security-gate/types'

describe('RuntimeMonitor', () => {
  let monitor: ReturnType<typeof createRuntimeMonitor>
  let config: SecurityGateConfig

  beforeEach(() => {
    config = { ...DEFAULT_CONFIG }
    monitor = createRuntimeMonitor(config)
  })

  describe('session lifecycle', () => {
    it('starts and ends a session', () => {
      monitor.startSession('s1', 'Build a module', 10_000)
      expect(monitor.getSessionEvents('s1')).toEqual([])

      monitor.endSession('s1')
      expect(monitor.getSessionEvents('s1')).toEqual([])
    })

    it('returns null for unknown session on recordTurn', () => {
      const result = monitor.recordTurn('nonexistent', 100)
      expect(result).toBeNull()
    })

    it('returns null for unknown session on recordToolCall', () => {
      const result = monitor.recordToolCall('nonexistent', 'search', true, 'green')
      expect(result).toBeNull()
    })
  })

  describe('token waste detection', () => {
    it('emits token_waste when budget ratio exceeds threshold with no successes', () => {
      // tokenWasteThreshold = 0.5, so >50% of budget with 0 successes triggers
      monitor.startSession('s1', 'Goal', 1000)

      // Use 600 tokens (60% of 1000) with no successful tool calls
      const event = monitor.recordTurn('s1', 600)

      expect(event).not.toBeNull()
      expect(event!.type).toBe('token_waste')
      expect(event!.severity).toBe('warning')
      expect(event!.details).toContain('60%')
    })

    it('does not emit token_waste when below threshold', () => {
      monitor.startSession('s1', 'Goal', 1000)

      // Use 400 tokens (40% < 50%)
      const event = monitor.recordTurn('s1', 400)
      expect(event).toBeNull()
    })

    it('does not emit token_waste when there are successful tool calls', () => {
      monitor.startSession('s1', 'Goal', 1000)

      // Register a success first
      monitor.recordToolCall('s1', 'search', true, 'green')

      // Now use lots of tokens — no waste event because there are successes
      const event = monitor.recordTurn('s1', 900)
      expect(event).toBeNull()
    })

    it('does not emit token_waste when budget is 0 (unlimited)', () => {
      monitor.startSession('s1', 'Goal', 0)

      const event = monitor.recordTurn('s1', 999_999)
      expect(event).toBeNull()
    })
  })

  describe('cumulative risk scoring', () => {
    it('scores red tool calls at 3 points', () => {
      monitor.startSession('s1', 'Goal', 10_000)
      // cumulativeRiskCap = 10 by default, so 4 red calls (12 points) should trigger
      monitor.recordToolCall('s1', 'run_command', true, 'red')
      monitor.recordToolCall('s1', 'run_command', true, 'red')
      monitor.recordToolCall('s1', 'run_command', true, 'red')
      const event = monitor.recordToolCall('s1', 'run_command', true, 'red')

      expect(event).not.toBeNull()
      expect(event!.type).toBe('risk_escalation')
      expect(event!.severity).toBe('critical')
      expect(event!.details).toContain('12')
    })

    it('scores yellow tool calls at 1 point', () => {
      monitor.startSession('s1', 'Goal', 10_000)
      // Need 10 yellow calls (10 points) to hit cap
      for (let i = 0; i < 9; i++) {
        expect(monitor.recordToolCall('s1', 'save_memory', true, 'yellow')).toBeNull()
      }
      const event = monitor.recordToolCall('s1', 'save_memory', true, 'yellow')
      expect(event).not.toBeNull()
      expect(event!.type).toBe('risk_escalation')
    })

    it('scores green tool calls at 0 points', () => {
      monitor.startSession('s1', 'Goal', 10_000)
      // Any number of green calls should be fine
      for (let i = 0; i < 100; i++) {
        expect(monitor.recordToolCall('s1', 'search', true, 'green')).toBeNull()
      }
    })

    it('accumulates mixed risk tiers', () => {
      monitor.startSession('s1', 'Goal', 10_000)
      // 3 red (9) + 1 yellow (1) = 10 → triggers at cap
      monitor.recordToolCall('s1', 'run_command', true, 'red')     // 3
      monitor.recordToolCall('s1', 'run_command', true, 'red')     // 6
      monitor.recordToolCall('s1', 'run_command', true, 'red')     // 9
      const event = monitor.recordToolCall('s1', 'save_memory', true, 'yellow') // 10
      expect(event).not.toBeNull()
      expect(event!.type).toBe('risk_escalation')
    })
  })

  describe('shouldHalt', () => {
    it('returns false for fresh session', () => {
      monitor.startSession('s1', 'Goal', 10_000)
      const { halt } = monitor.shouldHalt('s1')
      expect(halt).toBe(false)
    })

    it('returns false for unknown session', () => {
      const { halt } = monitor.shouldHalt('nonexistent')
      expect(halt).toBe(false)
    })

    it('halts when cumulative risk exceeds cap', () => {
      monitor.startSession('s1', 'Goal', 10_000)
      // 4 red calls = 12 points > 10 cap
      for (let i = 0; i < 4; i++) {
        monitor.recordToolCall('s1', 'cmd', true, 'red')
      }
      const { halt, reason } = monitor.shouldHalt('s1')
      expect(halt).toBe(true)
      expect(reason).toContain('risk score')
    })

    it('halts after >5 consecutive failures with no success', () => {
      monitor.startSession('s1', 'Goal', 10_000)
      for (let i = 0; i < 6; i++) {
        monitor.recordToolCall('s1', 'search', false, 'green')
      }
      const { halt, reason } = monitor.shouldHalt('s1')
      expect(halt).toBe(true)
      expect(reason).toContain('tool failures')
    })

    it('does not halt on failures if there is at least one success', () => {
      monitor.startSession('s1', 'Goal', 10_000)
      monitor.recordToolCall('s1', 'search', true, 'green')
      for (let i = 0; i < 10; i++) {
        monitor.recordToolCall('s1', 'search', false, 'green')
      }
      const { halt } = monitor.shouldHalt('s1')
      expect(halt).toBe(false)
    })
  })

  describe('getSessionEvents', () => {
    it('returns all events accumulated during session', () => {
      monitor.startSession('s1', 'Goal', 1000)
      monitor.recordTurn('s1', 600)  // triggers token_waste
      // 4 red calls to trigger risk_escalation
      for (let i = 0; i < 4; i++) {
        monitor.recordToolCall('s1', 'cmd', true, 'red')
      }

      const events = monitor.getSessionEvents('s1')
      expect(events.length).toBeGreaterThanOrEqual(2)
      expect(events.some(e => e.type === 'token_waste')).toBe(true)
      expect(events.some(e => e.type === 'risk_escalation')).toBe(true)
    })

    it('returns empty array for ended session', () => {
      monitor.startSession('s1', 'Goal', 1000)
      monitor.recordTurn('s1', 600)
      monitor.endSession('s1')

      expect(monitor.getSessionEvents('s1')).toEqual([])
    })
  })

  describe('custom config', () => {
    it('respects custom cumulative risk cap', () => {
      const customConfig = { ...DEFAULT_CONFIG, cumulativeRiskCap: 5 }
      const customMonitor = createRuntimeMonitor(customConfig)

      customMonitor.startSession('s1', 'Goal', 10_000)
      customMonitor.recordToolCall('s1', 'cmd', true, 'red') // 3
      const event = customMonitor.recordToolCall('s1', 'cmd', true, 'red') // 6 > 5

      expect(event).not.toBeNull()
      expect(event!.type).toBe('risk_escalation')
    })

    it('respects custom token waste threshold', () => {
      const customConfig = { ...DEFAULT_CONFIG, tokenWasteThreshold: 0.8 }
      const customMonitor = createRuntimeMonitor(customConfig)

      customMonitor.startSession('s1', 'Goal', 1000)

      // 60% should not trigger at 0.8 threshold
      expect(customMonitor.recordTurn('s1', 600)).toBeNull()

      // 85% should trigger
      const event = customMonitor.recordTurn('s1', 250) // total: 850/1000 = 85%
      expect(event).not.toBeNull()
      expect(event!.type).toBe('token_waste')
    })
  })
})
