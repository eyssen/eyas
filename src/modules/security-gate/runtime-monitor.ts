// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { SecurityGateConfig } from './types.js'

export interface MonitorEvent {
  type: 'drift_warning' | 'token_waste' | 'risk_escalation' | 'action_blocked' | 'session_halted'
  sessionId: string
  details: string
  severity: 'info' | 'warning' | 'critical'
  timestamp: string
}

interface SessionState {
  goalDescription: string
  totalTurns: number
  successfulToolCalls: number
  failedToolCalls: number
  tokensUsed: number
  tokenBudget: number
  cumulativeRiskScore: number
  events: MonitorEvent[]
}

/**
 * Checkpoint 3: Runtime Monitor.
 * Runs alongside agent execution, watching for drift, waste, and risk accumulation.
 */
export function createRuntimeMonitor(config: SecurityGateConfig) {
  const sessions = new Map<string, SessionState>()

  return {
    startSession(sessionId: string, goalDescription: string, tokenBudget: number): void {
      sessions.set(sessionId, {
        goalDescription, totalTurns: 0, successfulToolCalls: 0,
        failedToolCalls: 0, tokensUsed: 0, tokenBudget,
        cumulativeRiskScore: 0, events: [],
      })
    },

    recordTurn(sessionId: string, tokensUsed: number): MonitorEvent | null {
      const session = sessions.get(sessionId)
      if (!session) return null

      session.totalTurns++
      session.tokensUsed += tokensUsed

      // Token waste detection
      if (session.tokenBudget > 0) {
        const wasteRatio = session.tokensUsed / session.tokenBudget
        if (wasteRatio > config.tokenWasteThreshold && session.successfulToolCalls === 0) {
          const event: MonitorEvent = {
            type: 'token_waste', sessionId,
            details: `Used ${Math.round(wasteRatio * 100)}% of token budget with no successful tool calls`,
            severity: 'warning', timestamp: new Date().toISOString(),
          }
          session.events.push(event)
          return event
        }
      }

      return null
    },

    recordToolCall(sessionId: string, toolName: string, success: boolean, riskTier: string): MonitorEvent | null {
      const session = sessions.get(sessionId)
      if (!session) return null

      if (success) session.successfulToolCalls++
      else session.failedToolCalls++

      // Cumulative risk scoring
      const riskPoints = riskTier === 'red' ? 3 : riskTier === 'yellow' ? 1 : 0
      session.cumulativeRiskScore += riskPoints

      if (session.cumulativeRiskScore >= config.cumulativeRiskCap) {
        const event: MonitorEvent = {
          type: 'risk_escalation', sessionId,
          details: `Cumulative risk score ${session.cumulativeRiskScore} exceeds cap ${config.cumulativeRiskCap}`,
          severity: 'critical', timestamp: new Date().toISOString(),
        }
        session.events.push(event)
        return event
      }

      return null
    },

    shouldHalt(sessionId: string): { halt: boolean; reason?: string } {
      const session = sessions.get(sessionId)
      if (!session) return { halt: false }

      // Halt if cumulative risk exceeded
      if (session.cumulativeRiskScore >= config.cumulativeRiskCap) {
        return { halt: true, reason: `Cumulative risk score ${session.cumulativeRiskScore} exceeds cap` }
      }

      // Halt if too many consecutive failures
      if (session.failedToolCalls > 5 && session.successfulToolCalls === 0) {
        return { halt: true, reason: `${session.failedToolCalls} consecutive tool failures with no success` }
      }

      return { halt: false }
    },

    getSessionEvents(sessionId: string): MonitorEvent[] {
      return sessions.get(sessionId)?.events ?? []
    },

    endSession(sessionId: string): void {
      sessions.delete(sessionId)
    },
  }
}
