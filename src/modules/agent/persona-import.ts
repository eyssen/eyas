// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Markdown personas from instance directories. The product ships no tenant
// prompt text here — only the import mechanism.

import { readdir, readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { parse as parseYaml } from 'yaml'
import type { AgentRegistry } from './agent-registry.js'
import type { AgentType, AgentTier } from './types.js'

function expandHomeDir(dir: string): string {
  const trimmed = dir.trim()
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2))
  return trimmed
}

/** Instance overlay paths. Empty / missing → no extra personas (product default). */
export function resolvePersonaImportRoots(config: unknown): string[] {
  const raw = (config as { agent?: { importRoots?: unknown } } | undefined)?.agent?.importRoots
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map(expandHomeDir)
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
}

const AGENT_TYPES = new Set<AgentType>([
  'assistant', 'engineer', 'developer', 'reviewer', 'critic', 'researcher', 'planner', 'coordinator', 'observer',
])
const AGENT_TIERS = new Set<AgentTier>(['primary', 'team', 'specialist'])

function asAgentType(value: unknown): AgentType {
  return typeof value === 'string' && AGENT_TYPES.has(value as AgentType) ? (value as AgentType) : 'assistant'
}

function asAgentTier(value: unknown): AgentTier {
  return typeof value === 'string' && AGENT_TIERS.has(value as AgentTier) ? (value as AgentTier) : 'team'
}

/**
 * Read `*.md` files with YAML frontmatter from `dir`. Body becomes
 * `systemPrompt`. An existing agent with the same id is overlaid (file wins);
 * a missing directory is a no-op.
 */
export async function importPersonasFromDirectory(registry: AgentRegistry, dir: string): Promise<number> {
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.md'))
  } catch {
    return 0
  }

  let count = 0
  for (const file of files) {
    try {
      const content = await readFile(join(dir, file), 'utf-8')
      const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
      if (!match) continue
      const frontmatter = parseYaml(match[1]) as Record<string, unknown> | null
      if (!frontmatter || typeof frontmatter !== 'object') continue
      const body = match[2].trim()
      const stem = file.replace(/\.md$/i, '')
      const id = String(frontmatter.id ?? frontmatter.name ?? stem).trim()
      if (!id) continue
      const name = String(frontmatter.name ?? id).trim() || id
      const description = typeof frontmatter.description === 'string' ? frontmatter.description.trim() : ''
      const tools = stringList(frontmatter.tools)
      const existing = registry.get(id)
      if (existing) {
        registry.update(id, {
          name,
          description: description || existing.description,
          role: typeof frontmatter.role === 'string' ? frontmatter.role : (description || existing.role),
          systemPrompt: body,
          tools: tools.length > 0 ? tools : existing.tools,
        })
      } else {
        registry.create({
          id,
          name,
          role: typeof frontmatter.role === 'string' ? frontmatter.role : (description || id),
          description,
          goal: typeof frontmatter.goal === 'string' ? frontmatter.goal : description,
          backstory: '',
          systemPrompt: body,
          capabilities: stringList(frontmatter.capabilities),
          tools,
          constraints: [],
          tier: asAgentTier(frontmatter.tier),
          agentType: asAgentType(frontmatter.agentType ?? frontmatter.agent_type),
          source: 'user',
        })
      }
      count++
    } catch {
      // Skip unreadable / malformed files; the rest of the directory still counts.
    }
  }
  return count
}
