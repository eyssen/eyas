// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Memory-store MCP servers are blocked for every model.
//
// EYAS reads and writes memory only through its own stores. An MCP server
// whose job is a second memory (a knowledge-graph file, a vector collection,
// an Obsidian vault) — or any server pointed at another tool's memory or at
// EYAS's own data folder — would make that store a live read/write source
// for every provider, API and CLI alike. Such a server is refused on add,
// install and update, never spawned, and its tools are never registered.
// The sanctioned way to bring that memory in is the Data portability import (a
// one-way import through EYAS code, never a model tool call).
//
// Three signals, all deterministic:
//   catalog  the catalog entry is flagged `memoryStore`, or the launch names
//            that entry's package
//   package  the command or an argument names a FOREIGN_MEMORY_MCP_SIGNATURES
//            package/binary (exact name; a version suffix is ignored)
//   path     an argument, env value, command path or file: URL that the
//            memory-sovereignty path policy does not classify as 'ok' —
//            except <dataDir>/mcp-servers, where EYAS keeps the MCP servers
//            it runs (server code, not memory)
// The display name is never matched: a server merely called "memory" is fine.

import { basename, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FOREIGN_MEMORY_MCP_SIGNATURES } from '@shared/memory-sovereignty/foreign-stores.js'
import { currentHomeDir, getPathPolicy, type PathKind, type PathPolicy } from '@shared/memory-sovereignty/path-policy.js'
import { pathCandidatesFromArgv } from '@shared/memory-sovereignty/shell-paths.js'
import { realpathBestEffort } from '@shared/fs-realpath.js'
import { mcpServerRegistry, type McpRegistryEntry } from './registry.js'

/** Error code on every refusal (HTTP 409 body, client error, UI mapping). */
export const MEMORY_STORE_BLOCKED = 'memory_store_blocked' as const

/** Value of `blocked` in the public server shape. */
export const MEMORY_STORE_BLOCK = 'memory_store' as const

export interface MemoryStoreVerdict {
  match: 'catalog' | 'package' | 'path'
  /** Catalog id, signature id, or the path verdict's rule id / kind. */
  ruleId: string
  /** Short English name of what was hit, for logs and the error text. Never a secret. */
  label: string
  /** Where it was found: 'command', 'args', 'env.<KEY>' or 'url'. Values are never kept (an env value may be a secret). */
  field?: string
  kind?: Exclude<PathKind, 'ok'>
}

/** A server's launch description, as input or as a stored row (JSON strings accepted). */
export interface McpServerShape {
  name?: string | null
  command?: string | null
  args?: readonly unknown[] | string | null
  url?: string | null
  env?: Record<string, unknown> | string | null
  /** Set by the catalog install route. */
  catalogId?: string | null
}

export interface MemoryStoreCheckOptions {
  /** Default: the process-wide policy (getPathPolicy()). */
  policy?: PathPolicy
  /** Expansion target of `~` / `$HOME`. Default: the operator's home. */
  homeDir?: string
  /** Base for relative arguments — a stdio server is spawned in the process cwd. */
  cwd?: string
  /** Default: the built-in catalog. */
  catalog?: readonly McpRegistryEntry[]
}

export function memoryStoreBlockedMessage(label: string): string {
  return `Blocked: this MCP server keeps memory outside EYAS (${label}). `
    + 'EYAS reads and writes memory only through its own stores; use Settings → System → Data portability → Import data for a one-way import instead.'
}

/** Thrown by the MCP client when a flagged server is added, updated or connected. */
export class McpMemoryStoreBlockedError extends Error {
  readonly code = MEMORY_STORE_BLOCKED
  constructor(readonly verdict: MemoryStoreVerdict) {
    super(memoryStoreBlockedMessage(verdict.label))
    this.name = 'McpMemoryStoreBlockedError'
  }
}

export function isMemoryStoreBlockedError(err: unknown): err is McpMemoryStoreBlockedError {
  return err instanceof McpMemoryStoreBlockedError
    || (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === MEMORY_STORE_BLOCKED)
}

function parseArgs(value: McpServerShape['args']): string[] {
  let raw: unknown = value
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value)
    } catch {
      return []
    }
  }
  return Array.isArray(raw) ? raw.filter((a): a is string => typeof a === 'string') : []
}

function parseEnv(value: McpServerShape['env']): Array<[string, string]> {
  let raw: unknown = value
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value)
    } catch {
      return []
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
  return Object.entries(raw as Record<string, unknown>)
    .filter((e): e is [string, string] => typeof e[1] === 'string')
}

/**
 * The package or binary name a launch word stands for, or null:
 * `@scope/name@1.2` → `@scope/name`, `name@latest` / `name==1.0` → `name`,
 * `/usr/local/bin/name(.exe|.cmd)` → `name`.
 */
function packageNameOf(word: string): string | null {
  const w = word.trim().toLowerCase()
  if (!w || w.startsWith('-')) return null
  if (w.startsWith('@')) {
    const m = /^(@[^/@\s]+\/[^/@\s]+)(?:@.*)?$/.exec(w)
    return m ? m[1] : null
  }
  if (/[\\/]/.test(w)) {
    return basename(w.replace(/\\/g, '/')).replace(/\.(exe|cmd|bat)$/, '') || null
  }
  return w.replace(/(?:@|==|>=|~=).*$/, '') || null
}

/** Package names a flagged catalog entry launches (its non-flag arguments that name a package). */
function catalogPackageNames(entry: McpRegistryEntry): string[] {
  const words = [entry.command ?? '', ...(entry.args ?? [])]
  return words
    .filter((w) => w && !w.startsWith('-') && !['npx', 'uvx', 'node', 'bunx', 'pipx', 'python', 'python3'].includes(w))
    .map(packageNameOf)
    .filter((n): n is string => typeof n === 'string')
}

interface NameRule {
  match: 'catalog' | 'package'
  id: string
  label: string
}

function nameRules(catalog: readonly McpRegistryEntry[]): Map<string, NameRule> {
  const rules = new Map<string, NameRule>()
  for (const sig of FOREIGN_MEMORY_MCP_SIGNATURES) {
    for (const name of sig.names) rules.set(name.toLowerCase(), { match: 'package', id: sig.id, label: sig.label })
  }
  for (const entry of catalog) {
    if (!entry.memoryStore) continue
    for (const name of catalogPackageNames(entry)) {
      if (!rules.has(name)) rules.set(name, { match: 'catalog', id: entry.id, label: entry.name })
    }
  }
  return rules
}

/** `launch` = [command, ...args]; the first word is the command. */
function packageVerdict(launch: readonly string[], rules: Map<string, NameRule>): MemoryStoreVerdict | null {
  for (const [index, word] of launch.entries()) {
    const field = index === 0 ? 'command' : 'args'
    // A folder argument is not a package: only the command is matched by its
    // basename, so a project folder that happens to share a package's name passes.
    const isPathArg = index > 0 && /[\\/]/.test(word) && !word.trim().startsWith('@')
    const name = isPathArg ? null : packageNameOf(word)
    const hit = name ? rules.get(name) : undefined
    if (hit) return { match: hit.match, ruleId: hit.id, label: hit.label, field }
    // A package run from its install folder: node …/node_modules/<pkg>/dist/index.js
    const lower = word.toLowerCase().replace(/\\/g, '/')
    if (!lower.includes('/node_modules/')) continue
    for (const [pkg, rule] of rules) {
      if (lower.includes(`/node_modules/${pkg}/`)) return { match: rule.match, ruleId: rule.id, label: rule.label, field }
    }
  }
  return null
}

function pathVerdict(shape: McpServerShape, opts: Required<Pick<MemoryStoreCheckOptions, 'homeDir' | 'cwd'>> & { policy: PathPolicy }): MemoryStoreVerdict | null {
  const argvOpts = { homeDir: opts.homeDir, cwd: opts.cwd }
  const candidates: Array<{ field: string; path: string }> = []
  if (typeof shape.command === 'string' && shape.command.trim()) {
    for (const p of pathCandidatesFromArgv([shape.command.trim()], argvOpts)) candidates.push({ field: 'command', path: p })
  }
  // `@scope/name` is an npm package, not a folder next to the process.
  const argWords = parseArgs(shape.args).filter((a) => !a.trim().startsWith('@'))
  for (const p of pathCandidatesFromArgv(argWords, argvOpts)) candidates.push({ field: 'args', path: p })
  for (const [key, value] of parseEnv(shape.env)) {
    for (const p of pathCandidatesFromArgv([value], argvOpts)) candidates.push({ field: `env.${key}`, path: p })
  }
  if (typeof shape.url === 'string' && /^file:\/\//i.test(shape.url.trim())) {
    try {
      candidates.push({ field: 'url', path: fileURLToPath(shape.url.trim()) })
    } catch {
      // not a usable file URL
    }
  }
  for (const { field, path } of candidates) {
    if (!isAbsolute(path)) continue
    let verdict = opts.policy.classify(path)
    if (isServerInstallArea(verdict)) {
      // Where EYAS keeps MCP servers it runs (config/mcp.yaml clones them to
      // <dataDir>/mcp-servers): not memory. Judged again by its real path,
      // so a link planted there that leads into the vault is still refused.
      let real = path
      try {
        real = realpathBestEffort(path)
      } catch {
        real = path
      }
      verdict = real === path ? verdict : opts.policy.classify(real)
      if (isServerInstallArea(verdict)) continue
    }
    if (verdict.kind === 'ok') continue
    return {
      match: 'path',
      ruleId: verdict.ruleId ?? verdict.rule ?? verdict.kind,
      label: verdict.label,
      field,
      kind: verdict.kind,
    }
  }
  return null
}

/**
 * Sub-folder of the data dir that holds the MCP servers EYAS runs (the
 * clone target config/mcp.yaml documents). The only part of the data dir a
 * launch may name: it holds server code, not memory. Model tools still
 * cannot reach it — the path policy keeps it EYAS-only; this exemption is
 * for the launch check alone.
 */
export const MCP_SERVERS_DIR = 'mcp-servers'

/** The path verdict is the data dir's generic rule on the MCP server install folder. */
function isServerInstallArea(verdict: { kind: string; rule?: string; label: string }): boolean {
  return verdict.kind === 'eyas-data' && verdict.rule === 'eyas-data' && verdict.label.toLowerCase() === MCP_SERVERS_DIR
}

/**
 * Why this MCP server is a memory store EYAS must not run, or null when it
 * may run. Pure apart from the path policy's filesystem checks.
 */
export function mcpMemoryStoreVerdict(shape: McpServerShape, opts: MemoryStoreCheckOptions = {}): MemoryStoreVerdict | null {
  const catalog = opts.catalog ?? mcpServerRegistry
  if (shape.catalogId) {
    const entry = catalog.find((e) => e.id === shape.catalogId)
    if (entry?.memoryStore) return { match: 'catalog', ruleId: entry.id, label: entry.name }
  }
  const command = typeof shape.command === 'string' ? shape.command : ''
  const byName = packageVerdict([command, ...parseArgs(shape.args)], nameRules(catalog))
  if (byName) return byName
  return pathVerdict(shape, {
    policy: opts.policy ?? getPathPolicy(),
    homeDir: opts.homeDir ?? currentHomeDir(),
    cwd: opts.cwd ?? process.cwd(),
  })
}

/** True when the server must not be installed, connected or exposed to any model. */
export function isForeignMemoryServer(shape: McpServerShape, opts?: MemoryStoreCheckOptions): boolean {
  return mcpMemoryStoreVerdict(shape, opts) !== null
}
