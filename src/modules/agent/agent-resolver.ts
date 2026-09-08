// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface AgentResolverDeps {
  getAgent: (id: string) => { id: string } | undefined
  getProject: (id: string) => { defaultAgentId: string | null; typeId: string | null } | null
  getProjectType: (id: string) => { defaultAgentId: string | null } | null
  listPrimaryAgents: () => { id: string; enabled: boolean }[]
}

export function createAgentResolver(deps: AgentResolverDeps) {
  return {
    resolve(input: { agentId: string | null; projectId: string | null }): string | null {
      // 1. Conversation's explicit agentId
      if (input.agentId) {
        const agent = deps.getAgent(input.agentId)
        if (agent) return agent.id
      }

      if (input.projectId) {
        const project = deps.getProject(input.projectId)

        // 2. Project's defaultAgentId
        if (project?.defaultAgentId) {
          const agent = deps.getAgent(project.defaultAgentId)
          if (agent) return agent.id
        }

        // 3. ProjectType's defaultAgentId
        if (project?.typeId) {
          const pt = deps.getProjectType(project.typeId)
          if (pt?.defaultAgentId) {
            const agent = deps.getAgent(pt.defaultAgentId)
            if (agent) return agent.id
          }
        }
      }

      // 4. First enabled primary agent
      const primaries = deps.listPrimaryAgents()
      const first = primaries.find(a => a.enabled)
      return first?.id ?? null
    },
  }
}
