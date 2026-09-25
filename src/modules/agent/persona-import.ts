// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Markdown personas from instance directories. The product ships no tenant
// prompt text here — only the import mechanism. Which configured roots are
// still read is decided by shared/memory-sovereignty/import-roots.ts (another
// tool's own folders never are); what a read may change is decided below.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'fs/promises'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { sql } from 'drizzle-orm'
import { splitFrontmatter } from '@modules/data-port/source-frontmatter.js'
import type { AgentRegistry } from './agent-registry.js'
import type { AgentDefinition, AgentType, AgentTier } from './types.js'

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

// ── Import ledger ─────────────────────────────────────────────────────────
//
// agent.importRoots is read on every start, but the agent row — edited on the
// Agents page — is the source of truth. The ledger remembers, per agent id,
// which file this import last applied and a hash of the fields it wrote. A
// later start updates the row only while those fields still hash the same,
// so an edit made in EYAS always wins over the file. Runtime DDL, like the
// agent module's other bookkeeping tables.

export interface PersonaImportRecord {
  agentId: string
  /** Absolute path of the file that owns this id. */
  sourcePath: string
  /** sha256 of that file's content when it was last applied. */
  fileHash: string
  /** sha256 of the imported fields as they stood on the row after the import. */
  rowHash: string
  importedAt: string
}

export interface PersonaImportLedger {
  get(agentId: string): PersonaImportRecord | undefined
  record(entry: Omit<PersonaImportRecord, 'importedAt'>): void
}

export function createPersonaImportLedger(db: any): PersonaImportLedger {
  db.run(sql`CREATE TABLE IF NOT EXISTS agent_persona_imports (
    agent_id TEXT PRIMARY KEY,
    source_path TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    row_hash TEXT NOT NULL,
    imported_at TEXT NOT NULL
  )`)
  return {
    get(agentId) {
      const rows = db.all(sql`SELECT agent_id, source_path, file_hash, row_hash, imported_at
        FROM agent_persona_imports WHERE agent_id = ${agentId}`) as Array<Record<string, string>>
      const r = rows[0]
      if (!r) return undefined
      return { agentId: r.agent_id, sourcePath: r.source_path, fileHash: r.file_hash, rowHash: r.row_hash, importedAt: r.imported_at }
    },
    record(entry) {
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO agent_persona_imports (agent_id, source_path, file_hash, row_hash, imported_at)
        VALUES (${entry.agentId}, ${entry.sourcePath}, ${entry.fileHash}, ${entry.rowHash}, ${now})
        ON CONFLICT(agent_id) DO UPDATE SET
          source_path = excluded.source_path,
          file_hash = excluded.file_hash,
          row_hash = excluded.row_hash,
          imported_at = excluded.imported_at`)
    },
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** The fields an import writes on an existing row — the only ones it may ever change. */
interface ImportedFields {
  name: string
  role: string
  description: string
  systemPrompt: string
  tools: string[]
}

function importedFieldsHash(f: ImportedFields): string {
  return sha256(JSON.stringify([f.name, f.role, f.description, f.systemPrompt, f.tools]))
}

function rowFields(agent: AgentDefinition): ImportedFields {
  return {
    name: agent.name,
    role: agent.role,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    tools: agent.tools,
  }
}

/** What the file would write on `existing`. */
function fieldsFromFile(p: ParsedPersona, existing: AgentDefinition): ImportedFields {
  return {
    name: p.name,
    description: p.description || existing.description,
    // Only a file that actually declares a role may change one. Without a
    // `role:` key `p.role` falls back to the description or the id, and
    // writing that would overwrite the role the agent already has.
    role: typeof p.frontmatter.role === 'string' ? p.role : (p.description || existing.role),
    systemPrompt: p.systemPrompt,
    tools: p.tools ?? existing.tools,
  }
}

export interface PersonaImportResult {
  created: number
  updated: number
  /** Already as the file says (includes a pre-existing row adopted into the ledger). */
  unchanged: number
  /** Ids left alone: edited in EYAS since the import, or an agent this import never created. */
  kept: string[]
  /** Ids deleted in EYAS after an import — not created again. */
  deleted: string[]
  /** Ids a file in another root (or another file) already imports. */
  shadowed: string[]
  /** Unreadable or malformed files. */
  failed: number
}

/**
 * Read `*.md` files with YAML frontmatter from `dir`. Body becomes
 * `systemPrompt`. A missing directory is a no-op.
 *
 * - A new id is created, and the ledger records what was written.
 * - An id this import created is updated from the file only while its
 *   imported fields are exactly as the last import left them. An edit made
 *   in EYAS wins, and so does a deletion: the agent is not created again.
 * - An existing agent this import did not create (a template, one made in
 *   the UI, or one imported before the ledger existed) is never overwritten.
 *   When it already matches the file it is adopted, so later file changes
 *   reach it.
 */
export async function importPersonasFromDirectory(
  registry: AgentRegistry,
  dir: string,
  opts: { ledger: PersonaImportLedger },
): Promise<PersonaImportResult> {
  const result: PersonaImportResult = { created: 0, updated: 0, unchanged: 0, kept: [], deleted: [], shadowed: [], failed: 0 }
  const { ledger } = opts
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()
  } catch {
    return result
  }

  for (const file of files) {
    try {
      const sourcePath = resolve(dir, file)
      const content = await readFile(sourcePath, 'utf-8')
      const p = parsePersonaMarkdown(content, file.replace(/\.md$/i, ''))
      if (!p) continue
      const fileHash = sha256(content)
      const record = ledger.get(p.id)
      // First file wins an id. A file that has since gone away hands it on.
      if (record && record.sourcePath !== sourcePath && existsSync(record.sourcePath)) {
        result.shadowed.push(p.id)
        continue
      }
      const existing = registry.get(p.id)

      if (!existing) {
        if (record) {
          result.deleted.push(p.id)
          continue
        }
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
        const created = registry.get(p.id)
        if (created) ledger.record({ agentId: p.id, sourcePath, fileHash, rowHash: importedFieldsHash(rowFields(created)) })
        result.created++
        continue
      }

      const current = importedFieldsHash(rowFields(existing))
      const next = fieldsFromFile(p, existing)
      const nextHash = importedFieldsHash(next)

      if (!record) {
        if (nextHash === current) {
          ledger.record({ agentId: p.id, sourcePath, fileHash, rowHash: current })
          result.unchanged++
        } else {
          result.kept.push(p.id)
        }
        continue
      }
      if (current !== record.rowHash) {
        result.kept.push(p.id)
        continue
      }
      if (nextHash === current) {
        if (record.fileHash !== fileHash) ledger.record({ agentId: p.id, sourcePath, fileHash, rowHash: current })
        result.unchanged++
        continue
      }
      registry.update(p.id, next)
      const updated = registry.get(p.id)
      ledger.record({ agentId: p.id, sourcePath, fileHash, rowHash: updated ? importedFieldsHash(rowFields(updated)) : nextHash })
      result.updated++
    } catch {
      // Skip unreadable / malformed files; the rest of the directory still counts.
      result.failed++
    }
  }
  return result
}
