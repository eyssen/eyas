// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { parse as parseYaml } from 'yaml'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import type { AgentDefinition, CreateAgentInput, AgentFilter } from './types'

export interface AgentRegistry {
  create(input: CreateAgentInput): AgentDefinition
  get(id: string): AgentDefinition | undefined
  list(filter?: AgentFilter): AgentDefinition[]
  update(id: string, patch: Partial<CreateAgentInput>): void
  delete(id: string): void
  toggle(id: string): void
  getByCapability(capability: string): AgentDefinition[]
  addTokenUsage(id: string, tokens: number): void
  isWithinBudget(id: string): boolean
  resetMonthlyBudgets(): void
  seedFromDirectory(dir: string): Promise<number>
}

function toAgentDefinition(raw: any): AgentDefinition {
  return {
    id: raw.id,
    name: raw.name,
    role: raw.role ?? '',
    description: raw.description ?? '',
    goal: raw.goal ?? '',
    backstory: raw.backstory ?? '',
    tier: (raw.tier ?? 'specialist') as any,
    agentType: (raw.agent_type ?? 'assistant') as any,
    systemPrompt: raw.system_prompt ?? '',
    capabilities: raw.capabilities ? JSON.parse(raw.capabilities) : [],
    tools: raw.tools ? JSON.parse(raw.tools) : [],
    constraints: raw.constraints ? JSON.parse(raw.constraints) : [],
    model: raw.model ?? undefined,
    maxTurns: raw.max_turns ?? undefined,
    effort: raw.effort ?? undefined,
    enabled: raw.enabled === 1,
    source: raw.source as 'seed' | 'user' | 'generated',
    avatar: raw.avatar ?? undefined,
    tags: raw.tags ? JSON.parse(raw.tags) : [],
    monthlyTokenBudget: raw.monthly_token_budget ?? 0,
    tokensUsedThisMonth: raw.tokens_used_month ?? 0,
    budgetResetAt: raw.budget_reset_at ?? undefined,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

export function createAgentRegistry(db: any): AgentRegistry {
  return {
    create(input: CreateAgentInput): AgentDefinition {
      const now = new Date().toISOString()
      const enabled = input.enabled ?? true
      const source = input.source ?? 'user'

      db.run(sql`INSERT INTO agent_definitions
        (id, name, role, description, goal, backstory, tier, agent_type, system_prompt, capabilities, tools, constraints, model, max_turns, effort, enabled, source, avatar, tags, monthly_token_budget, tokens_used_month, created_at, updated_at)
        VALUES (
          ${input.id},
          ${input.name},
          ${input.role},
          ${input.description},
          ${input.goal ?? ''},
          ${input.backstory ?? ''},
          ${input.tier ?? 'specialist'},
          ${input.agentType ?? 'assistant'},
          ${input.systemPrompt},
          ${JSON.stringify(input.capabilities)},
          ${JSON.stringify(input.tools)},
          ${JSON.stringify(input.constraints)},
          ${input.model ?? null},
          ${input.maxTurns ?? null},
          ${input.effort ?? null},
          ${enabled ? 1 : 0},
          ${source},
          ${input.avatar ?? null},
          ${JSON.stringify(input.tags ?? [])},
          ${input.monthlyTokenBudget ?? 0},
          ${0},
          ${now},
          ${now}
        )`)

      return {
        id: input.id,
        name: input.name,
        role: input.role,
        description: input.description,
        goal: input.goal ?? '',
        backstory: input.backstory ?? '',
        tier: (input.tier ?? 'specialist') as any,
        agentType: (input.agentType ?? 'assistant') as any,
        systemPrompt: input.systemPrompt,
        capabilities: input.capabilities,
        tools: input.tools,
        constraints: input.constraints,
        model: input.model,
        maxTurns: input.maxTurns,
        effort: input.effort ?? undefined,
        enabled,
        source,
        avatar: input.avatar,
        tags: input.tags ?? [],
        monthlyTokenBudget: input.monthlyTokenBudget ?? 0,
        tokensUsedThisMonth: 0,
        createdAt: now,
        updatedAt: now,
      }
    },

    get(id: string): AgentDefinition | undefined {
      const rows = db.all(sql`SELECT * FROM agent_definitions WHERE id = ${id}`) as any[]
      if (rows.length === 0) return undefined
      return toAgentDefinition(rows[0])
    },

    list(filter?: AgentFilter): AgentDefinition[] {
      // Build query based on filters
      if (!filter) {
        const rows = db.all(sql`SELECT * FROM agent_definitions ORDER BY name ASC`) as any[]
        return rows.map(toAgentDefinition)
      }

      // Apply filters incrementally — start with all, then narrow down in JS
      // This keeps the SQL simple and avoids dynamic query building
      let rows: any[]

      if (filter.enabled !== undefined && filter.source !== undefined) {
        rows = db.all(sql`SELECT * FROM agent_definitions WHERE enabled = ${filter.enabled ? 1 : 0} AND source = ${filter.source} ORDER BY name ASC`) as any[]
      } else if (filter.enabled !== undefined) {
        rows = db.all(sql`SELECT * FROM agent_definitions WHERE enabled = ${filter.enabled ? 1 : 0} ORDER BY name ASC`) as any[]
      } else if (filter.source !== undefined) {
        rows = db.all(sql`SELECT * FROM agent_definitions WHERE source = ${filter.source} ORDER BY name ASC`) as any[]
      } else {
        rows = db.all(sql`SELECT * FROM agent_definitions ORDER BY name ASC`) as any[]
      }

      let agents = rows.map(toAgentDefinition)

      if (filter.capability) {
        agents = agents.filter(a => a.capabilities.includes(filter.capability!))
      }
      if (filter.tag) {
        agents = agents.filter(a => a.tags?.includes(filter.tag!))
      }
      if (filter.tier) {
        agents = agents.filter(a => a.tier === filter.tier)
      }
      if (filter.agentType) {
        agents = agents.filter(a => a.agentType === filter.agentType)
      }

      return agents
    },

    update(id: string, patch: Partial<CreateAgentInput>): void {
      const existing = this.get(id)
      if (!existing) throw new Error(`Agent not found: ${id}`)

      const now = new Date().toISOString()

      // Merge patch with existing values
      const name = patch.name ?? existing.name
      const role = patch.role ?? existing.role
      const description = patch.description ?? existing.description
      const goal = patch.goal ?? existing.goal
      const backstory = patch.backstory ?? existing.backstory
      const tier = patch.tier ?? existing.tier
      const agentType = patch.agentType ?? existing.agentType
      const systemPrompt = patch.systemPrompt ?? existing.systemPrompt
      const capabilities = patch.capabilities ?? existing.capabilities
      const tools = patch.tools ?? existing.tools
      const constraints = patch.constraints ?? existing.constraints
      const model = patch.model !== undefined ? patch.model : (existing.model ?? null)
      const maxTurns = patch.maxTurns !== undefined ? patch.maxTurns : (existing.maxTurns ?? null)
      const effort = patch.effort !== undefined ? patch.effort : (existing.effort ?? null)
      const enabled = patch.enabled !== undefined ? patch.enabled : existing.enabled
      const avatar = patch.avatar !== undefined ? patch.avatar : (existing.avatar ?? null)
      const tags = patch.tags ?? existing.tags ?? []
      const monthlyTokenBudget = patch.monthlyTokenBudget ?? existing.monthlyTokenBudget ?? 0

      db.run(sql`UPDATE agent_definitions SET
        name = ${name},
        role = ${role},
        description = ${description},
        goal = ${goal},
        backstory = ${backstory},
        tier = ${tier},
        agent_type = ${agentType},
        system_prompt = ${systemPrompt},
        capabilities = ${JSON.stringify(capabilities)},
        tools = ${JSON.stringify(tools)},
        constraints = ${JSON.stringify(constraints)},
        model = ${model ?? null},
        max_turns = ${maxTurns ?? null},
        effort = ${effort ?? null},
        enabled = ${enabled ? 1 : 0},
        avatar = ${avatar ?? null},
        tags = ${JSON.stringify(tags)},
        monthly_token_budget = ${monthlyTokenBudget},
        updated_at = ${now}
        WHERE id = ${id}`)
    },

    delete(id: string): void {
      const existing = this.get(id)
      if (!existing) throw new Error(`Agent not found: ${id}`)
      if (existing.source === 'seed') {
        throw new Error(`Cannot delete seed agent: ${id}. Disable it instead.`)
      }
      db.run(sql`DELETE FROM agent_definitions WHERE id = ${id}`)
    },

    toggle(id: string): void {
      const existing = this.get(id)
      if (!existing) throw new Error(`Agent not found: ${id}`)
      const now = new Date().toISOString()
      const newEnabled = existing.enabled ? 0 : 1
      db.run(sql`UPDATE agent_definitions SET enabled = ${newEnabled}, updated_at = ${now} WHERE id = ${id}`)
    },

    getByCapability(capability: string): AgentDefinition[] {
      // Fetch all enabled agents and filter by capability in JS (JSON field)
      const rows = db.all(sql`SELECT * FROM agent_definitions WHERE enabled = 1 ORDER BY name ASC`) as any[]
      return rows.map(toAgentDefinition).filter(a => a.capabilities.includes(capability))
    },

    addTokenUsage(id: string, tokens: number): void {
      const now = new Date().toISOString()
      db.run(sql`UPDATE agent_definitions SET
        tokens_used_month = tokens_used_month + ${tokens},
        updated_at = ${now}
        WHERE id = ${id}`)
    },

    isWithinBudget(id: string): boolean {
      const agent = this.get(id)
      if (!agent) return false
      // 0 = unlimited budget
      if (!agent.monthlyTokenBudget || agent.monthlyTokenBudget === 0) return true
      return (agent.tokensUsedThisMonth ?? 0) < agent.monthlyTokenBudget
    },

    resetMonthlyBudgets(): void {
      const now = new Date().toISOString()
      db.run(sql`UPDATE agent_definitions SET tokens_used_month = 0, budget_reset_at = ${now}, updated_at = ${now}`)
    },

    async seedFromDirectory(dir: string): Promise<number> {
      let files: string[]
      try {
        const entries = await readdir(dir)
        files = entries.filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
      } catch {
        return 0
      }

      let count = 0
      for (const file of files) {
        try {
          const content = await readFile(join(dir, file), 'utf-8')
          const data = parseYaml(content) as CreateAgentInput
          if (!data.id || !data.name) continue

          const now = new Date().toISOString()
          // INSERT OR IGNORE — skip if agent already exists
          db.run(sql`INSERT OR IGNORE INTO agent_definitions
            (id, name, role, description, goal, backstory, tier, agent_type, system_prompt, capabilities, tools, constraints, model, max_turns, enabled, source, avatar, tags, monthly_token_budget, tokens_used_month, created_at, updated_at)
            VALUES (
              ${data.id},
              ${data.name},
              ${data.role ?? ''},
              ${data.description ?? ''},
              ${(data as any).goal ?? ''},
              ${(data as any).backstory ?? ''},
              ${data.tier ?? 'specialist'},
              ${data.agentType ?? 'assistant'},
              ${data.systemPrompt ?? ''},
              ${JSON.stringify(data.capabilities ?? [])},
              ${JSON.stringify(data.tools ?? [])},
              ${JSON.stringify(data.constraints ?? [])},
              ${data.model ?? null},
              ${data.maxTurns ?? null},
              ${data.enabled !== false ? 1 : 0},
              ${'seed'},
              ${data.avatar ?? null},
              ${JSON.stringify(data.tags ?? [])},
              ${data.monthlyTokenBudget ?? 0},
              ${0},
              ${now},
              ${now}
            )`)
          count++
        } catch {
          // Skip invalid files silently
        }
      }

      return count
    },
  }
}
