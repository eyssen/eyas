// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { AgentRegistry } from './agent-registry.js'
import type { AgentDefinition } from './types.js'

export interface BudgetStats {
  agentId: string
  agentName: string
  monthlyBudget: number          // 0 = unlimited
  tokensUsed: number
  percentage: number             // 0-100+
  isOverBudget: boolean
  projectedMonthly: number       // Based on current usage rate
  daysIntoMonth: number
  alertLevel: 'normal' | 'warning' | 'exceeded' | 'critical'  // <80, 80-100, 100-120, >120
}

export interface BudgetAlert {
  agentId: string
  level: 'warning' | 'exceeded' | 'critical'
  percentage: number
  message: string
  timestamp: string
}

interface BudgetEngineDeps {
  registry: AgentRegistry
  bus?: { emit(subject: string, data: unknown): void }
  /** Optional time source for deterministic tests */
  now?: () => number
  /** Alert dedup TTL in ms. Default 24h. */
  alertTtlMs?: number
  /** Max alert entries (LRU eviction). Default 10_000. */
  maxAlerts?: number
}

// Ordering from least to most severe; higher-indexed levels supersede lower ones for eviction.
const LEVEL_ORDER: Array<BudgetStats['alertLevel']> = ['normal', 'warning', 'exceeded', 'critical']

export function createBudgetEngine(deps: BudgetEngineDeps) {
  const { registry, bus } = deps
  const now = deps.now ?? (() => Date.now())
  const alertTtlMs = deps.alertTtlMs ?? 24 * 60 * 60 * 1000
  const maxAlerts = deps.maxAlerts ?? 10_000

  /**
   * Alert dedup store: "agentId:level" → timestamp of first alert.
   * Map preserves insertion order so evicting the oldest = delete the first key.
   */
  const alertsSent = new Map<string, number>()

  function sweepExpired(): void {
    const cutoff = now() - alertTtlMs
    for (const [key, ts] of alertsSent) {
      if (ts < cutoff) alertsSent.delete(key)
      else break // Map is insertion-ordered; stop at first non-expired
    }
  }

  function evictIfFull(): void {
    while (alertsSent.size >= maxAlerts) {
      const oldest = alertsSent.keys().next().value
      if (oldest === undefined) break
      alertsSent.delete(oldest)
    }
  }

  /** Drop dedup entries for levels at or above the given level for this agent. */
  function clearBandEntries(agentId: string, currentLevel: BudgetStats['alertLevel']): void {
    const currentIdx = LEVEL_ORDER.indexOf(currentLevel)
    for (const lvl of LEVEL_ORDER) {
      const lvlIdx = LEVEL_ORDER.indexOf(lvl)
      // When usage drops below a band, forget that band's dedup so a future
      // re-entry can alert again.
      if (lvlIdx > currentIdx) alertsSent.delete(`${agentId}:${lvl}`)
    }
  }

  function getAlertLevel(percentage: number): BudgetStats['alertLevel'] {
    if (percentage >= 120) return 'critical'
    if (percentage >= 100) return 'exceeded'
    if (percentage >= 80) return 'warning'
    return 'normal'
  }

  function checkAndEmitAlerts(agent: AgentDefinition): void {
    if (!agent.monthlyTokenBudget || agent.monthlyTokenBudget === 0) return
    if (!bus) return

    const percentage = ((agent.tokensUsedThisMonth ?? 0) / agent.monthlyTokenBudget) * 100
    const level = getAlertLevel(percentage)
    if (level === 'normal') {
      // Usage dropped back to normal — clear all alert entries for this agent so
      // next threshold crossing re-alerts.
      clearBandEntries(agent.id, 'normal')
      return
    }

    // Usage lies in some warning band — clear entries for bands *above* the current
    // one so we don't forever suppress re-alerts after a temporary spike.
    clearBandEntries(agent.id, level)

    sweepExpired()

    const key = `${agent.id}:${level}`
    const existing = alertsSent.get(key)
    if (existing !== undefined && now() - existing < alertTtlMs) return

    evictIfFull()
    alertsSent.set(key, now())

    const alert: BudgetAlert = {
      agentId: agent.id,
      level,
      percentage: Math.round(percentage),
      message: `Agent "${agent.name}" has used ${Math.round(percentage)}% of monthly token budget`,
      timestamp: new Date(now()).toISOString(),
    }
    bus.emit('eyas.agent.budget.alert', alert)
  }

  return {
    /**
     * Track token usage and check for budget alerts.
     * Wraps registry.addTokenUsage with alert emission.
     */
    trackUsage(agentId: string, tokens: number): void {
      registry.addTokenUsage(agentId, tokens)
      const agent = registry.get(agentId)
      if (agent) checkAndEmitAlerts(agent)
    },

    /**
     * Check if agent can execute (within budget).
     */
    canExecute(agentId: string): boolean {
      return registry.isWithinBudget(agentId)
    },

    /**
     * Get detailed budget statistics for an agent.
     */
    getStats(agentId: string): BudgetStats | null {
      const agent = registry.get(agentId)
      if (!agent) return null

      const budget = agent.monthlyTokenBudget ?? 0
      const used = agent.tokensUsedThisMonth ?? 0
      const percentage = budget > 0 ? (used / budget) * 100 : 0

      // Calculate projection
      const now = new Date()
      const dayOfMonth = now.getDate()
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      const dailyRate = dayOfMonth > 0 ? used / dayOfMonth : 0
      const projectedMonthly = Math.round(dailyRate * daysInMonth)

      return {
        agentId: agent.id,
        agentName: agent.name,
        monthlyBudget: budget,
        tokensUsed: used,
        percentage: Math.round(percentage * 10) / 10,
        isOverBudget: budget > 0 && used >= budget,
        projectedMonthly,
        daysIntoMonth: dayOfMonth,
        alertLevel: budget > 0 ? getAlertLevel(percentage) : 'normal',
      }
    },

    /**
     * Get stats for all agents with budgets.
     */
    getAllStats(): BudgetStats[] {
      return registry.list()
        .filter(a => (a.monthlyTokenBudget ?? 0) > 0)
        .map(a => this.getStats(a.id)!)
        .filter(Boolean)
    },

    /**
     * Monthly reset — call from scheduler on 1st of month.
     */
    resetAll(): void {
      registry.resetMonthlyBudgets()
      alertsSent.clear()
    },
  }
}
