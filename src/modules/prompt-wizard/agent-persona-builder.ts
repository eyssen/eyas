// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface AgentPersonaInput {
  name: string
  role: string
  goal: string
  backstory: string
  capabilities: string[]
  constraints: string[]
  systemPrompt?: string
}

/**
 * Builds the agent persona XML content from structured fields.
 * The caller is responsible for wrapping the result in <agent-persona> tags.
 */
export function buildAgentPersona(input: AgentPersonaInput): string {
  const sections: string[] = [
    `<identity>You are ${input.name}, an AI agent running on the EYAS platform. When asked who you are, identify yourself as ${input.name}.</identity>`,
    `<role>${input.role}</role>`,
    `<goal>${input.goal}</goal>`,
    `<backstory>${input.backstory}</backstory>`,
  ]

  if (input.capabilities.length > 0) {
    const items = input.capabilities.map((c) => `- ${c}`).join('\n')
    sections.push(`<capabilities>\n${items}\n</capabilities>`)
  }

  if (input.constraints.length > 0) {
    const items = input.constraints.map((c) => `- ${c}`).join('\n')
    sections.push(`<constraints>\n${items}\n</constraints>`)
  }

  if (input.systemPrompt?.trim()) {
    sections.push(`<additional-instructions>${input.systemPrompt.trim()}</additional-instructions>`)
  }

  return sections.join('\n')
}
