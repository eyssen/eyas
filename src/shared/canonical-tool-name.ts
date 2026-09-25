// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// One name per tool, whatever runtime executed it. Claude Code reports its
// builtins as Bash/Read/Edit…, Grok/Kimi over ACP report a free-text title
// plus a tool kind, and EYAS's own tools arrive MCP-prefixed through the CLI
// bridges. UI rows, the do-not-repeat ledger, tool_executions and the run tree
// all key on the canonical name; the provider's own name travels as rawName.
//
// Security-gate classification deliberately keeps using raw names — this file
// is for display and bookkeeping only. Pure: the web imports it too.

/** Prefix the CLI bridges put in front of EYAS's own tools. */
const EYAS_MCP_PREFIX = 'mcp__eyas__'

/** Claude Code builtin tool → canonical EYAS name. */
const CLAUDE_CODE_BUILTINS: Readonly<Record<string, string>> = {
  Bash: 'run_command',
  Read: 'read_file',
  Write: 'write_file',
  Edit: 'edit_file',
  MultiEdit: 'edit_file',
  Grep: 'grep',
  Glob: 'glob',
  WebFetch: 'web_fetch',
  WebSearch: 'web_search',
  TodoWrite: 'todo',
}

/** ACP ToolKind → canonical EYAS name. Kinds without an equivalent (think, switch_mode, other) are absent. */
const ACP_KINDS: Readonly<Record<string, string>> = {
  execute: 'run_command',
  read: 'read_file',
  edit: 'edit_file',
  delete: 'delete_file',
  move: 'move_file',
  search: 'grep',
  fetch: 'web_fetch',
}

/** A machine identifier (e.g. save_memory, mcp__eyas__save_memory) as opposed to a human title. */
const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/

function hasOwn(map: Readonly<Record<string, string>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key)
}

function canonicalFromIdentifier(raw: string): string {
  if (raw.startsWith(EYAS_MCP_PREFIX) && raw.length > EYAS_MCP_PREFIX.length) return raw.slice(EYAS_MCP_PREFIX.length)
  if (hasOwn(CLAUDE_CODE_BUILTINS, raw)) return CLAUDE_CODE_BUILTINS[raw]
  return raw
}

/**
 * The canonical name of a tool call.
 * - `mcp__eyas__save_memory` → `save_memory`
 * - Claude Code builtins → EYAS names (Bash → run_command, Read → read_file, …)
 * - ACP calls (pass `acpKind`): the kind decides (edit → edit_file, …). An
 *   ACP title is free text for humans and is never used as the name: an
 *   unmapped kind keeps the raw value only if it is a machine identifier
 *   (an EYAS tool bridged over MCP), otherwise the kind itself.
 * - anything else passes through unchanged.
 */
export function canonicalToolName(raw: string, opts: { acpKind?: string } = {}): string {
  const name = raw.trim()
  if (opts.acpKind !== undefined) {
    const kind = opts.acpKind.trim()
    if (hasOwn(ACP_KINDS, kind)) return ACP_KINDS[kind]
    if (IDENTIFIER_RE.test(name)) return canonicalFromIdentifier(name)
    return kind || 'other'
  }
  return canonicalFromIdentifier(name)
}

/**
 * Normalize a tool input for display and ledger keys: runtimes that call the
 * target `file_path` (Claude Code) are mapped onto EYAS's `path`. Edit payloads
 * (old_string/new_string) are kept as they are. Never mutates the input.
 */
export function normalizeToolInput(input: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {}
  const out: Record<string, unknown> = { ...input }
  if ('file_path' in out) {
    if (out.path === undefined) out.path = out.file_path
    delete out.file_path
  }
  return out
}
