// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Fail-closed isolation checks for the ACP CLIs (Grok, Kimi). A turn runs
// only when every layer agrees; a failed layer stops it with
// CliIsolationError (kind 'isolation': never retried, never failed over to
// another provider) and records the outcome in the cli-runtime
// IsolationStatus store, which is also what supportsIsolatedCompletion reads.
//
//   1. Preflight, before the CLI is spawned for a turn.
//      Grok: `grok inspect --json` in the turn's cwd with the profile's env
//      (no model call), plus a read-back of the files EYAS owns in the home.
//      Kimi (no inspect command): the read-back of EYAS's keys in its
//      config.toml, its mcp.json and the skill folders of its home.
//   2. The session/new response: a permission mode that bypasses asking.
//   3. The tripwire, while the turn runs: a native tool that reaches
//      in_progress/completed without an EYAS decision (keyed on toolCallId,
//      the only key a subagent's permission request shares with its tool
//      calls — A1 spike) cancels the session.
//
// What the preflight treats as a violation, and why (A1 spike, grok 1.0.40,
// tests/fixtures/cli/grok/1.0.40):
//   - always-approve not locked off by requirements.toml (inspect reports the
//     lock in permissions.enforced), permission rules from anywhere but the
//     EYAS config.toml, a config layer EYAS does not own (grok's own cache of
//     the vendor-managed layer excepted while it holds no setting);
//   - an MCP server grok would start (inspect lists servers of an untrusted
//     folder too; the requirements allowlist marks them disabledReason, and
//     only those are harmless);
//   - hooks, plugins, language servers;
//   - instruction files, skills or agents from the home or any folder
//     outside the conversation's roots. Project instruction files inside the
//     roots are NOT a violation: the folder is never trusted, so the CLI does
//     not load them, and the model may still read them with its file tools;
//   - an enabled compat cell (Claude/Cursor/Codex imports);
//   - a trusted project folder whose own config applies.
// Inspect reports no memory, leader or telemetry state; those are proven by
// the read-back of EYAS's own config.toml, which sets them.

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import { realpathBestEffort } from '@shared/fs-realpath.js'
import { readManagedFile } from '../../cli-runtime/homes.js'
import {
  CliIsolationError,
  getIsolationStatus,
  setIsolationStatus,
  type CliIsolationViolation,
  type CliRuntimeInfo,
} from '../../cli-runtime/isolation.js'
import { parseAcpSessionNew, type AcpSessionEvent } from './acp-events.js'
import { KIMI_MANAGED_KEYS, kimiShareDirOf, type AcpCliProfile, type AcpProviderId } from './acp-profiles.js'

// ─── Check ids ─────────────────────────────────

/**
 * The stable ids of the isolation checks. The web localizes them
 * (conversations.errors.cliIsolation.check.<id>); detail text stays raw.
 */
export const ACP_ISOLATION_CHECKS = [
  'permissionMode',
  'mcpServers',
  'hooks',
  'plugins',
  'rules',
  'memory',
  'compat',
  'leader',
  'folderTrust',
  'ungovernedTool',
  'unverified',
] as const
export type AcpIsolationCheck = typeof ACP_ISOLATION_CHECKS[number]

function violation(check: AcpIsolationCheck, detail: string): CliIsolationViolation {
  return { check, detail: detail.slice(0, 500) }
}

// ─── Paths ─────────────────────────────────────

function realOf(path: string): string {
  try {
    return realpathBestEffort(path)
  } catch {
    return resolve(path)
  }
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(realOf(parent), realOf(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function isInsideAny(path: string, roots: readonly string[]): boolean {
  return isAbsolute(path) && roots.some((root) => isInside(path, root))
}

function samePath(a: string, b: string): boolean {
  return realOf(a) === realOf(b)
}

/** "…/config.toml (config)" → "…/config.toml": inspect labels its permission sources. */
function stripSourceLabel(source: string): string {
  return source.replace(/\s+\([^()]*\)\s*$/, '')
}

// ─── grok inspect ──────────────────────────────

const SourceSchema = z.object({
  type: z.string().optional(),
  path: z.string().optional(),
}).passthrough()

const EntrySchema = z.object({
  name: z.string().optional(),
  event: z.string().optional(),
  source: SourceSchema.optional(),
  disabledReason: z.string().nullable().optional(),
}).passthrough()

/**
 * The parts of `grok inspect --json` (1.0.40) the preflight relies on. Every
 * section it needs to prove isolation is required: a CLI version that stops
 * reporting one is 'unverified', which refuses the turn.
 */
const GrokInspectSchema = z.object({
  grokVersion: z.string().optional(),
  projectTrusted: z.boolean().optional(),
  projectInstructions: z.array(z.object({
    path: z.string(),
    scope: z.string().optional(),
  }).passthrough()),
  permissions: z.object({
    sources: z.array(z.string()),
    enforced: z.array(z.object({
      setting: z.string(),
      enabled: z.boolean().optional(),
    }).passthrough()).optional(),
  }).passthrough(),
  hooks: z.array(EntrySchema),
  skills: z.array(EntrySchema),
  agents: z.array(EntrySchema),
  plugins: z.array(z.unknown()),
  mcpServers: z.array(EntrySchema),
  lspServers: z.array(EntrySchema).optional(),
  configSources: z.object({
    layers: z.array(z.object({ role: z.string(), path: z.string().optional() }).passthrough()),
  }).passthrough(),
  externalCompat: z.object({
    cells: z.array(z.object({ vendor: z.string(), surface: z.string(), enabled: z.boolean() }).passthrough()),
  }).passthrough(),
}).passthrough()

export type GrokInspectReport = z.infer<typeof GrokInspectSchema>

export interface GrokInspectContext {
  /** GROK_HOME of the profile (its config.toml and requirements.toml are EYAS's). */
  configDir: string
  /** The turn's folders: instruction files inside them are not violations. */
  roots: readonly string[]
  /**
   * Whether GROK_HOME/managed_config.toml holds no setting at all. Without it
   * every layer EYAS does not own is a violation (fail closed).
   */
  managedLayerEmpty?: () => boolean
}

/**
 * Where grok keeps its vendor-managed config layer inside GROK_HOME. grok
 * 1.0.41 writes it during a session (empty for an account without managed
 * settings — the live lane's finding); the next inspect then lists it as the
 * 'managed' layer.
 */
export const GROK_MANAGED_LAYER_FILE = 'managed_config.toml'

/** A TOML text with no key and no table: only blank lines and comments. */
export function tomlHasNoSettings(text: string): boolean {
  return text.split(/\r?\n/).every((line) => {
    const t = line.trim()
    return t === '' || t.startsWith('#')
  })
}

export type GrokInspectVerdict =
  | { ok: true; version: string | null; violations: CliIsolationViolation[] }
  | { ok: false; error: string }

/** Parse the JSON document `grok inspect --json` printed (tolerating noise around it). */
export function parseInspectOutput(stdout: string): unknown {
  const text = stdout.trim()
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('no JSON document in the inspect output')
    return JSON.parse(text.slice(start, end + 1))
  }
}

function entryLabel(entry: z.infer<typeof EntrySchema>): string {
  const where = entry.source?.path ?? entry.source?.type ?? 'unknown source'
  return `${entry.name ?? entry.event ?? 'unnamed'} (${where})`
}

/** Judge one `grok inspect --json` report against the isolation contract. Pure. */
export function evaluateGrokInspect(raw: unknown, ctx: GrokInspectContext): GrokInspectVerdict {
  const parsed = GrokInspectSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: `grok inspect output not understood (${issue ? `${issue.path.join('.') || '(root)'}: ${issue.message}` : 'invalid'})` }
  }
  const report = parsed.data
  const out: CliIsolationViolation[] = []
  const configToml = join(ctx.configDir, 'config.toml')
  const requirementsToml = join(ctx.configDir, 'requirements.toml')

  // Ask mode can only be proven indirectly: always-approve locked off by
  // requirements.toml, and no permission rules but EYAS's own.
  const lock = report.permissions.enforced?.find((e) => e.setting === 'alwaysApprove')
  if (!lock || lock.enabled !== false) {
    out.push(violation('permissionMode', 'always-approve is not locked off (the requirements.toml bypass lock is not in force)'))
  }
  for (const source of report.permissions.sources) {
    const path = stripSourceLabel(source)
    if (!samePath(path, configToml)) out.push(violation('permissionMode', `permission rules loaded from ${path}`))
  }

  for (const layer of report.configSources.layers) {
    const path = layer.path ?? ''
    if (layer.role === 'user' && path && samePath(path, configToml)) continue
    if (layer.role === 'requirements' && path && samePath(path, requirementsToml)) continue
    if (layer.role === 'project') {
      // An untrusted folder's config is listed but never applied (A1 spike).
      if (report.projectTrusted === true) out.push(violation('folderTrust', `project config applied from ${path || 'the project folder'}`))
      continue
    }
    // Grok's own cache of the vendor-managed layer changes nothing while it
    // holds no setting; one with any setting could override EYAS's config.
    if (layer.role === 'managed' && path && samePath(path, join(ctx.configDir, GROK_MANAGED_LAYER_FILE)) && ctx.managedLayerEmpty?.() === true) continue
    // A layer EYAS does not own can switch ask mode, memory or the leader back on.
    const detail = `config layer '${layer.role}' from ${path || 'an unknown file'} is not EYAS's`
    out.push(violation('permissionMode', detail), violation('memory', detail), violation('leader', detail))
  }

  for (const server of report.mcpServers) {
    if (server.disabledReason) continue
    out.push(violation('mcpServers', entryLabel(server)))
  }
  for (const hook of report.hooks) out.push(violation('hooks', entryLabel(hook)))
  for (const plugin of report.plugins) {
    const name = typeof plugin === 'object' && plugin !== null && typeof (plugin as { name?: unknown }).name === 'string'
      ? (plugin as { name: string }).name
      : JSON.stringify(plugin).slice(0, 120)
    out.push(violation('plugins', name))
  }
  for (const lsp of report.lspServers ?? []) {
    if (lsp.disabledReason) continue
    out.push(violation('plugins', `language server ${entryLabel(lsp)}`))
  }

  for (const file of report.projectInstructions) {
    if (file.scope === 'project' && isInsideAny(file.path, ctx.roots)) continue
    out.push(violation('rules', `${file.path} (${file.scope ?? 'unknown scope'})`))
  }
  for (const [what, list] of [['skill', report.skills], ['agent', report.agents]] as const) {
    for (const entry of list) {
      if (entry.source?.type === 'builtin') continue
      if (entry.source?.path && isInsideAny(entry.source.path, ctx.roots)) continue
      out.push(violation('rules', `${what} ${entryLabel(entry)}`))
    }
  }

  for (const cell of report.externalCompat.cells) {
    if (cell.enabled) out.push(violation('compat', `${cell.vendor}.${cell.surface}`))
  }

  return { ok: true, version: report.grokVersion ?? null, violations: out }
}

// ─── Managed-file read-back ────────────────────

/** What a changed EYAS-owned file can no longer vouch for. */
const MANAGED_FILE_CHECKS: Readonly<Record<string, AcpIsolationCheck[]>> = {
  'config.toml': ['permissionMode', 'memory', 'leader'],
  'requirements.toml': ['permissionMode'],
  'trusted_folders.toml': ['folderTrust'],
  'mcp.json': ['mcpServers'],
}

/**
 * Read every file EYAS owns in the home back and compare it with what EYAS
 * wrote (ensureHome runs right before). A file that differs, is missing or
 * was replaced by a link fails the checks it carries.
 */
export function readBackManagedFiles(profile: Pick<AcpCliProfile, 'home' | 'managedFiles'>): CliIsolationViolation[] {
  const out: CliIsolationViolation[] = []
  for (const file of profile.managedFiles) {
    const base = file.path.split(/[\\/]/).pop() ?? file.path
    const checks = MANAGED_FILE_CHECKS[base] ?? ['unverified']
    let detail: string | null = null
    try {
      const current = readManagedFile(profile.home, file.path)
      if (current === null) detail = `${file.path} is missing from the EYAS home`
      else if (current !== file.content) detail = `${file.path} in the EYAS home differs from what EYAS wrote`
    } catch (err) {
      detail = `${file.path} could not be read back: ${err instanceof Error ? err.message : String(err)}`
    }
    if (detail) for (const check of checks) out.push(violation(check, detail))
  }
  return out
}

// ─── Kimi home ─────────────────────────────────

/** Skill folders kimi-cli 1.52.0 reads below HOME (source facts), all inside the EYAS home. */
const KIMI_SKILL_DIRS = ['.kimi/skills', '.agents/skills', '.claude/skills', '.codex/skills', '.config/agents/skills'] as const

type TomlParse = (text: string) => unknown

function bunToml(): TomlParse | null {
  const toml = (globalThis as { Bun?: { TOML?: { parse(s: string): unknown } } }).Bun?.TOML
  return toml ? (s) => toml.parse(s) : null
}

/**
 * The top-level keys of a TOML text EYAS needs from Kimi's config, read
 * without a TOML library: booleans before the first table, and whether a
 * `hooks` / `extra_skill_dirs` entry exists anywhere at top level or as a table.
 */
function scanKimiConfig(text: string): { booleans: Record<string, boolean>; hooks: boolean; extraSkillDirs: boolean } {
  const booleans: Record<string, boolean> = {}
  let hooks = false
  let extraSkillDirs = false
  let topLevel = true
  for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const header = /^\[\[?\s*([A-Za-z0-9_."'-]+)\s*\]\]?$/.exec(line)
    if (header) {
      topLevel = false
      const name = header[1].replace(/["']/g, '').split('.')[0]
      if (name === 'hooks') hooks = true
      continue
    }
    if (!topLevel) continue
    const assign = /^["']?([A-Za-z0-9_-]+)["']?\s*=\s*(.+)$/.exec(line)
    if (!assign) continue
    const [, key, value] = assign
    if (value === 'true' || value === 'false') booleans[key] = value === 'true'
    if (key === 'hooks' && !/^\[\s*\]$/.test(value)) hooks = true
    if (key === 'extra_skill_dirs' && !/^\[\s*\]$/.test(value)) extraSkillDirs = true
  }
  return { booleans, hooks, extraSkillDirs }
}

function kimiConfigFacts(text: string, parse: TomlParse | null): { booleans: Record<string, unknown>; hooks: boolean; extraSkillDirs: boolean } {
  if (parse) {
    const doc = parse(text) as Record<string, unknown>
    const nonEmpty = (v: unknown): boolean => Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null
    return { booleans: doc, hooks: nonEmpty(doc.hooks), extraSkillDirs: nonEmpty(doc.extra_skill_dirs) }
  }
  return scanKimiConfig(text)
}

function dirHasEntries(path: string): boolean | 'link' {
  try {
    const st = lstatSync(path)
    if (st.isSymbolicLink()) return 'link'
    if (!st.isDirectory()) return true
    return readdirSync(path).length > 0
  } catch {
    return false
  }
}

/**
 * Kimi's preflight: the spawn points Kimi at the EYAS Kimi home (its share
 * dir is the profile's configDir, so the config, credentials and skills Kimi
 * loads — and the config.toml session/set_model rewrites — are EYAS's), EYAS's
 * keys in its config.toml (auto-approve off, the host-skill merge off, no
 * hooks, no extra skill folders), its empty mcp.json, and no skills planted in
 * the home by an earlier session's shell.
 */
export function evaluateKimiHome(
  profile: Pick<AcpCliProfile, 'home' | 'configDir' | 'managedFiles'> & Partial<Pick<AcpCliProfile, 'env'>>,
  opts: { parseToml?: TomlParse | null } = {},
): CliIsolationViolation[] {
  const out = readBackManagedFiles(profile)
  if (profile.env) {
    let env: Record<string, string> | null = null
    try {
      env = profile.env()
    } catch (err) {
      out.push(violation('unverified', `the Kimi spawn environment could not be built: ${err instanceof Error ? err.message : String(err)}`))
    }
    const shareDir = env ? kimiShareDirOf(env) : null
    if (env && (!shareDir || !isAbsolute(shareDir) || !samePath(shareDir, profile.configDir))) {
      out.push(violation('permissionMode', `Kimi's share dir (${shareDir ?? 'unset'}) is not the EYAS Kimi home: another config.toml and its approval setting would apply`))
    }
  }
  const configRel = join(relative(profile.home, profile.configDir), 'config.toml')
  let text: string | null = null
  try {
    text = readManagedFile(profile.home, configRel)
  } catch (err) {
    out.push(violation('unverified', `${configRel} could not be read back: ${err instanceof Error ? err.message : String(err)}`))
  }
  if (text === null) {
    if (!out.some((v) => v.check === 'unverified')) out.push(violation('permissionMode', `${configRel} is missing from the EYAS home`))
  } else {
    let facts: ReturnType<typeof kimiConfigFacts> | null = null
    try {
      facts = kimiConfigFacts(text, opts.parseToml === undefined ? bunToml() : opts.parseToml)
    } catch (err) {
      out.push(violation('unverified', `${configRel} is not valid TOML: ${err instanceof Error ? err.message : String(err)}`))
    }
    if (facts) {
      if (facts.booleans.default_yolo !== KIMI_MANAGED_KEYS.default_yolo) out.push(violation('permissionMode', 'default_yolo is not false'))
      if (facts.booleans.merge_all_available_skills !== KIMI_MANAGED_KEYS.merge_all_available_skills) {
        out.push(violation('rules', 'merge_all_available_skills is not false (host skill folders would be merged)'))
      }
      if (facts.hooks) out.push(violation('hooks', `hooks are defined in ${configRel}`))
      if (facts.extraSkillDirs) out.push(violation('rules', `extra_skill_dirs is set in ${configRel}`))
    }
  }
  for (const dir of KIMI_SKILL_DIRS) {
    const state = dirHasEntries(join(profile.home, dir))
    if (state === 'link') out.push(violation('rules', `${dir} in the EYAS home is a link`))
    else if (state) out.push(violation('rules', `skills found in ${dir} of the EYAS home`))
  }
  return out
}

// ─── session/new ───────────────────────────────

const BYPASS_MODE_RE = /bypass|always|yolo|auto[-_ ]?approve|dangerous/i

/**
 * The permission mode session/new reports, when it reports one (grok 1.0.40
 * reports none; kimi always 'default'). A mode that approves on its own is a
 * violation. Read through the one session/new parser (acp-events.ts). Pure.
 */
export function evaluateSessionNew(response: unknown): CliIsolationViolation[] {
  const mode = parseAcpSessionNew(response).modeId
  return mode && BYPASS_MODE_RE.test(mode) ? [violation('permissionMode', `session mode '${mode}' approves tool calls on its own`)] : []
}

// ─── Tripwire ──────────────────────────────────

/** Which native tool calls must carry an EYAS decision before they run. */
export interface AcpTripwirePolicy {
  /** ACP tool kinds that must be decided by EYAS. */
  governedKinds: ReadonlySet<string>
  /** Tool names (the title of the first tool_call) that must be decided, whatever their kind. */
  governedNames: ReadonlySet<string>
  /**
   * Kinds the CLI never asks for but serves through EYAS's client fs: judged
   * at completion, when the fs handler has had its say.
   */
  fsServedKinds: ReadonlySet<string>
}

const GOVERNED_KINDS = new Set(['read', 'edit', 'delete', 'move', 'search', 'execute', 'fetch'])

/**
 * grok 1.0.40 asks for every native tool under EYAS's [permission] ask rules
 * (A1 spike) — including list_dir, spawn_subagent and search_tool, whose ACP
 * kind is 'other'. EYAS's own bridge tools (use_tool with an eyas__ tool) are
 * allowed without asking: the bridge gates each call itself.
 */
const GROK_TRIPWIRE: AcpTripwirePolicy = {
  governedKinds: GOVERNED_KINDS,
  governedNames: new Set([
    'read_file', 'list_dir', 'grep', 'run_terminal_command', 'write', 'write_file', 'search_replace',
    'str_replace', 'apply_patch', 'spawn_subagent', 'search_tool', 'use_tool', 'web_fetch', 'web_search', 'monitor',
  ]),
  fsServedKinds: new Set(),
}

/**
 * kimi-cli 1.52.0 (source, unverified on a host): write, replace, shell and
 * background tasks ask; reads never ask but go through EYAS's client fs.
 * Search and web tools neither ask nor use the client fs, so a turn that runs
 * one is stopped.
 */
const KIMI_TRIPWIRE: AcpTripwirePolicy = {
  governedKinds: GOVERNED_KINDS,
  governedNames: new Set(),
  fsServedKinds: new Set(['read']),
}

export function tripwirePolicyFor(providerId: AcpProviderId): AcpTripwirePolicy {
  return providerId === 'kimi-cli' ? KIMI_TRIPWIRE : GROK_TRIPWIRE
}

/** Keys of a tool call's rawInput that name a file or folder. */
const RAW_PATH_KEYS = ['path', 'file_path', 'filePath', 'target_file', 'target_directory', 'directory', 'notebook_path'] as const

/** The paths a tool call names (rawInput fields and ACP locations), as given. */
export function toolCallPaths(input: { rawInput?: unknown; locations?: Array<{ path?: unknown }> | null }): string[] {
  const out: string[] = []
  const raw = input.rawInput
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const key of RAW_PATH_KEYS) {
      const v = (raw as Record<string, unknown>)[key]
      if (typeof v === 'string' && v.trim()) out.push(v)
    }
  }
  for (const loc of input.locations ?? []) {
    if (typeof loc?.path === 'string' && loc.path.trim()) out.push(loc.path)
  }
  return out
}

interface CallState {
  name?: string
  kind?: string
  bridged: boolean
  paths: Set<string>
  decided: boolean
}

export interface AcpTripwire {
  /** Feed one parsed session/update; returns the violations it proves (empty: fine). */
  observe(event: AcpSessionEvent): CliIsolationViolation[]
  /** EYAS answered a permission request for this call (allow, reject or cancel). */
  noteDecision(toolCallId: string): void
  /** EYAS's client fs served (after its own checks) this absolute path. */
  noteFsServed(path: string): void
  /** Every path the CLI named for this call so far (for the fs handler's coverage). */
  pathsOf(toolCallId: string): string[]
  /** What the session said about this call so far: its tool name (first tool_call title) and its kind. */
  describe(toolCallId: string): { name?: string; kind?: string }
}

/** The EYAS bridge's tools, reached through Grok's use_tool meta-tool. */
const EYAS_BRIDGE_PREFIX = 'eyas__'

/**
 * The runtime tripwire. It never decides anything itself: it only notices a
 * governed call that ran without one of EYAS's decisions. A pending tool_call
 * alone is never a violation.
 */
export function createAcpTripwire(policy: AcpTripwirePolicy): AcpTripwire {
  const calls = new Map<string, CallState>()
  const fsServed = new Set<string>()

  const state = (id: string): CallState => {
    let s = calls.get(id)
    if (!s) {
      s = { bridged: false, paths: new Set(), decided: false }
      calls.set(id, s)
    }
    return s
  }

  const judge = (id: string, s: CallState, status: string | undefined): CliIsolationViolation[] => {
    if (status !== 'in_progress' && status !== 'completed') return []
    if (s.decided || s.bridged) return []
    const governed = (s.kind !== undefined && policy.governedKinds.has(s.kind)) || (s.name !== undefined && policy.governedNames.has(s.name))
    if (!governed) return []
    if (s.kind !== undefined && policy.fsServedKinds.has(s.kind)) {
      if (status !== 'completed') return []
      for (const p of s.paths) if (fsServed.has(realOf(p))) return []
    }
    const label = s.name ?? s.kind ?? 'tool'
    return [violation('ungovernedTool', `${label} (${id}) ran without an EYAS decision`)]
  }

  return {
    observe(event) {
      if (event.kind !== 'tool_call' && event.kind !== 'tool_call_update') return []
      const s = state(event.toolCallId)
      const out: CliIsolationViolation[] = []
      if (event.kind === 'tool_call' && s.name === undefined && event.title) {
        // The first tool_call's title is the tool's own name (grok 1.0.40);
        // later titles are display text.
        s.name = event.title
        if (/^memory_/.test(s.name)) out.push(violation('memory', `the CLI's own memory tool ${s.name} was called`))
      }
      if (event.toolKind) s.kind = event.toolKind
      const raw = event.rawInput
      if (s.name === 'use_tool' && raw && typeof raw === 'object') {
        const tool = (raw as { tool_name?: unknown }).tool_name
        if (typeof tool === 'string') s.bridged = tool.startsWith(EYAS_BRIDGE_PREFIX)
      }
      for (const p of toolCallPaths({ rawInput: raw, locations: event.locations })) s.paths.add(p)
      out.push(...judge(event.toolCallId, s, event.status))
      return out
    },
    noteDecision(toolCallId) {
      state(toolCallId).decided = true
    },
    noteFsServed(path) {
      fsServed.add(realOf(path))
    },
    pathsOf(toolCallId) {
      return [...(calls.get(toolCallId)?.paths ?? [])]
    },
    describe(toolCallId) {
      const s = calls.get(toolCallId)
      return {
        ...(s?.name !== undefined ? { name: s.name } : {}),
        ...(s?.kind !== undefined ? { kind: s.kind } : {}),
      }
    },
  }
}

// ─── Verifier ──────────────────────────────────

export interface InspectRunResult {
  code: number
  stdout: string
  stderr: string
}

export type InspectRunner = (
  executable: string,
  args: readonly string[],
  opts: { cwd: string; env: Record<string, string>; timeoutMs: number },
) => Promise<InspectRunResult>

const INSPECT_ARGS = ['inspect', '--json'] as const
const INSPECT_TIMEOUT_MS = 15_000
/** How long a passed preflight stands for the same binary, folder and home. */
export const PREFLIGHT_CACHE_TTL_MS = 10 * 60 * 1000

const defaultInspectRunner: InspectRunner = (executable, args, opts) =>
  new Promise((resolveRun) => {
    execFile(
      executable,
      [...args],
      { cwd: opts.cwd, env: opts.env, timeout: opts.timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'utf-8' },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0
        resolveRun({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
      },
    )
  })

export interface AcpPreflightContext {
  /** Absolute path of the executable the turn will spawn. */
  executable: string
  /** The session cwd. */
  cwd: string
  /** The turn's folders (the fs jail roots). */
  roots: readonly string[]
  /** Ignore a cached pass (Verify now). */
  refresh?: boolean
}

export interface AcpVerifier {
  readonly providerId: AcpProviderId
  readonly tripwirePolicy: AcpTripwirePolicy
  /** Before the spawn. Throws CliIsolationError when the CLI is not isolated or cannot be verified. */
  preflight(ctx: AcpPreflightContext): Promise<void>
  /** After session/new. Throws CliIsolationError on a violation; records 'verified' otherwise. */
  checkSessionNew(response: unknown): void
  /** Record a runtime violation (tripwire) and return the error that ends the turn. */
  fail(violations: CliIsolationViolation[]): CliIsolationError
}

interface VerifierLogger {
  debug?: (obj: unknown, msg?: string) => void
  info?: (obj: unknown, msg?: string) => void
  warn?: (obj: unknown, msg?: string) => void
  error?: (obj: unknown, msg?: string) => void
}

export interface AcpVerifierOptions {
  logger?: VerifierLogger
  /** Runs `grok inspect --json` (tests inject a fake). */
  runInspect?: InspectRunner
  /** What the executable resolver knows about the binary (source, version). */
  runtime?: Partial<CliRuntimeInfo> | (() => Partial<CliRuntimeInfo> | null | undefined)
  /** Clock for the preflight cache (tests). */
  now?: () => number
  cacheTtlMs?: number
}

/** Passed preflights: key → expiry. Only passes are cached; a failure re-checks every turn. */
const preflightPasses = new Map<string, number>()

/** Forget cached preflight passes (Verify now, provider reload, tests). */
export function clearAcpPreflightCache(providerId?: AcpProviderId): void {
  if (!providerId) {
    preflightPasses.clear()
    return
  }
  for (const key of preflightPasses.keys()) if (key.startsWith(`${providerId}\0`)) preflightPasses.delete(key)
}

/**
 * Where a CLI finds user content in its home. A skill, rule, hook or memory
 * planted there by an earlier session's shell changes one of these, so a
 * cached pass never outlives it.
 */
const HOME_FINGERPRINT_PATHS = [
  '', '.grok', '.grok/skills', '.grok/agents', '.grok/rules', '.grok/hooks', '.grok/plugins', '.grok/memory',
  '.claude', '.agents', '.cursor', '.codex', '.config', '.kimi', '.kimi/skills',
] as const

function statKey(path: string): string {
  try {
    const st = lstatSync(path)
    return `${st.isSymbolicLink() ? 'l' : st.isDirectory() ? 'd' : 'f'}:${st.mtimeMs}:${st.size}`
  } catch {
    return '-'
  }
}

/**
 * GROK_HOME is keyed by its entry names, not its mtime: EYAS rewrites
 * sandbox.toml there for every sandboxed turn (grok-cli/sandbox-profile.ts,
 * temp file + rename), which moves the folder's mtime without changing
 * anything the CLI loads. Any other entry added or removed still changes the
 * key.
 */
const LISTED_FINGERPRINT_PATHS: ReadonlySet<string> = new Set(['.grok'])
const FINGERPRINT_IGNORED_ENTRY_RE = /^(?:sandbox\.toml|\.sandbox\.toml\.[0-9a-f]+\.tmp)$/

function listingKey(path: string): string {
  try {
    const st = lstatSync(path)
    if (st.isSymbolicLink() || !st.isDirectory()) return statKey(path)
    const names = readdirSync(path).filter((n) => !FINGERPRINT_IGNORED_ENTRY_RE.test(n)).sort()
    return `d:${createHash('sha256').update(names.join('\0')).digest('hex')}`
  } catch {
    return '-'
  }
}

/**
 * Files keyed by what they say: grok rewrites its managed-layer cache every
 * session with the same bytes, so its mtime would void every cached pass,
 * while a setting appearing in it must void the pass at once.
 */
const CONTENT_FINGERPRINT_PATHS = [join('.grok', GROK_MANAGED_LAYER_FILE)] as const

function contentKey(path: string): string {
  try {
    const st = lstatSync(path)
    if (st.isSymbolicLink() || !st.isFile()) return statKey(path)
    return `c:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
  } catch {
    return '-'
  }
}

function preflightKey(profile: AcpCliProfile, ctx: AcpPreflightContext): string {
  let binary = '-'
  try {
    const st = statSync(ctx.executable)
    binary = `${st.mtimeMs}:${st.size}`
  } catch { /* keyed as missing */ }
  const managed = createHash('sha256')
  for (const file of profile.managedFiles) managed.update(`${file.path}\0${file.content}\0`)
  const home = [
    ...HOME_FINGERPRINT_PATHS.map((p) => (LISTED_FINGERPRINT_PATHS.has(p) ? listingKey : statKey)(join(profile.home, p))),
    ...CONTENT_FINGERPRINT_PATHS.map((p) => contentKey(join(profile.home, p))),
  ].join('|')
  // A fresh, empty scratch folder (background calls get one each) can only
  // pick up what lies above it, so every such folder under the same parent
  // shares one verdict instead of one inspect per call.
  const location = ctx.roots.length === 1 && resolve(ctx.roots[0]) === resolve(ctx.cwd) && isEmptyDir(ctx.cwd)
    ? `empty-in:${resolve(dirname(ctx.cwd))}`
    : `${resolve(ctx.cwd)}\0${[...ctx.roots].map((r) => resolve(r)).sort().join('\0')}`
  return [profile.providerId, ctx.executable, binary, location, managed.digest('hex'), home].join('\0')
}

function isEmptyDir(path: string): boolean {
  try {
    return lstatSync(path).isDirectory() && readdirSync(path).length === 0
  } catch {
    return false
  }
}

/**
 * The verifier of one ACP profile. Pure until used: nothing runs before
 * preflight() is called for a turn (or at provider load).
 */
export function createAcpVerifier(profile: AcpCliProfile, opts: AcpVerifierOptions = {}): AcpVerifier {
  const providerId = profile.providerId
  const logger = opts.logger
  const runInspect = opts.runInspect ?? defaultInspectRunner
  const now = opts.now ?? Date.now
  const ttl = opts.cacheTtlMs ?? PREFLIGHT_CACHE_TTL_MS
  let lastExecutable: string | null = null
  let lastVersion: string | null = null

  const runtimeInfo = (): CliRuntimeInfo => {
    const known = typeof opts.runtime === 'function' ? opts.runtime() : opts.runtime
    return {
      path: known?.path ?? lastExecutable,
      version: lastVersion ?? known?.version ?? null,
      source: known?.source ?? null,
    }
  }

  const record = (status: 'verified' | 'violation' | 'unverified', checks: CliIsolationViolation[]): void => {
    setIsolationStatus(providerId, { status, checks, runtime: runtimeInfo() })
  }

  const refuse = (status: 'violation' | 'unverified', checks: CliIsolationViolation[]): CliIsolationError => {
    record(status, checks)
    logger?.warn?.({ provider: providerId, checks }, `${providerId}: isolation check failed — turn refused`)
    return new CliIsolationError(providerId, checks)
  }

  const grokPreflight = async (ctx: AcpPreflightContext): Promise<CliIsolationViolation[]> => {
    let result: InspectRunResult
    try {
      result = await runInspect(ctx.executable, INSPECT_ARGS, { cwd: ctx.cwd, env: profile.env(), timeoutMs: INSPECT_TIMEOUT_MS })
    } catch (err) {
      throw refuse('unverified', [violation('unverified', `grok inspect could not run: ${err instanceof Error ? err.message : String(err)}`)])
    }
    if (result.code !== 0) {
      throw refuse('unverified', [violation('unverified', `grok inspect exited with code ${result.code}: ${result.stderr.trim().slice(0, 300)}`)])
    }
    let doc: unknown
    try {
      doc = parseInspectOutput(result.stdout)
    } catch (err) {
      throw refuse('unverified', [violation('unverified', `grok inspect printed no JSON: ${err instanceof Error ? err.message : String(err)}`)])
    }
    const verdict = evaluateGrokInspect(doc, {
      configDir: profile.configDir,
      roots: ctx.roots,
      // Read with the home's guards (inside the home, no symlink on the way);
      // a file that cannot be read is never "empty".
      managedLayerEmpty: () => {
        try {
          const text = readManagedFile(profile.home, relative(profile.home, join(profile.configDir, GROK_MANAGED_LAYER_FILE)))
          return text !== null && tomlHasNoSettings(text)
        } catch {
          return false
        }
      },
    })
    if (!verdict.ok) throw refuse('unverified', [violation('unverified', verdict.error)])
    if (verdict.version) lastVersion = verdict.version
    return [...verdict.violations, ...readBackManagedFiles(profile)]
  }

  return {
    providerId,
    tripwirePolicy: tripwirePolicyFor(providerId),

    async preflight(ctx) {
      lastExecutable = ctx.executable
      const key = preflightKey(profile, ctx)
      if (!ctx.refresh) {
        const until = preflightPasses.get(key)
        if (until !== undefined && until > now()) {
          // A pass for this very binary, folder and home stands; a status
          // reset in the meantime (a new sign-in) is verified again from it.
          if (providerId === 'grok-cli' && getIsolationStatus(providerId).status === 'unverified') record('verified', [])
          return
        }
      }
      preflightPasses.delete(key)

      const violations = providerId === 'grok-cli' ? await grokPreflight(ctx) : evaluateKimiHome(profile)
      if (violations.length > 0) {
        const unverifiable = violations.every((v) => v.check === 'unverified')
        throw refuse(unverifiable ? 'unverified' : 'violation', violations)
      }

      const current = getIsolationStatus(providerId).status
      if (providerId === 'grok-cli') {
        // The preflight proves the configuration; sign-in is the sign-in
        // flow's to report, so its 'auth-required' is kept.
        if (current !== 'auth-required') record('verified', [])
      } else if (current === 'violation') {
        // Kimi stays unverified until a session on this host has started.
        record('unverified', [])
      }
      preflightPasses.set(key, now() + ttl)
      logger?.debug?.({ provider: providerId, cwd: ctx.cwd }, `${providerId}: isolation preflight passed`)
    },

    checkSessionNew(response) {
      const violations = evaluateSessionNew(response)
      if (violations.length > 0) throw refuse('violation', violations)
      record('verified', [])
    },

    fail(violations) {
      record('violation', violations)
      logger?.error?.({ provider: providerId, violations }, `${providerId}: isolation tripwire fired — session cancelled`)
      return new CliIsolationError(providerId, violations)
    },
  }
}

/**
 * Seed the isolation status when the provider loads: the same preparation
 * and preflight a turn runs, in an empty EYAS scratch folder, without a
 * model call. Never throws; a failure is logged and leaves the status it
 * recorded.
 */
export async function verifyAcpIsolationAtLoad(
  verifier: AcpVerifier,
  ctx: { profile: Pick<AcpCliProfile, 'ensureHome'>; executable: string; cwd: string },
  logger?: VerifierLogger,
): Promise<void> {
  try {
    ctx.profile.ensureHome()
    await verifier.preflight({ executable: ctx.executable, cwd: ctx.cwd, roots: [ctx.cwd], refresh: true })
  } catch (err) {
    logger?.warn?.({ provider: verifier.providerId, err: err instanceof Error ? err.message : String(err) }, `${verifier.providerId}: isolation preflight at load did not pass`)
  }
}
