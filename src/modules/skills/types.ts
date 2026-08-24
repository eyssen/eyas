// Part of eYssen. See LICENSE file for full copyright and licensing details.

/** Skill types: knowledge (ambient context), tool (executable npm wrapper), integration (API caller) */
export type SkillType = 'knowledge' | 'tool' | 'integration'

/** Configuration for executable tool skills */
export interface ToolConfig {
  /** npm package to import (e.g. 'pdf-lib', 'cheerio') */
  package: string
  /** Specific named exports to use */
  imports?: string[]
  /** Function signature the agent should call via the skill executor */
  functions: ToolFunction[]
  /** Required environment variables */
  envVars?: string[]
}

/** A function exposed by a tool skill */
export interface ToolFunction {
  /** Function name */
  name: string
  /** Human-readable description */
  description: string
  /** Zod-compatible parameter schema (serialized) */
  parameters: Record<string, ToolParameter>
  /** Return type description */
  returns: string
}

/** Parameter definition for tool functions */
export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description: string
  required?: boolean
  default?: unknown
}

/** Configuration for integration skills (API connectors) */
export interface IntegrationConfig {
  /** Base URL or service identifier */
  baseUrl?: string
  /** Authentication method */
  auth: 'api_key' | 'oauth2' | 'bearer' | 'basic' | 'none'
  /** Secret name in secrets module */
  secretName?: string
  /** Available API operations */
  operations: IntegrationOperation[]
  /** Rate limit (requests per minute) */
  rateLimit?: number
}

/** An API operation exposed by an integration skill */
export interface IntegrationOperation {
  /** Operation name (e.g. 'create_issue', 'list_repos') */
  name: string
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** URL path (supports {param} placeholders) */
  path: string
  /** Human-readable description */
  description: string
  /** Parameter definitions */
  parameters?: Record<string, ToolParameter>
}

/** Attribution for external sources referenced by a skill */
export interface SkillSource {
  /** Project or library name */
  name: string
  /** Repository or documentation URL */
  url: string
  /** SPDX license identifier (e.g. 'MIT', 'Apache-2.0') */
  license: string
}

export interface Skill {
  id: string
  name: string
  description: string
  /** Skill category path (e.g. 'coding/languages', 'api') */
  category?: string
  triggerPatterns: string[]
  capabilities: string[]
  version: string
  content: string
  /** Skill type determines how the skill is used */
  skillType: SkillType
  /** Tool configuration (only for type: 'tool') */
  toolConfig?: ToolConfig
  /** Integration configuration (only for type: 'integration') */
  integrationConfig?: IntegrationConfig
  /** Attribution for referenced external projects/libraries */
  sources?: SkillSource[]
  source: 'bundled' | 'user' | 'generated'
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface SkillMatch {
  skill: Skill
  matchScore: number
  matchedPattern: string
}
