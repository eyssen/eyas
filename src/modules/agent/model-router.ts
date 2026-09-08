// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface ModelRoutingRule {
  taskType: string
  complexity: string
  provider: string
  model: string
  reasoning: string
}

export interface ModelSelection {
  provider: string
  model: string
}

const DEFAULT_RULES: ModelRoutingRule[] = [
  { taskType: 'architecture', complexity: 'complex', provider: 'anthropic', model: 'claude-opus-4-8', reasoning: 'Complex reasoning needed' },
  { taskType: 'architecture', complexity: 'moderate', provider: 'anthropic', model: 'claude-sonnet-4-6', reasoning: 'Good balance' },
  { taskType: 'implementation', complexity: 'complex', provider: 'anthropic', model: 'claude-sonnet-4-6', reasoning: 'Good quality/cost' },
  { taskType: 'implementation', complexity: 'simple', provider: 'anthropic', model: 'claude-haiku-4-5', reasoning: 'Fast and cheap' },
  { taskType: 'review', complexity: 'complex', provider: 'anthropic', model: 'claude-opus-4-8', reasoning: 'Precision critical' },
  { taskType: 'review', complexity: 'moderate', provider: 'anthropic', model: 'claude-sonnet-4-6', reasoning: 'Good quality/cost' },
  { taskType: 'test', complexity: 'moderate', provider: 'anthropic', model: 'claude-sonnet-4-6', reasoning: 'Pattern-heavy' },
  { taskType: 'test', complexity: 'simple', provider: 'anthropic', model: 'claude-haiku-4-5', reasoning: 'Fast' },
  { taskType: 'docs', complexity: 'moderate', provider: 'anthropic', model: 'claude-sonnet-4-6', reasoning: 'Good writing' },
  { taskType: 'docs', complexity: 'simple', provider: 'anthropic', model: 'claude-haiku-4-5', reasoning: 'Fast' },
  { taskType: 'lookup', complexity: 'trivial', provider: 'anthropic', model: 'claude-haiku-4-5', reasoning: 'Minimal reasoning' },
]

export function createModelRouter() {
  const rules = [...DEFAULT_RULES]
  const overrides = new Map<string, ModelSelection>() // "taskType:complexity" → override

  return {
    selectModel(taskType: string, complexity: string, _budgetRemaining?: number): ModelSelection {
      // Check overrides first (from self-learning)
      const key = `${taskType}:${complexity}`
      const override = overrides.get(key)
      if (override) return override

      // Find matching rule
      const exact = rules.find(r => r.taskType === taskType && r.complexity === complexity)
      if (exact) return { provider: exact.provider, model: exact.model }

      // Fallback: find by taskType only (any complexity)
      const byType = rules.find(r => r.taskType === taskType)
      if (byType) return { provider: byType.provider, model: byType.model }

      // Ultimate fallback: sonnet
      return { provider: 'anthropic', model: 'claude-sonnet-4-6' }
    },

    getRoutingTable(): ModelRoutingRule[] {
      return [...rules]
    },

    updateRule(taskType: string, complexity: string, provider: string, model: string): void {
      overrides.set(`${taskType}:${complexity}`, { provider, model })
    },

    clearOverrides(): void {
      overrides.clear()
    },
  }
}
