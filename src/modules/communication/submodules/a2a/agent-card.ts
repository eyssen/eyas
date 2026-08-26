// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { AgentCard, AgentCardSkill } from './types.js'
import { getVersion } from '@core/version.js'

export interface AgentCardOptions {
  name?: string
  description?: string
  url: string
  version?: string
  streaming?: boolean
  pushNotifications?: boolean
  authSchemes?: string[]
}

/**
 * Generate an A2A-compliant agent card from registered skills.
 * Exposed at /.well-known/agent-card.json
 */
export function generateAgentCard(
  skills: AgentCardSkill[],
  options: AgentCardOptions,
): AgentCard {
  return {
    name: options.name ?? 'EYAS',
    description: options.description ?? 'Personal AI assistant with multi-agent orchestration',
    url: options.url,
    version: options.version ?? getVersion(),
    capabilities: {
      streaming: options.streaming ?? true,
      pushNotifications: options.pushNotifications ?? false,
    },
    skills,
    authentication: {
      schemes: options.authSchemes ?? ['bearer'],
    },
  }
}

/** Default skills exposed in the agent card */
export const DEFAULT_SKILLS: AgentCardSkill[] = [
  { id: 'research', name: 'Deep Research', description: 'Multi-step research with source evaluation' },
  { id: 'code-review', name: 'Code Review', description: 'Security-focused code review' },
]
