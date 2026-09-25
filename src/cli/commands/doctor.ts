import { defineCommand } from 'citty'
import { existsSync, accessSync, constants, lstatSync } from 'fs'
import { join, resolve } from 'path'
import { platform, arch, version as nodeVersion } from 'process'

// Color helpers for terminal output
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

export interface CheckResult {
  name: string
  status: 'ok' | 'warn' | 'fail'
  message: string
}

export function checkPlatform(): CheckResult {
  const runtime = typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : `Node.js ${nodeVersion}`
  return {
    name: 'Platform',
    status: 'ok',
    message: `${platform} ${arch} — ${runtime}`,
  }
}

export function checkConfig(configPath: string): CheckResult {
  try {
    if (!existsSync(configPath)) {
      return { name: 'Config', status: 'ok', message: `${configPath} not found (defaults will be used)` }
    }
    const { readFileSync } = require('fs')
    const content = readFileSync(configPath, 'utf-8')
    // Basic YAML parse check
    if (content.trim().length === 0) {
      return { name: 'Config', status: 'warn', message: `${configPath} is empty` }
    }
    return { name: 'Config', status: 'ok', message: `${configPath} is valid` }
  } catch (err: any) {
    return { name: 'Config', status: 'fail', message: err.message }
  }
}

export function checkDatabase(dbPath: string): CheckResult {
  if (!existsSync(dbPath)) {
    // Check if parent directory is writable (DB will be created on first run)
    const dir = dbPath.substring(0, dbPath.lastIndexOf('/'))
    if (dir && existsSync(dir)) {
      try {
        accessSync(dir, constants.W_OK)
        return { name: 'Database', status: 'warn', message: `${dbPath} does not exist yet (directory writable, will be created)` }
      } catch {
        return { name: 'Database', status: 'fail', message: `${dbPath} does not exist and directory is not writable` }
      }
    }
    return { name: 'Database', status: 'warn', message: `${dbPath} does not exist (will be created on first run)` }
  }

  try {
    accessSync(dbPath, constants.R_OK | constants.W_OK)
    return { name: 'Database', status: 'ok', message: `${dbPath} exists and is writable` }
  } catch {
    return { name: 'Database', status: 'fail', message: `${dbPath} exists but is not writable` }
  }
}

export function checkMasterKey(): CheckResult {
  const keyPath = 'data/master.key'
  if (existsSync(keyPath)) {
    return { name: 'Master Key', status: 'ok', message: 'data/master.key exists' }
  }
  return { name: 'Master Key', status: 'warn', message: 'data/master.key not found (will be generated during setup)' }
}

export async function checkOllama(): Promise<CheckResult> {
  try {
    const res = await fetch('http://localhost:11434', { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      return { name: 'Ollama', status: 'ok', message: 'Ollama is reachable at localhost:11434' }
    }
    return { name: 'Ollama', status: 'warn', message: `Ollama responded with ${res.status}` }
  } catch {
    return { name: 'Ollama', status: 'warn', message: 'Ollama not reachable at localhost:11434 (optional)' }
  }
}

/**
 * Live SQLite self-test on a scratch in-memory connection (spec §13, spike
 * §2 #2): FTS5, sqlite-vec load, one int8 row, one KNN. Uses the same
 * openRawSqlite() path the server uses, so the darwin custom-SQLite probe
 * is exercised too — the data file is never opened by doctor.
 */
export async function checkSqliteCapabilities(): Promise<CheckResult> {
  try {
    const { openRawSqlite, customSqliteStatus } = await import('../../core/db/connection.js')
    const { probeSqliteCapabilities, describeSqliteCapabilities } = await import('../../core/db/sqlite-capabilities.js')
    const raw = openRawSqlite(':memory:')
    try {
      const caps = probeSqliteCapabilities(raw)
      const custom = customSqliteStatus()
      const via = custom.libraryPath ? ` via ${custom.libraryPath}` : ''
      const message = describeSqliteCapabilities(caps) + via
      if (!caps.fts5) {
        return { name: 'SQLite', status: 'fail', message: `${message} — FTS5 is required (memory, conversation and vault search)` }
      }
      if (!caps.vec0) {
        // extensionLoading true means sqlite-vec DID load and register — the int8 KNN self-test
        // itself failed, which points at a broken/incompatible sqlite-vec build, not a missing
        // SQLite library. Suggesting "brew install sqlite" there would send the operator down the
        // wrong path, since extensions already load fine on this connection.
        const remedy = caps.extensionLoading
          ? 'sqlite-vec extension loaded but the int8 KNN self-test failed — reinstall/rebuild sqlite-vec for this platform (a stale or mismatched binary is the likely cause, not the SQLite library itself)'
          : platform === 'darwin'
            ? "brew install sqlite (Apple's libsqlite3 refuses extensions)"
            : 'sqlite-vec binary for this platform (glibc only; musl needs vec0 built from the amalgamation)'
        return { name: 'SQLite', status: 'warn', message: `${message} — remedy: ${remedy}` }
      }
      return { name: 'SQLite', status: 'ok', message }
    } finally {
      raw.close()
    }
  } catch (err: any) {
    return { name: 'SQLite', status: 'fail', message: `capability probe failed: ${err?.message ?? err}` }
  }
}

/** Which zstd tier L0 compression will use (spec §6): native is expected, WASM is a warning, none is a failure. */
export async function checkZstd(): Promise<CheckResult> {
  try {
    const { initZstd } = await import('../../shared/zstd.js')
    const tier = await initZstd()
    const label = tier === 'bun'
      ? 'Bun native'
      : tier === 'node'
        ? 'node:zlib native'
        : '@bokuweb/zstd-wasm (WASM fallback, about 2x slower than native)'
    return { name: 'zstd', status: tier === 'wasm' ? 'warn' : 'ok', message: `L0 compression tier: ${label}` }
  } catch (err: any) {
    return { name: 'zstd', status: 'fail', message: `no zstd backend — ${err?.message ?? err}` }
  }
}

/**
 * The embedder recall runs on (always local, whatever chat or embedding
 * provider is configured): multilingual-e5-small when @huggingface/transformers
 * is installed and its weights are in the model cache, otherwise the hashed
 * stem embedder — a warning with the remedy. Checks files only; the model is
 * never loaded here.
 */
export async function checkMemoryEmbedder(opts?: {
  cacheDir?: string
  transformersInstalled?: () => boolean
}): Promise<CheckResult> {
  const name = 'Memory embedder'
  try {
    const {
      E5_CACHE_DIR, E5_HF_ID, findE5Weights, isTransformersInstalled,
    } = await import('../../modules/memory/embeddings/local-embedder.js')
    const { HASH_EMBED_MODEL_ID } = await import('../../modules/memory/embeddings/hash-embedder.js')
    const cacheDir = opts?.cacheDir ?? E5_CACHE_DIR
    const hash = `hashed stem embedder (${HASH_EMBED_MODEL_ID})`
    if (!(opts?.transformersInstalled ?? isTransformersInstalled)()) {
      return {
        name,
        status: 'warn',
        message: `${hash} — @huggingface/transformers is not installed, so recall uses the weaker fallback. Remedy: run "bun add @huggingface/transformers" (or "bun install") in the EYAS folder, then restart`,
      }
    }
    const weights = findE5Weights(cacheDir)
    if (!weights) {
      return {
        name,
        status: 'warn',
        message: `${hash} for now — the multilingual-e5-small weights are not in ${resolve(cacheDir)} yet; the next start downloads them (about 130 MB) from Hugging Face (${E5_HF_ID}). Until they load, recall uses the weaker fallback`,
      }
    }
    return { name, status: 'ok', message: `multilingual-e5-small, local (weights in ${weights})` }
  } catch (err: any) {
    return { name, status: 'warn', message: `could not be checked — ${err?.message ?? err}` }
  }
}

type ClaudeRuntimeInfo = import('../../modules/model/submodules/claude-code/runtime.js').ClaudeRuntimeInfo

const CLAUDE_SOURCE_LABEL: Record<NonNullable<ClaudeRuntimeInfo['source']>, string> = {
  'override': 'EYAS_CLAUDE_CODE_BIN',
  'host': 'claude on PATH',
  'sdk-bundled': 'SDK-bundled',
}

/**
 * The Claude Code runtime EYAS runs — the same resolver the provider uses:
 * source, path and version, version skew against the pinned Agent SDK, and
 * whether it is signed in (no identity fields). An invalid
 * EYAS_CLAUDE_CODE_BIN is a failure; the SDK-bundled last resort, skew and
 * a signed-out runtime are warnings. A host `claude` the override shadows is
 * reported as information only.
 */
export async function checkClaudeRuntime(getInfo?: () => Promise<ClaudeRuntimeInfo>): Promise<CheckResult> {
  const name = 'Claude Code runtime'
  let info: ClaudeRuntimeInfo
  try {
    info = await (getInfo ?? (async () => {
      const { getClaudeRuntimeInfo } = await import('../../modules/model/submodules/claude-code/runtime.js')
      return getClaudeRuntimeInfo({ refresh: true })
    }))()
  } catch (err: any) {
    return { name, status: 'warn', message: `could not be checked — ${err?.message ?? err}` }
  }
  if (!info.ok || !info.source) {
    const message = `${info.detail ?? info.error ?? 'not available'}${info.remedy ? ` — remedy: ${info.remedy}` : ''}`
    return { name, status: info.error === 'override-invalid' ? 'fail' : 'warn', message }
  }
  const parts = [`${CLAUDE_SOURCE_LABEL[info.source]} ${info.path}`, `version ${info.version ?? 'unknown'}`]
  if (info.source === 'sdk-bundled') {
    parts.push('last resort — install Claude Code or set EYAS_CLAUDE_CODE_BIN')
  }
  if (info.skew) parts.push(`version skew: the Agent SDK was built for ${info.expectedVersion}`)
  parts.push(`signed in: ${info.signedIn === null ? 'not checked' : info.signedIn ? 'yes' : 'no'}`)
  if (info.hostCli) {
    parts.push(`host claude ${info.hostCli.version ?? '(version unknown)'} at ${info.hostCli.path} is not used by EYAS`)
  }
  const status = info.warnings.length > 0 || info.skew || info.signedIn === false ? 'warn' : 'ok'
  return { name, status, message: parts.join('; ') }
}

type IsolationCliId = import('../../modules/model/cli-runtime/verified-versions.js').IsolationCliId
type CliVerifiedVersion = import('../../modules/model/cli-runtime/verified-versions.js').CliVerifiedVersion
type ExecutableResolution = import('../../modules/model/cli-runtime/executables.js').ExecutableResolution

const ISOLATION_CLI_LABEL: Record<IsolationCliId, string> = {
  'claude-code': 'Claude Code',
  'grok-cli': 'Grok CLI',
  'kimi-cli': 'Kimi Code CLI',
}

/** How each CLI's binary was found (the override variable, PATH, the SDK's own copy). */
const ISOLATION_SOURCE_LABEL: Record<IsolationCliId, Record<'override' | 'host' | 'sdk-bundled', string>> = {
  'claude-code': { 'override': 'EYAS_CLAUDE_CODE_BIN', 'host': 'claude on PATH', 'sdk-bundled': 'SDK-bundled' },
  'grok-cli': { 'override': 'EYAS_GROK_BIN', 'host': 'grok on PATH', 'sdk-bundled': 'SDK-bundled' },
  'kimi-cli': { 'override': 'EYAS_KIMI_BIN', 'host': 'kimi on PATH', 'sdk-bundled': 'SDK-bundled' },
}

export interface CliIsolationCheckDeps {
  /** The executable resolution of one CLI (default: the cli-runtime resolver, fresh). */
  resolve?: (id: IsolationCliId) => Promise<ExecutableResolution>
  /** Parent of the EYAS-owned CLI homes (default: InstancePaths.cliHomesDir). */
  homesDir?: string
  /** The versions the live isolation lane last passed on (default: the shipped record). */
  verified?: Readonly<Record<IsolationCliId, Readonly<CliVerifiedVersion>>>
  /** Read back what EYAS owns in an ACP CLI's home (default: the preflight's own read-back). */
  readBack?: (id: 'grok-cli' | 'kimi-cli', homesDir: string) => Promise<Array<{ check: string; detail: string }>>
  platform?: NodeJS.Platform
}

/**
 * One 'CLI isolation' line per CLI provider: the executable EYAS runs (path,
 * how it was found, version), whether the live isolation lane has proven
 * that version (drift from the last proven one is a warning — EYAS still
 * checks every session at start), and for Grok and Kimi their EYAS-owned
 * home: present, private, and the files EYAS manages there unchanged.
 * Read-only: nothing is created, rewritten or spawned beyond `--version`.
 */
export async function checkCliIsolation(deps: CliIsolationCheckDeps = {}): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  let ids: readonly IsolationCliId[]
  let verified: Readonly<Record<IsolationCliId, Readonly<CliVerifiedVersion>>>
  let drift: typeof import('../../modules/model/cli-runtime/verified-versions.js').isolationDrift
  let homesDir: string
  try {
    const record = await import('../../modules/model/cli-runtime/verified-versions.js')
    ids = record.ISOLATION_CLI_IDS
    verified = deps.verified ?? record.CLI_VERIFIED_VERSIONS
    drift = record.isolationDrift
    homesDir = deps.homesDir ?? (await import('../../core/instance.js')).resolveInstance({ ensureDirs: false }).cliHomesDir
  } catch (err: any) {
    return [{ name: 'CLI isolation', status: 'warn', message: `could not be checked — ${err?.message ?? err}` }]
  }
  const resolve = deps.resolve ?? (async (id: IsolationCliId) => {
    const { resolveCliExecutable } = await import('../../modules/model/cli-runtime/executables.js')
    return resolveCliExecutable(id, { refresh: true })
  })
  const readBack = deps.readBack ?? (async (id: 'grok-cli' | 'kimi-cli', dir: string) => {
    const { createAcpProfile } = await import('../../modules/model/submodules/grok-cli/acp-profiles.js')
    const { evaluateKimiHome, readBackManagedFiles } = await import('../../modules/model/submodules/grok-cli/acp-verify.js')
    const profile = createAcpProfile(id, { homesDir: dir })
    return id === 'grok-cli' ? readBackManagedFiles(profile) : evaluateKimiHome(profile)
  })
  const platform = deps.platform ?? process.platform

  for (const id of ids) {
    const name = `CLI isolation (${ISOLATION_CLI_LABEL[id]})`
    try {
      const r = await resolve(id)
      if (!r.ok) {
        if (r.error === 'not-found') {
          results.push({ name, status: 'ok', message: 'not installed' })
        } else {
          results.push({ name, status: r.error === 'override-invalid' ? 'fail' : 'warn', message: `${r.detail}${r.remedy ? ` — remedy: ${r.remedy}` : ''}` })
        }
        continue
      }

      let status: CheckResult['status'] = 'ok'
      const raise = (to: CheckResult['status']) => {
        if (to === 'fail' || (to === 'warn' && status === 'ok')) status = to
      }
      const parts = [`${ISOLATION_SOURCE_LABEL[id][r.source]} ${r.path}`, `version ${r.version ?? 'unknown'}`]
      const last = verified[id]
      const stillChecked = 'EYAS still checks every session at start'
      switch (drift(id, r.version, verified)) {
        case 'match':
          parts.push(`isolation proven on this version (${last.verifiedAt ?? 'date unknown'})`)
          break
        case 'drift':
          raise('warn')
          parts.push(`isolation last proven on ${last.version} (${last.verifiedAt ?? 'date unknown'}), not on this version — ${stillChecked}; the release check (bun run test:live-cli) proves it`)
          break
        case 'never-verified':
          raise('warn')
          parts.push(`isolation never proven on a host with this CLI — ${stillChecked}`)
          break
        case 'unknown-version':
          raise('warn')
          parts.push(`the binary reported no version, so it cannot be matched with the last proven one (${last.version}) — ${stillChecked}`)
          break
      }

      if (id === 'grok-cli' || id === 'kimi-cli') {
        const home = join(homesDir, id)
        let st: ReturnType<typeof lstatSync> | null = null
        try {
          st = lstatSync(home)
        } catch {
          st = null
        }
        if (!st) {
          parts.push('EYAS home not created yet (the first run creates it)')
        } else if (st.isSymbolicLink() || !st.isDirectory()) {
          raise('fail')
          parts.push(`EYAS home ${home} is ${st.isSymbolicLink() ? 'a symbolic link' : 'not a folder'} — EYAS refuses to run the CLI from it; remedy: remove it, the next run recreates it`)
        } else {
          if (platform !== 'win32' && (st.mode & 0o077) !== 0) {
            raise('warn')
            parts.push(`EYAS home ${home} is open to other users (mode ${(st.mode & 0o777).toString(8)}) although it holds the CLI's sign-in — remedy: chmod 700 ${home}`)
          }
          const violations = await readBack(id, homesDir)
          if (violations.length === 0) {
            parts.push('EYAS home and managed files intact')
          } else {
            raise('warn')
            const details = [...new Set(violations.map((v) => v.detail))]
            parts.push(`${details.join('; ')} — EYAS rewrites its files before the next run; a change between runs means something else edits that folder`)
          }
        }
      }
      results.push({ name, status, message: parts.join('; ') })
    } catch (err: any) {
      results.push({ name, status: 'warn', message: `could not be checked — ${err?.message ?? err}` })
    }
  }
  return results
}

type SandboxCli = import('../../modules/model/cli-runtime/sandbox/types.js').SandboxCli
type FileSandboxInfo = import('../../modules/model/cli-runtime/sandbox/types.js').FileSandboxInfo

const SANDBOX_CLI_LABEL: Record<SandboxCli, string> = {
  'claude-code': 'Claude Code',
  'grok-cli': 'Grok CLI',
  'kimi-cli': 'Kimi Code CLI',
}

/** What to do about a missing sandbox, per reason. */
const SANDBOX_REMEDY: Partial<Record<FileSandboxInfo['reason'], string>> = {
  'no-bwrap': 'install bubblewrap (bwrap)',
  'no-socat': 'install socat (Claude Code needs it next to bubblewrap)',
  'bwrap-unusable': 'allow unprivileged user namespaces (in a container: run it with them enabled)',
}

export interface CliSandboxCheckDeps {
  /** Is this CLI installed (its executable resolves)? */
  installed?: (cli: SandboxCli) => Promise<boolean>
  /** The sandbox status for one CLI under `mode`. */
  describe?: (cli: SandboxCli, mode: 'auto' | 'required') => Promise<FileSandboxInfo>
}

/**
 * The kernel file sandbox for the CLI providers' own tools (security.
 * cliSandbox), for every CLI that is installed: active, unavailable (with the
 * reason and the remedy) or not supported (Kimi). A missing sandbox is a
 * warning — with 'auto' the CLI runs without it, with 'required' its turns
 * with tools are refused.
 */
export async function checkCliSandbox(configuredMode: unknown, deps: CliSandboxCheckDeps = {}): Promise<CheckResult> {
  const name = 'CLI sandbox'
  try {
    const { CliSandboxModeSchema } = await import('../../modules/model/cli-runtime/sandbox/types.js')
    const parsed = configuredMode === undefined || configuredMode === null ? { success: true as const, data: 'auto' as const } : CliSandboxModeSchema.safeParse(configuredMode)
    // The runtime reads an unknown value as 'required' (fail closed); so does this report.
    const mode = parsed.success ? parsed.data : 'required'
    const installed = deps.installed ?? (async (cli: SandboxCli) => {
      const { resolveCliExecutable } = await import('../../modules/model/cli-runtime/executables.js')
      return (await resolveCliExecutable(cli)).ok
    })
    const describe = deps.describe ?? (async (cli: SandboxCli, m: 'auto' | 'required') => {
      const { describeFileSandbox } = await import('../../modules/model/cli-runtime/sandbox/index.js')
      return describeFileSandbox(cli, { mode: m, refresh: true })
    })

    const parts: string[] = []
    let warn = false
    for (const cli of Object.keys(SANDBOX_CLI_LABEL) as SandboxCli[]) {
      if (!(await installed(cli))) continue
      const info = await describe(cli, mode)
      const label = SANDBOX_CLI_LABEL[cli]
      if (info.status === 'active') {
        parts.push(`${label}: active (${info.reason})`)
        continue
      }
      if (info.status === 'unsupported') {
        // Nothing to install: the CLI has no kernel sandbox.
        parts.push(`${label}: none — the CLI has no kernel sandbox${mode === 'required' ? '; its turns with tools are refused' : ''}`)
        if (mode === 'required') warn = true
        continue
      }
      warn = true
      const remedy = SANDBOX_REMEDY[info.reason]
      const effect = mode === 'required' ? 'turns with tools are refused' : 'runs without it'
      parts.push(`${label}: unavailable (${info.reason}) — ${effect}${remedy ? `; remedy: ${remedy}` : ''}`)
    }
    if (parts.length === 0) return { name, status: 'ok', message: `mode ${mode}; no CLI provider installed` }
    return { name, status: warn ? 'warn' : 'ok', message: `mode ${mode}; ${parts.join('; ')}` }
  } catch (err: any) {
    return { name, status: 'warn', message: `could not be checked — ${err?.message ?? err}` }
  }
}

/**
 * Where the memory vault is (`<data dir>/vault`, following EYAS_DATA_DIR),
 * and whether notes are still sitting in the legacy `<home>/data/vault` next
 * to a moved data dir: pending (the next start copies them) or diverged (both
 * hold notes, so the legacy folder is not used). Read-only.
 */
export async function checkVaultLocation(
  paths: Pick<import('../../core/instance.js').InstancePaths, 'home' | 'vaultDir'>,
): Promise<CheckResult> {
  const name = 'Vault'
  try {
    const { inspectLegacyVault } = await import('../../modules/memory/vault/legacy-location.js')
    const state = inspectLegacyVault(paths)
    if (state.kind === 'pending') {
      return {
        name,
        status: 'warn',
        message: `${state.vaultDir} has no notes yet; ${state.notes} note(s) in the legacy ${state.legacyDir} will be copied there on the next start (the original stays in place)`,
      }
    }
    if (state.kind === 'diverged') {
      return {
        name,
        status: 'warn',
        message: `${state.legacyDir} (${state.notes} note(s)) is not used — EYAS reads only ${state.vaultDir}, which already has notes. Remedy: copy any note you still need into ${state.vaultDir}, then delete ${state.legacyDir}`,
      }
    }
    return { name, status: 'ok', message: state.vaultDir }
  } catch (err: any) {
    return { name, status: 'warn', message: `could not be checked — ${err?.message ?? err}` }
  }
}

/**
 * skills.importRoots / agent.importRoots are read again on every start. A
 * root inside another tool's own folders (~/.claude, ~/.grok, an Obsidian
 * vault, the EYAS-owned CLI homes, …) or enclosing one is skipped by the
 * server; this reports it before the start does. The same selection the
 * skills and agent modules use (shared/memory-sovereignty/import-roots.ts).
 */
export async function checkImportRoots(
  config: unknown,
  policy?: import('../../shared/memory-sovereignty/path-policy.js').PathPolicy,
): Promise<CheckResult> {
  const name = 'Import roots'
  try {
    const { resolveSkillImportRoots } = await import('../../modules/skills/skill-inventory.js')
    const { resolvePersonaImportRoots } = await import('../../modules/agent/persona-import.js')
    const { selectImportRoots, describeSkippedImportRoot, IMPORT_ROOT_REMEDY } = await import('../../shared/memory-sovereignty/import-roots.js')
    const lists = [
      { key: 'skills.importRoots', roots: resolveSkillImportRoots(config) },
      { key: 'agent.importRoots', roots: resolvePersonaImportRoots(config) },
    ]
    const total = lists.reduce((n, l) => n + l.roots.length, 0)
    if (total === 0) return { name, status: 'ok', message: 'none configured' }
    const problems: string[] = []
    let scanned = 0
    for (const list of lists) {
      const { scan, skipped } = selectImportRoots(list.roots, policy)
      scanned += scan.length
      for (const s of skipped) problems.push(`${list.key}: ${describeSkippedImportRoot(s)}`)
    }
    if (problems.length === 0) return { name, status: 'ok', message: `${scanned} root(s) scanned` }
    return {
      name,
      status: 'warn',
      message: `${problems.join('; ')} — not scanned (another tool's own folders are never a live source); ${IMPORT_ROOT_REMEDY}, then remove the entry from local.yaml`,
    }
  } catch (err: any) {
    return { name, status: 'warn', message: `could not be checked — ${err?.message ?? err}` }
  }
}

export function checkModules(configPath: string): CheckResult {
  try {
    const { loadConfig } = require('../../core/config/loader.js')
    const config = loadConfig(configPath)
    const disabled = config.modules?.disabled ?? []
    if (disabled.length > 0) {
      return { name: 'Modules', status: 'ok', message: `Disabled: ${disabled.join(', ')}` }
    }
    return { name: 'Modules', status: 'ok', message: 'All modules enabled' }
  } catch {
    return { name: 'Modules', status: 'warn', message: 'Could not read module config' }
  }
}

function formatResult(result: CheckResult): string {
  const icon = result.status === 'ok' ? green('✓') : result.status === 'warn' ? yellow('⚠') : red('✗')
  return `  ${icon} ${bold(result.name)}: ${dim(result.message)}`
}

export default defineCommand({
  meta: {
    name: 'doctor',
    description: 'Run system diagnostics',
  },
  args: {
    config: { type: 'string', description: 'Config file path' },
  },
  async run({ args }) {
    console.log(bold('\nEYAS Doctor\n'))

    const { resolveInstance } = await import('../../core/instance.js')
    const { loadResolvedConfig } = await import('../../core/config/loader.js')
    const instance = resolveInstance({ configPath: args.config, ensureDirs: false })

    const results: CheckResult[] = []

    // Synchronous checks
    results.push(checkPlatform())
    results.push(checkConfig(instance.configPath))
    if (instance.localConfigPath) {
      results.push(checkConfig(instance.localConfigPath))
    }

    // Get DB path from resolved config if possible
    let dbPath = instance.databasePath
    let resolvedConfig: ReturnType<typeof loadResolvedConfig> | null = null
    try {
      resolvedConfig = loadResolvedConfig({
        configPath: instance.configPath,
        localConfigPath: instance.localConfigPath,
        instance,
      })
      dbPath = resolvedConfig.database.path
    } catch {
      // Use instance default
    }

    results.push({
      name: 'Instance',
      status: 'ok',
      message: `home=${instance.home} port-env=${process.env.EYAS_PORT ?? '(config)'}`,
    })
    results.push(checkDatabase(dbPath))
    results.push(await checkVaultLocation(instance))
    results.push(checkMasterKey())
    results.push(checkModules(instance.configPath))
    if (resolvedConfig) {
      const { createPathPolicy, pathPolicyOptionsFromInstance } = await import('../../shared/memory-sovereignty/path-policy.js')
      const policy = createPathPolicy(pathPolicyOptionsFromInstance(instance, {
        databasePath: dbPath,
        foreignMemoryPaths: resolvedConfig.security?.foreignMemoryPaths ?? [],
      }))
      results.push(await checkImportRoots(resolvedConfig, policy))
    } else {
      results.push({ name: 'Import roots', status: 'warn', message: 'could not be checked — the configuration did not load' })
    }

    // Async checks
    results.push(await checkOllama())
    results.push(await checkSqliteCapabilities())
    results.push(await checkZstd())
    results.push(await checkMemoryEmbedder())
    results.push(await checkClaudeRuntime())
    results.push(...await checkCliIsolation({ homesDir: instance.cliHomesDir }))
    results.push(await checkCliSandbox(resolvedConfig?.security?.cliSandbox))

    // Output
    for (const r of results) {
      console.log(formatResult(r))
    }

    const failures = results.filter((r) => r.status === 'fail')
    const warnings = results.filter((r) => r.status === 'warn')

    console.log('')
    if (failures.length > 0) {
      console.log(red(`  ${failures.length} issue(s) found.`))
      process.exitCode = 1
    } else if (warnings.length > 0) {
      console.log(yellow(`  ${warnings.length} warning(s), no critical issues.`))
    } else {
      console.log(green('  All checks passed!'))
    }
    console.log('')
  },
})
