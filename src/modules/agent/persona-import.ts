// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Markdown personas from instance directories. The product ships no tenant
// prompt text here — only the import mechanism.

import { readdir, readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { splitFrontmatter } from '@modules/data-port/source-frontmatter.js'
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

/** Array, or a comma/whitespace-separated string ("Read, Grep") → a trimmed, non-empty list. */
function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)
  }
  return []
}

const AGENT_TYPES = new Set<AgentType>([
  'assistant', 'engineer', 'developer', 'reviewer', 'critic', 'researcher', 'planner', 'coordinator', 'observer',
])
const AGENT_TIERS = new Set<AgentTier>(['primary', 'team', 'specialist'])

function asAgentTier(value: unknown): AgentTier {
  return typeof value === 'string' && AGENT_TIERS.has(value as AgentTier) ? (value as AgentTier) : 'team'
}

const TOOL_MAP: Record<string, string> = {
  Read: 'read_file', Write: 'write_file', Edit: 'edit_file', MultiEdit: 'edit_file', NotebookEdit: 'edit_file',
  Bash: 'run_command', Glob: 'glob', Grep: 'grep', WebSearch: 'research', WebFetch: 'research',
}

/**
 * What a name may resolve to when no live registry is available to ask: the ids
 * the map itself produces, and nothing else.
 *
 * The rule this replaces — "any lowercase word is a tool id" — let `codebase`,
 * `search` and `fetch` through as if they were EYAS tools. The runner then took
 * the "agent has an explicit toolset" branch, filtered the list down to what is
 * actually registered, and ran the agent with no tools at all, silently.
 */
const KNOWN_TOOL_IDS = new Set(Object.values(TOOL_MAP))

/**
 * Claude-style tool names → EYAS tool ids. A name is kept only when it resolves
 * to a tool this instance HAS: `isKnownTool` asks the live registry when the
 * caller has one, and the map's own ids answer for it when not. Everything else
 * is reported as unknown, and the caller keeps it as a `claude-tool:` tag.
 *
 * Nothing mapped = default toolset (undefined), never an empty list.
 */
export function mapToolNames(
  names: string[],
  isKnownTool: (id: string) => boolean = (id) => KNOWN_TOOL_IDS.has(id),
): { tools: string[] | undefined; unknown: string[] } {
  const tools: string[] = []
  const unknown: string[] = []
  for (const n of names) {
    const id = TOOL_MAP[n] ?? n
    if (isKnownTool(id)) { if (!tools.includes(id)) tools.push(id) } else unknown.push(n)
  }
  return { tools: tools.length ? tools : undefined, unknown }
}

/** Keyword classifier over `name + description`. English keywords only — this
 *  classifies imported files, not tenant business content. */
function inferAgentType(text: string): AgentType {
  const t = text.toLowerCase()
  if (/\b(developer|engineer|backend|frontend)\b/.test(t)) return 'developer'
  if (/\b(review|qa|test)\b/.test(t)) return 'reviewer'
  if (/\b(critic|advocate|skeptic)\b/.test(t)) return 'critic'
  if (/\bresearch\b/.test(t)) return 'researcher'
  if (/\b(owner|plan|product)\b/.test(t)) return 'planner'
  return 'assistant'
}

export interface ParsedPersona {
  id: string
  name: string
  description: string
  role: string
  goal: string
  systemPrompt: string
  capabilities: string[]
  tools: string[] | undefined
  tier: AgentTier
  agentType: AgentType
  originalTools: string[]
  unknownTools: string[]
  frontmatter: Record<string, unknown>
}

/** The one newline a text editor adds after the last line — not part of the prompt (a system prompt is not the source file; R11.5 governs the file, not this). */
function stripOneTrailingNewline(body: string): string {
  return body.endsWith('\r\n') ? body.slice(0, -2) : body.endsWith('\n') ? body.slice(0, -1) : body
}

/**
 * Parse a persona markdown file's YAML frontmatter + body. `stem` is the
 * fallback id (typically the filename without extension) when frontmatter
 * has neither `id` nor `name`. Returns `null` when the file has no leading
 * frontmatter block — it is not a persona.
 */
export function parsePersonaMarkdown(
  content: string,
  stem: string,
  opts: { isKnownTool?: (id: string) => boolean } = {},
): ParsedPersona | null {
  const { data: frontmatter, body, hadFrontmatter } = splitFrontmatter(content)
  if (!hadFrontmatter) return null
  const id = String(frontmatter.id ?? frontmatter.name ?? stem).trim()
  if (!id) return null
  const name = String(frontmatter.name ?? id).trim() || id
  const description = typeof frontmatter.description === 'string' ? frontmatter.description.trim() : ''
  const originalTools = stringList(frontmatter.tools)
  const { tools, unknown: unknownTools } = mapToolNames(originalTools, opts.isKnownTool)
  const declaredType = frontmatter.agentType ?? frontmatter.agent_type
  return {
    id,
    name,
    description,
    role: typeof frontmatter.role === 'string' ? frontmatter.role : (description || id),
    goal: typeof frontmatter.goal === 'string' ? frontmatter.goal : description,
    systemPrompt: stripOneTrailingNewline(body),
    capabilities: stringList(frontmatter.capabilities),
    tools,
    tier: asAgentTier(frontmatter.tier),
    agentType: typeof declaredType === 'string' && AGENT_TYPES.has(declaredType as AgentType)
      ? (declaredType as AgentType)
      : inferAgentType(`${name} ${description}`),
    originalTools,
    unknownTools,
    frontmatter,
  }
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
      const p = parsePersonaMarkdown(content, file.replace(/\.md$/i, ''))
      if (!p) continue
      const existing = registry.get(p.id)
      if (existing) {
        registry.update(p.id, {
          name: p.name,
          description: p.description || existing.description,
          // Only a file that actually declares a role may change one. Without a
          // `role:` key `p.role` falls back to the description or the id, and
          // writing that would overwrite the role the agent already has.
          role: typeof p.frontmatter.role === 'string' ? p.role : (p.description || existing.role),
          systemPrompt: p.systemPrompt,
          tools: p.tools ?? existing.tools,
        })
      } else {
        registry.create({
          id: p.id,
          name: p.name,
          role: p.role,
          description: p.description,
          goal: p.goal,
          backstory: '',
          systemPrompt: p.systemPrompt,
          capabilities: p.capabilities,
          tools: p.tools ?? [],
          constraints: [],
          tier: p.tier,
          agentType: p.agentType,
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
