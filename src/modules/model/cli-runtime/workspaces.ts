// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Where a CLI model works. One resolver, resolveCliCwd, for every CLI spawn
// (Claude Code, Grok, Kimi, OpenCode): the first valid folder the request
// carries, else the conversation's own EYAS workspace, else a per-run scratch
// folder. It never falls back to process.cwd(), the install root or the data
// dir — a CLI treats its cwd as the project it may read without asking, and
// the EYAS home holds master.key, the vault and the database.
//
// Every EYAS-created folder sits under the workspaces root, which is chosen so
// that no git work tree encloses it (core/instance.ts resolveWorkspacesDir):
// a CLI started inside a checkout adopts that repository's instructions,
// permission rules and memory scope.

import { mkdirSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { hasGitAncestor, resolveInstance } from '@core/instance.js'
import {
  createPathPolicy,
  getPathPolicy,
  pathPolicyOptionsFromInstance,
  type PathPolicy,
} from '@shared/memory-sovereignty/path-policy.js'
import {
  parseWorkingDirectories,
  validateWorkingDirectories,
  type FolderErrorCode,
} from '@modules/tools/working-directories.js'
import type { ModelRequest } from '../types.js'

export { hasGitAncestor }

/** Sub-folder of the workspaces root holding per-run scratch folders. */
export const RUN_SCRATCH_DIR = '_runs'

/**
 * How long an untouched run scratch folder survives. Generous on purpose: a
 * run parked for an approval can sit for days, and its scratch holds whatever
 * it wrote so far. Every resolve touches the folder, so a live run never ages.
 */
export const RUN_SCRATCH_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** How often the background sweeper runs. */
export const RUN_SCRATCH_SWEEP_INTERVAL_MS = 60 * 60 * 1000

/**
 * A conversation or run id used as a folder name. One path segment, no dot
 * or underscore lead, so it can never be `..`, a hidden folder or `_runs`.
 */
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export function isSafeWorkspaceSegment(id: unknown): id is string {
  return typeof id === 'string' && SEGMENT_RE.test(id)
}

interface Logger {
  warn: (obj: unknown, msg?: string) => void
  info?: (obj: unknown, msg?: string) => void
  debug?: (obj: unknown, msg?: string) => void
}

/** Root of every EYAS-created workspace (InstancePaths.workspacesDir). */
export function resolveWorkspacesRoot(): string {
  return resolveInstance({ ensureDirs: false }).workspacesDir
}

function rootOf(opts?: { root?: string }): string {
  return opts?.root ?? resolveWorkspacesRoot()
}

/**
 * The conversation's own folder. Created on first use; idempotent.
 *
 * Without it the agent picks somewhere itself — observed output went to /tmp
 * and to the Desktop in the same session — and the output collector has
 * nowhere definite to look.
 */
export function ensureConversationWorkspace(conversationId: string, opts?: { root?: string }): string {
  if (!isSafeWorkspaceSegment(conversationId)) {
    throw new Error(`invalid conversation id for a workspace: ${JSON.stringify(conversationId)}`)
  }
  const dir = join(rootOf(opts), conversationId)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Private scratch folder of one run: `<root>/_runs/<runId>`. Created on
 * first use and touched on every call, so the TTL sweeper only ever removes
 * folders of runs that stopped asking for them.
 */
export function runScratchCwd(runId: string, opts?: { root?: string; now?: number }): string {
  if (!isSafeWorkspaceSegment(runId)) {
    throw new Error(`invalid run id for a scratch folder: ${JSON.stringify(runId)}`)
  }
  const dir = join(rootOf(opts), RUN_SCRATCH_DIR, runId)
  mkdirSync(dir, { recursive: true })
  const at = (opts?.now ?? Date.now()) / 1000
  try {
    utimesSync(dir, at, at)
  } catch {
    // A folder we just created but cannot touch still works as a cwd.
  }
  return dir
}

/**
 * Name prefix of a CLI query's private temp folder (cliQueryTmp). It lives in
 * the run scratch area, so it is its own workspace unit: the memory-path
 * policy and the kernel sandbox keep every other query's temp folder out.
 */
export const CLI_QUERY_TMP_PREFIX = 'clitmp-'

/** When this process started: a temp folder older than that belongs to no live query. */
const PROCESS_STARTED_AT_MS = Date.now() - Math.round(process.uptime() * 1000)

export interface CliQueryTmp {
  /** `<root>/_runs/clitmp-<id>`, absolute. Not on disk until create(). */
  readonly dir: string
  /** Create the folder (0700). Idempotent. */
  create(): string
  /** Remove the folder and everything the CLI left in it. Idempotent; never throws. */
  release(): void
}

/**
 * The private temp folder of one CLI query (Claude Code's CLAUDE_CODE_TMPDIR:
 * its per-session `tasks/` folder, which holds background command output).
 * The path is fixed at once so it can go into the query's folders and
 * sandbox rules; the caller creates it right before the CLI starts and
 * releases it when the query ends. A folder a crash left behind is removed
 * by the next sweepRunScratch of a later process.
 */
export function cliQueryTmp(opts?: { root?: string }): CliQueryTmp {
  const dir = join(rootOf(opts), RUN_SCRATCH_DIR, `${CLI_QUERY_TMP_PREFIX}${randomUUID().replace(/-/g, '')}`)
  return {
    dir,
    create() {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      return dir
    },
    release() {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // Already gone, or unreadable: the next sweep retries.
      }
    },
  }
}

/**
 * Remove run scratch folders untouched for longer than `ttlMs`, and every CLI
 * query temp folder (cliQueryTmp) made before this process started — no query
 * of this process uses it, and it may hold a crashed query's command output.
 * Returns the removed paths. Never throws: an unreadable root or a folder that
 * vanished mid-sweep is simply skipped.
 */
export function sweepRunScratch(opts?: { root?: string; ttlMs?: number; now?: number; processStartedAt?: number }): string[] {
  const base = join(rootOf(opts), RUN_SCRATCH_DIR)
  const cutoff = (opts?.now ?? Date.now()) - (opts?.ttlMs ?? RUN_SCRATCH_TTL_MS)
  const tmpCutoff = Math.max(cutoff, opts?.processStartedAt ?? PROCESS_STARTED_AT_MS)
  const removed: string[] = []
  let names: string[]
  try {
    names = readdirSync(base)
  } catch {
    return removed
  }
  for (const name of names) {
    if (!isSafeWorkspaceSegment(name)) continue
    const dir = join(base, name)
    try {
      const info = statSync(dir)
      const stale = name.startsWith(CLI_QUERY_TMP_PREFIX) ? tmpCutoff : cutoff
      if (!info.isDirectory() || info.mtimeMs >= stale) continue
      rmSync(dir, { recursive: true, force: true })
      removed.push(dir)
    } catch {
      // Vanished or unreadable — nothing to sweep.
    }
  }
  return removed
}

/**
 * Sweep once now, then every `intervalMs`. The timer never keeps the process
 * alive. Returns the stop function.
 */
export function startRunScratchSweeper(opts?: { logger?: Logger; intervalMs?: number; ttlMs?: number; root?: string }): () => void {
  const sweep = (): void => {
    try {
      const removed = sweepRunScratch({ root: opts?.root, ttlMs: opts?.ttlMs })
      if (removed.length) opts?.logger?.info?.({ count: removed.length }, 'cli-runtime: stale run scratch folders removed')
    } catch (err) {
      opts?.logger?.warn({ err: String(err) }, 'cli-runtime: run scratch sweep failed')
    }
  }
  sweep()
  const timer = setInterval(sweep, opts?.intervalMs ?? RUN_SCRATCH_SWEEP_INTERVAL_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

/**
 * Result of validating one stored folder before it becomes a CLI cwd. The
 * default check's code is a FolderErrorCode; an injected check may use its own.
 */
export type CliFolderCheck = { ok: true; path: string } | { ok: false; code: FolderErrorCode | (string & {}) }

const LAYOUT_POLICY_CACHE_MAX = 8
const layoutPolicies = new Map<string, PathPolicy>()

/**
 * The path policy that judges folders for a data dir + workspaces root: the
 * process-wide one for the instance's own layout (production — it also knows
 * database.path and security.foreignMemoryPaths), else one built for that
 * layout the same way (a caller that places workspaces elsewhere).
 */
function folderPolicyFor(ctx: { dataDir: string; root: string }): PathPolicy {
  const dataDir = resolve(ctx.dataDir)
  const root = resolve(ctx.root)
  const instance = resolveInstance({ ensureDirs: false })
  if (dataDir === resolve(instance.dataDir) && root === resolve(instance.workspacesDir)) return getPathPolicy()
  const key = `${dataDir}\0${root}`
  let policy = layoutPolicies.get(key)
  if (!policy) {
    policy = createPathPolicy(pathPolicyOptionsFromInstance({
      dataDir,
      workspacesDir: root,
      databasePath: join(dataDir, 'sqlite', 'eyas.db'),
      cliHomesDir: join(dataDir, 'cli-homes'),
    }))
    while (layoutPolicies.size >= LAYOUT_POLICY_CACHE_MAX) {
      const oldest = layoutPolicies.keys().next().value
      if (oldest === undefined) break
      layoutPolicies.delete(oldest)
    }
    layoutPolicies.set(key, policy)
  }
  return policy
}

/**
 * The folder check a stored folder passes before it becomes a CLI cwd: the
 * same validateWorkingDirectories a folder save passes (home, providerHome,
 * vault, eyasData, sensitive, containsEyasData / containsProviderHome /
 * containsVault, notAbsolute, notFound, notDirectory), judged against this
 * layout. A folder saved before a rule existed — or one a vault was created
 * in since — is caught here: the CLI would read inside it without asking.
 */
export function defaultCliFolderCheck(path: string, ctx: { dataDir: string; root: string }): CliFolderCheck {
  const verdict = validateWorkingDirectories([path], { policy: folderPolicyFor(ctx) })
  if (!verdict.ok) return { ok: false, code: verdict.code }
  const real = verdict.paths[0]
  if (!real) return { ok: false, code: 'notAbsolute' }
  return { ok: true, path: real }
}

export interface ResolveCliCwdOptions {
  /** Workspaces root (default InstancePaths.workspacesDir). */
  root?: string
  /** EYAS data dir (default InstancePaths.dataDir). */
  dataDir?: string
  /** Folder validator (default defaultCliFolderCheck). */
  checkFolder?: (path: string, ctx: { dataDir: string; root: string }) => CliFolderCheck
  logger?: Logger
}

/** The request fields the resolver reads. */
export type CliCwdRequest = Pick<ModelRequest, 'metadata'>

/**
 * The single CLI cwd resolver. Order:
 *   1. the first stored folder (metadata.workingDirectories, else
 *      metadata.workingDirectory) that still passes the folder check — a
 *      refused one is skipped with a warning, never used;
 *   2. the conversation's own workspace (metadata.conversationId);
 *   3. the run's scratch folder (metadata.runId), or a fresh one-off scratch
 *      folder when the request names no run.
 * Never process.cwd(), the install root or the data dir.
 */
export function resolveCliCwd(request: CliCwdRequest, opts: ResolveCliCwdOptions = {}): string {
  const instance = opts.root && opts.dataDir ? null : resolveInstance({ ensureDirs: false })
  const root = opts.root ?? instance!.workspacesDir
  const dataDir = opts.dataDir ?? instance!.dataDir
  const check = opts.checkFolder ?? defaultCliFolderCheck
  const meta = (request.metadata ?? {}) as NonNullable<ModelRequest['metadata']>

  const stored = parseWorkingDirectories(meta.workingDirectories)
  const folders = stored.length > 0 ? stored : meta.workingDirectory ? [meta.workingDirectory] : []
  for (const folder of folders) {
    const verdict = check(folder, { dataDir, root })
    if (verdict.ok) return verdict.path
    opts.logger?.warn({ folder, code: verdict.code }, 'cli-runtime: stored folder refused as CLI working directory — skipped')
  }

  if (isSafeWorkspaceSegment(meta.conversationId)) {
    return ensureConversationWorkspace(meta.conversationId, { root })
  }
  if (isSafeWorkspaceSegment(meta.runId)) {
    return runScratchCwd(meta.runId, { root })
  }
  return runScratchCwd(`adhoc-${randomUUID()}`, { root })
}

/**
 * The folders a CLI turn works in, for every CLI provider: each stored
 * conversation folder that still passes the folder check resolveCliCwd
 * applies, plus the turn's cwd itself (once). Built server-side from the
 * request and the resolved cwd — never from anything the CLI reports — so the
 * memory-path policy's "another conversation's workspace" rule and the ACP fs
 * jail judge against what EYAS started the turn in.
 */
export function resolveCliRoots(
  request: CliCwdRequest,
  cwd: string,
  opts: Pick<ResolveCliCwdOptions, 'dataDir' | 'root' | 'checkFolder'> = {},
): string[] {
  const meta = (request.metadata ?? {}) as { workingDirectories?: unknown; workingDirectory?: unknown }
  const stored = parseWorkingDirectories(meta.workingDirectories)
  const folders = stored.length > 0 ? stored : typeof meta.workingDirectory === 'string' && meta.workingDirectory ? [meta.workingDirectory] : []
  const roots: string[] = []
  if (folders.length > 0) {
    const instance = opts.dataDir && opts.root ? null : resolveInstance({ ensureDirs: false })
    const ctx = { dataDir: opts.dataDir ?? instance!.dataDir, root: opts.root ?? instance!.workspacesDir }
    const check = opts.checkFolder ?? defaultCliFolderCheck
    for (const folder of folders) {
      const verdict = check(folder, ctx)
      if (verdict.ok) roots.push(verdict.path)
    }
  }
  roots.push(cwd)
  const seen = new Set<string>()
  return roots.filter((r) => {
    const key = resolve(r)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
