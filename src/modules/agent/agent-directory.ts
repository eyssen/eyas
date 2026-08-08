// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface AgentSummary {
  id: string
  name: string
  role: string
  capabilities: string[]
  tier: string
}

export function createAgentDirectory(registry: { list(filter?: any): any[] }) {
  return {
    listAvailable(): AgentSummary[] {
      return registry.list().filter((a: any) => a.enabled).map((a: any) => ({
        id: a.id,
        name: a.name,
        role: a.role,
        capabilities: a.capabilities,
        tier: a.tier,
      }))
    },

    findByCapability(capability: string): AgentSummary[] {
      return this.listAvailable().filter(a => a.capabilities.includes(capability))
    },

    toPromptText(): string {
      const agents = this.listAvailable()
      if (agents.length === 0) return ''
      return agents.map(a =>
        `- ${a.name} (${a.id}): ${a.role} [${a.capabilities.join(', ')}]`
      ).join('\n')
    },
  }
}
