// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// OpenCode `permission.asked` → the EYAS security gate.
//
// The sidecar runs with every tool permission set to "ask" (isolation.ts), so
// each read, edit, shell command, fetch and out-of-folder access of a
// headless task pauses until someone replies. For the tasks EYAS starts
// itself (developer-agent.ts) that someone is the EYAS gate: this file turns
// one request into the canonical gate vocabulary the other CLI providers
// already use (Read / Glob / Grep green, Edit / WebFetch / WebSearch yellow,
// Bash red) and puts the paths into the fields the gate's path checks read
// (`file_path`, `path`, `paths`, `command`, `cwd`).
//
// Request shape recorded by the W0 spike (tests/fixtures/cli/opencode/
// 1.18.29/permission-asked.json):
//   { id, sessionID, permission, patterns[], metadata{}, always[], tool? }
// `read` / `edit` patterns are the path relative to the project worktree —
// the git work tree around the session folder, or `/` outside a repository
// (hence "an absolute path without its leading slash"). `edit` also carries
// the absolute path in metadata.filepath; `external_directory` carries
// absolute `<dir>/*` patterns (plus metadata.filepath / parentDir, or
// metadata.directories for a shell command).

import { lstatSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'

/**
 * Reserved gate name for a permission with no canonical mapping (doom_loop,
 * skill, a future key). Deliberately not a real tool name: the gate treats
 * an unclassified name fail-closed (escalate to the judge), never green.
 */
export const OPENCODE_UNMAPPED_TOOL = 'OpencodeUnmappedTool'

/** OpenCode permission key → canonical gate tool name. */
const PERMISSION_TO_TOOL: Readonly<Record<string, string>> = {
  read: 'Read',
  lsp: 'Read',
  // Access to a folder outside the session folder. The operation itself
  // (read, edit, shell) asks separately afterwards and is judged on its own.
  external_directory: 'Read',
  list: 'Glob',
  glob: 'Glob',
  grep: 'Grep',
  edit: 'Edit',
  bash: 'Bash',
  webfetch: 'WebFetch',
  websearch: 'WebSearch',
  // A subagent: its own tool calls ask again under its child session.
  task: 'Task',
}

const MAX_TEXT = 2_000
const MAX_LIST = 32

/** One `permission.asked` payload (event.properties), parsed tolerantly. */
export const OpencodePermissionRequestSchema = z.object({
  id: z.string().min(1).max(200),
  sessionID: z.string().min(1).max(200),
  permission: z.string().min(1).max(100),
  patterns: z.array(z.string().max(8_192)).max(256).catch([]).default([]),
  metadata: z.record(z.string(), z.unknown()).catch({}).default({}),
  always: z.array(z.string()).optional().catch(undefined),
  tool: z
    .object({ messageID: z.string().optional(), callID: z.string().optional() })
    .optional()
    .catch(undefined),
})

export type OpencodePermissionRequest = z.infer<typeof OpencodePermissionRequestSchema>

function exists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * OpenCode's project worktree for a session folder: the nearest folder above
 * it holding a `.git` entry (folder or file), else the filesystem root.
 */
export function opencodeWorktree(directory: string): string {
  let dir = resolve(directory)
  for (;;) {
    if (exists(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return dir
    dir = parent
  }
}

/**
 * Every absolute path a relative `read`/`edit` pattern may stand for:
 * relative to the worktree, and relative to `/` (what OpenCode uses when it
 * found no repository). The gate sees all of them, so the stricter verdict
 * wins; `primary` is the one that exists, else the worktree reading.
 */
export function patternPaths(pattern: string, worktree: string): { primary: string; all: string[] } {
  if (isAbsolute(pattern)) return { primary: resolve(pattern), all: [resolve(pattern)] }
  const candidates = [...new Set([resolve(worktree, pattern), resolve('/', pattern)])]
  const primary = candidates.find(exists) ?? candidates[0]!
  return { primary, all: candidates }
}

/** `<dir>/*` (or `<dir>/**`) → `<dir>`. */
function directoryOfPattern(pattern: string): string {
  return pattern.replace(/[\\/]\*{1,2}$/, '')
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Keep the audit copy small: long strings (a diff) are clipped. */
function clip(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value
  if (depth > 3) return undefined
  if (Array.isArray(value)) return value.slice(0, MAX_LIST).map((v) => clip(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value).slice(0, MAX_LIST)) out[k] = clip(v, depth + 1)
    return out
  }
  return value
}

export interface MappedOpencodePermission {
  /** Canonical gate tool name. */
  name: string
  /** Gate input: path-bearing fields first, the raw request under `_opencode`. */
  input: Record<string, unknown>
  /** False when the permission key has no canonical mapping. */
  mapped: boolean
}

/**
 * Map one OpenCode permission request onto a gate call. `directory` is the
 * session folder EYAS created the session in. The permission key and patterns
 * are model-influenced, so they never become the gate name themselves: an
 * unknown key resolves to OPENCODE_UNMAPPED_TOOL.
 */
export function mapOpencodePermission(
  req: OpencodePermissionRequest,
  directory: string,
): MappedOpencodePermission {
  const tool = PERMISSION_TO_TOOL[req.permission]
  const meta = req.metadata
  const cwd = resolve(directory)
  const audit = {
    _opencode: {
      permission: req.permission,
      patterns: clip(req.patterns),
      metadata: clip(meta),
    },
  }
  const absFromMeta = (value: unknown): string | undefined => {
    const s = str(value)
    if (!s) return undefined
    return isAbsolute(s) ? resolve(s) : resolve(cwd, s)
  }

  let input: Record<string, unknown>
  switch (tool) {
    case 'Read':
    case 'Edit': {
      if (req.permission === 'external_directory') {
        const dirs = [
          ...req.patterns.map(directoryOfPattern),
          ...(Array.isArray(meta.directories) ? meta.directories.filter((d): d is string => typeof d === 'string') : []),
        ].filter(Boolean).map((d) => (isAbsolute(d) ? resolve(d) : resolve(cwd, d)))
        const unique = [...new Set(dirs)]
        const filePath = absFromMeta(meta.filepath)
        input = {
          path: absFromMeta(meta.parentDir) ?? unique[0] ?? cwd,
          ...(filePath ? { file_path: filePath } : {}),
          ...(unique.length > 0 ? { paths: unique } : {}),
          ...(str(meta.command) ? { command: meta.command } : {}),
        }
        break
      }
      const worktree = opencodeWorktree(cwd)
      const resolved = req.patterns.map((p) => patternPaths(p, worktree))
      const all = [...new Set(resolved.flatMap((r) => r.all))]
      const filePath = absFromMeta(meta.filepath) ?? resolved[0]?.primary ?? cwd
      input = {
        file_path: filePath,
        ...(all.length > 1 || (all.length === 1 && all[0] !== filePath) ? { paths: all } : {}),
      }
      break
    }
    case 'Glob':
    case 'Grep': {
      const listTarget = req.permission === 'list' && req.patterns[0]
        ? patternPaths(req.patterns[0], opencodeWorktree(cwd)).primary
        : undefined
      input = {
        pattern: str(meta.pattern) ?? req.patterns[0] ?? '*',
        path: absFromMeta(meta.path) ?? listTarget ?? cwd,
      }
      break
    }
    case 'Bash':
      input = {
        command: str(meta.command) ?? req.patterns.join(' && '),
        cwd,
      }
      break
    case 'WebFetch':
      input = { url: str(meta.url) ?? req.patterns[0] ?? '' }
      break
    case 'WebSearch':
      input = { query: str(meta.query) ?? req.patterns[0] ?? '' }
      break
    case 'Task':
      input = { subagent_type: req.patterns[0] ?? '', description: str(meta.description) ?? '' }
      break
    default:
      input = { cwd }
  }

  return { name: tool ?? OPENCODE_UNMAPPED_TOOL, input: { ...input, ...audit }, mapped: Boolean(tool) }
}
