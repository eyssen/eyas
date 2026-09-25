// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The Claude Code runtime EYAS drives. One binary, resolved by the
// cli-runtime executable policy (EYAS_CLAUDE_CODE_BIN → `claude` on PATH →
// the cli.js bundled in the Agent SDK as a last resort), is used for the
// sign-in check, availability, onboarding and every query()
// (pathToClaudeCodeExecutable), so what `doctor` and the panel report is what
// actually runs.
//
// Sign-in is read with `<bin> auth status --json`: a local subcommand that
// opens no session, sends no prompt and costs nothing. Its output also names
// the signed-in account; only the fields EYAS acts on survive parsing, so the
// identity never reaches a log or the database.
//
// The live CLI lane (tests/live/cli-isolation.live.test.ts, `bun run
// test:live-cli`) re-proves the isolation on this resolved binary: every
// spawn goes through the resolved path, and the init message reports the
// version the resolver read.

import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { buildClaudeIsolationEnv } from './isolation-options.js'
import {
  agentSdkFacts,
  findShadowedHostCli,
  resolveCliExecutable,
  type ExecutableResolution,
  type ExecutableSource,
  type VersionProbe,
} from '../../cli-runtime/executables.js'

/** The resolved binary one provider instance runs. */
export interface ClaudeRuntime {
  path: string
  version: string | null
  source: ExecutableSource
}

type ResolvedExecutable = Extract<ExecutableResolution, { ok: true }>

export interface ClaudeRuntimeResolveOptions {
  /** Environment the override and PATH are read from (default process.env). */
  env?: NodeJS.ProcessEnv
  probe?: VersionProbe
  /** Ignore the resolver cache (provider reload, doctor). */
  refresh?: boolean
}

/** Resolve the Claude Code binary through the shared executable policy. */
export function resolveClaudeRuntime(opts: ClaudeRuntimeResolveOptions = {}): Promise<ExecutableResolution> {
  return resolveCliExecutable('claude-code', opts)
}

export function toClaudeRuntime(resolution: ResolvedExecutable): ClaudeRuntime {
  return { path: resolution.path, version: resolution.version, source: resolution.source }
}

/**
 * How a runtime path is launched: a JS entry point (the SDK-bundled cli.js)
 * runs through the current JS runtime, anything else is executed directly.
 * The extension list is the one the Agent SDK itself uses to decide.
 */
export function claudeCommand(path: string): { command: string; args: string[] } {
  return ['.js', '.mjs', '.tsx', '.ts', '.jsx'].some((ext) => path.endsWith(ext))
    ? { command: process.execPath, args: [path] }
    : { command: path, args: [] }
}

/**
 * `auth status --json`, parsed tolerantly: unknown and newer fields are
 * dropped (identity fields included), a malformed optional field is ignored,
 * only `loggedIn` is required.
 */
const AuthStatusSchema = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string().optional().catch(undefined),
  apiProvider: z.string().optional().catch(undefined),
})

export interface ClaudeAuthStatus {
  loggedIn: boolean
  /** e.g. 'claude.ai', 'api_key', 'oauth_token', 'third_party'. */
  authMethod?: string
  /** e.g. 'firstParty', 'bedrock', 'vertex'. */
  apiProvider?: string
  /** Why the status could not be read; `loggedIn` is then false. */
  error?: 'spawn' | 'timeout' | 'unparseable'
}

export interface ClaudeCommandResult {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
}

/** Runs one CLI command; rejects only when the process could not be started. */
export type ClaudeCommandRunner = (
  command: string,
  args: readonly string[],
  opts: { env: Record<string, string>; cwd: string; timeoutMs: number },
) => Promise<ClaudeCommandResult>

const AUTH_STATUS_TIMEOUT_MS = 15_000

const defaultRunner: ClaudeCommandRunner = (command, args, { env, cwd, timeoutMs }) =>
  new Promise((resolve, reject) => {
    execFile(command, [...args], { env, cwd, timeout: timeoutMs, encoding: 'utf-8', maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const e = err as (Error & { code?: unknown; killed?: boolean; signal?: string | null }) | null
      // A string code (ENOENT, EACCES) means the process never ran.
      if (e && typeof e.code === 'string') {
        reject(e)
        return
      }
      resolve({
        code: e ? (typeof e.code === 'number' ? e.code : 1) : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        timedOut: Boolean(e?.killed && e.signal),
      })
    })
  })

/** Parse `auth status --json` stdout; null when it is not the expected JSON. */
export function parseClaudeAuthStatus(stdout: string): Omit<ClaudeAuthStatus, 'error'> | null {
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: unknown
  try {
    raw = JSON.parse(stdout.slice(start, end + 1))
  } catch {
    return null
  }
  const parsed = AuthStatusSchema.safeParse(raw)
  if (!parsed.success) return null
  return {
    loggedIn: parsed.data.loggedIn,
    ...(parsed.data.authMethod ? { authMethod: parsed.data.authMethod } : {}),
    ...(parsed.data.apiProvider ? { apiProvider: parsed.data.apiProvider } : {}),
  }
}

interface WarnLogger {
  warn(obj: unknown, msg?: string): void
}

export interface ClaudeAuthCheckOptions {
  runner?: ClaudeCommandRunner
  /** Source environment for the child (default process.env), filtered by the claude-code allowlist. */
  env?: NodeJS.ProcessEnv
  logger?: WarnLogger
}

/**
 * Is the runtime signed in? Runs `<bin> auth status --json` with the
 * isolated claude-code env (buildClaudeIsolationEnv), outside any project
 * folder. Every failure (spawn error, timeout, unparseable output, a non-zero
 * exit) reads as not signed in.
 */
export async function readClaudeAuthStatus(runtime: Pick<ClaudeRuntime, 'path'>, opts: ClaudeAuthCheckOptions = {}): Promise<ClaudeAuthStatus> {
  const { command, args } = claudeCommand(runtime.path)
  // The same allowlisted env and isolation switches every query() gets.
  const env = buildClaudeIsolationEnv(opts.env ?? process.env)
  let out: ClaudeCommandResult
  try {
    out = await (opts.runner ?? defaultRunner)(command, [...args, 'auth', 'status', '--json'], {
      env,
      cwd: tmpdir(),
      timeoutMs: AUTH_STATUS_TIMEOUT_MS,
    })
  } catch (err) {
    opts.logger?.warn({ code: (err as { code?: unknown })?.code ?? null }, 'claude-code: `auth status` could not be started')
    return { loggedIn: false, error: 'spawn' }
  }
  if (out.timedOut) {
    opts.logger?.warn({ timeoutMs: AUTH_STATUS_TIMEOUT_MS }, 'claude-code: `auth status` timed out')
    return { loggedIn: false, error: 'timeout' }
  }
  const parsed = parseClaudeAuthStatus(out.stdout)
  if (!parsed) {
    opts.logger?.warn({ exitCode: out.code }, 'claude-code: `auth status` printed no readable status')
    return { loggedIn: false, error: 'unparseable' }
  }
  // The CLI exits 1 when signed out; a disagreement fails closed.
  return { ...parsed, loggedIn: parsed.loggedIn && out.code === 0 }
}

export interface ClaudeUsableOptions extends ClaudeAuthCheckOptions {
  probe?: VersionProbe
  refresh?: boolean
}

/**
 * Availability: the runtime resolves AND it is signed in. A `claude` merely
 * being on PATH is not enough.
 */
export async function isClaudeRuntimeUsable(opts: ClaudeUsableOptions = {}): Promise<boolean> {
  const runtime = await resolveClaudeRuntime({ env: opts.env, probe: opts.probe, refresh: opts.refresh })
  if (!runtime.ok) return false
  return (await readClaudeAuthStatus(runtime, opts)).loggedIn
}

/** What `doctor` and the provider panel report about the Claude Code runtime. */
export interface ClaudeRuntimeInfo {
  ok: boolean
  source: ExecutableSource | null
  path: string | null
  version: string | null
  /** The Claude Code version the pinned Agent SDK was built against. */
  expectedVersion: string | null
  /** The resolved binary reports a version other than expectedVersion. */
  skew: boolean
  /** Doctor-level warnings from the resolver (last resort, skew). */
  warnings: string[]
  error?: 'no-policy' | 'override-invalid' | 'not-found'
  detail?: string
  remedy?: string
  /** Null when not checked (no usable runtime, or checkAuth false). */
  signedIn: boolean | null
  authMethod?: string
  /** A `claude` on PATH that EYAS does not run because the override wins. */
  hostCli: { path: string; version: string | null } | null
}

export interface ClaudeRuntimeInfoOptions extends ClaudeUsableOptions {
  /** Also read the sign-in status (default true). */
  checkAuth?: boolean
}

export async function getClaudeRuntimeInfo(opts: ClaudeRuntimeInfoOptions = {}): Promise<ClaudeRuntimeInfo> {
  const env = opts.env ?? process.env
  const r = await resolveClaudeRuntime({ env, probe: opts.probe, refresh: opts.refresh })
  if (!r.ok) {
    return {
      ok: false,
      source: null,
      path: null,
      version: null,
      expectedVersion: agentSdkFacts()?.claudeCodeVersion ?? null,
      skew: false,
      warnings: [],
      error: r.error,
      detail: r.detail,
      ...(r.remedy ? { remedy: r.remedy } : {}),
      signedIn: null,
      hostCli: null,
    }
  }

  const hostCli = await findShadowedHostCli(r, { env, probe: opts.probe, refresh: opts.refresh })

  let signedIn: boolean | null = null
  let authMethod: string | undefined
  if (opts.checkAuth !== false) {
    const auth = await readClaudeAuthStatus(r, { ...opts, env })
    signedIn = auth.loggedIn
    authMethod = auth.authMethod
  }

  return {
    ok: true,
    source: r.source,
    path: r.path,
    version: r.version,
    expectedVersion: r.expectedVersion,
    skew: Boolean(r.expectedVersion && r.version && r.version !== r.expectedVersion),
    warnings: [...r.warnings],
    signedIn,
    ...(authMethod ? { authMethod } : {}),
    hostCli,
  }
}
