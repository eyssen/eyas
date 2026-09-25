// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Which binary a CLI provider runs. One policy row per provider, one
// resolver for every caller — availability, sign-in, discovery and every
// turn — so what the panel shows and what actually runs cannot drift apart.
//
// Sources, in order:
//   override     — the provider's EYAS_*_BIN variable: an absolute path to an
//                  executable file. Set but invalid fails closed; it never
//                  falls back to another source, because silently running a
//                  different binary than the operator named is worse than
//                  running none. Deliberately an environment variable, not a
//                  UI setting: a web-settable executable path is a
//                  remote-execution surface.
//   host         — the first of the row's names found on PATH.
//   sdk-bundled  — last resort, an entry point shipped inside a dependency
//                  (only a row that sets `bundled`); `doctor` warns when it
//                  is chosen.
//
// A row that is driven by a client library built against one CLI version
// (`expectedVersion`) gets a skew warning when the resolved binary reports a
// different one.

import { execFile } from 'node:child_process'
import { accessSync, constants, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { buildCliEnv, type CliEnvProfile } from './env.js'

export type ExecutableSource = 'override' | 'host' | 'sdk-bundled'

export interface ExecutablePolicy {
  /** Provider id; also the env profile the version probe runs with. */
  id: CliEnvProfile
  /** Environment variable naming the executable (absolute path). */
  overrideEnv?: string
  /** Names looked up on PATH, in order. Empty: PATH is never consulted. */
  hostNames: readonly string[]
  /**
   * Last-resort entry point shipped with a dependency (e.g. the Agent SDK's
   * cli.js, launched through the JS runtime, so it need not be executable);
   * null when it is absent.
   */
  bundled?: () => string | null
  /** Version of the bundled entry point, read without running it. */
  bundledVersion?: () => string | null
  /**
   * CLI version the client library that drives this binary was built
   * against (the Agent SDK's claudeCodeVersion). A resolved binary reporting
   * another version gets a skew warning; null or absent: no check.
   */
  expectedVersion?: () => string | null
  /** Arguments that print the version without opening a session. */
  versionArgs?: readonly string[]
  /** What to tell the operator when nothing resolves. */
  remedy: string
}

export type ExecutableResolution =
  | {
      ok: true
      id: CliEnvProfile
      path: string
      /** Parsed from `<path> --version`; null when the probe failed. */
      version: string | null
      source: ExecutableSource
      /** The row's expectedVersion (null when the row has none). */
      expectedVersion: string | null
      /** Doctor-level warnings (the SDK-bundled last resort, version skew). */
      warnings: string[]
    }
  | {
      ok: false
      id: CliEnvProfile
      error: 'no-policy' | 'override-invalid' | 'not-found'
      detail: string
      remedy?: string
    }

const AgentSdkPackageSchema = z.object({
  version: z.string().optional().catch(undefined),
  claudeCodeVersion: z.string().optional().catch(undefined),
})

/** What the installed Agent SDK package says about itself. */
export interface AgentSdkFacts {
  /** The Claude Code entry point bundled in the SDK (launched through the JS runtime). */
  cliPath: string
  /** The SDK package version. */
  sdkVersion: string | null
  /** The Claude Code version the SDK was built against (package.json claudeCodeVersion). */
  claudeCodeVersion: string | null
}

let agentSdkFactsMemo: AgentSdkFacts | null | undefined

/**
 * Locate the installed @anthropic-ai/claude-agent-sdk and read its
 * package.json, without running anything. Resolved from this module, not by
 * the SDK itself: its default lookup is `dirname(import.meta.url)/cli.js`,
 * which inside the `bun build` bundle points into dist/, where no cli.js
 * exists. Null when the package cannot be found or read.
 */
export function agentSdkFacts(): AgentSdkFacts | null {
  if (agentSdkFactsMemo !== undefined) return agentSdkFactsMemo
  try {
    // The package exports no './package.json', so resolve the main entry
    // and read the manifest next to it.
    const dir = dirname(createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk'))
    const parsed = AgentSdkPackageSchema.safeParse(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')))
    agentSdkFactsMemo = {
      cliPath: join(dir, 'cli.js'),
      sdkVersion: parsed.success ? parsed.data.version ?? null : null,
      claudeCodeVersion: parsed.success ? parsed.data.claudeCodeVersion ?? null : null,
    }
  } catch {
    agentSdkFactsMemo = null
  }
  return agentSdkFactsMemo
}

/**
 * The policy table. Every CLI runs the operator-installed binary.
 *
 * Claude Code: EYAS_CLAUDE_CODE_BIN → `claude` on PATH → the cli.js bundled
 * in the Agent SDK as a last resort. The SDK client stays pinned, so a host
 * CLI of another version is used as is and flagged as version skew (the
 * SDK's claudeCodeVersion is the expected version).
 */
const POLICIES = new Map<CliEnvProfile, ExecutablePolicy>([
  ['claude-code', {
    id: 'claude-code',
    overrideEnv: 'EYAS_CLAUDE_CODE_BIN',
    hostNames: ['claude'],
    bundled: () => agentSdkFacts()?.cliPath ?? null,
    bundledVersion: () => agentSdkFacts()?.claudeCodeVersion ?? null,
    expectedVersion: () => agentSdkFacts()?.claudeCodeVersion ?? null,
    remedy: 'Install Claude Code (the claude CLI), or set EYAS_CLAUDE_CODE_BIN to the absolute path of the claude executable.',
  }],
  ['grok-cli', {
    id: 'grok-cli',
    overrideEnv: 'EYAS_GROK_BIN',
    hostNames: ['grok'],
    remedy: 'Install the Grok CLI, or set EYAS_GROK_BIN to the absolute path of the grok executable.',
  }],
  ['kimi-cli', {
    id: 'kimi-cli',
    overrideEnv: 'EYAS_KIMI_BIN',
    hostNames: ['kimi'],
    remedy: 'Install the Kimi Code CLI, or set EYAS_KIMI_BIN to the absolute path of the kimi executable.',
  }],
  ['opencode', {
    id: 'opencode',
    overrideEnv: 'EYAS_OPENCODE_BIN',
    hostNames: ['opencode'],
    remedy: 'Install OpenCode, or set EYAS_OPENCODE_BIN to the absolute path of the opencode executable.',
  }],
])

/** Add or replace a provider's row (tests). */
export function registerExecutablePolicy(policy: ExecutablePolicy): void {
  POLICIES.set(policy.id, { ...policy })
  clearExecutableCache(policy.id)
}

export function getExecutablePolicy(id: CliEnvProfile): ExecutablePolicy | undefined {
  return POLICIES.get(id)
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function isExecutableFile(path: string): boolean {
  if (!isFile(path)) return false
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The override must be an absolute path to an executable file. */
export const ExecutableOverrideSchema = z
  .string()
  .trim()
  .min(1)
  .refine((p) => isAbsolute(p), { message: 'must be an absolute path' })
  .refine((p) => isExecutableFile(p), { message: 'must be an existing executable file' })

/** First `name` on PATH that is an executable file (PATHEXT on Windows). */
export function findOnPath(names: readonly string[], env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string | null {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter((d) => d && isAbsolute(d))
  const exts = platform === 'win32'
    ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)]
    : ['']
  for (const name of names) {
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = join(dir, name + ext)
        if (isExecutableFile(candidate)) return candidate
      }
    }
  }
  return null
}

export interface VersionProbeResult {
  code: number
  stdout: string
  stderr: string
}

export type VersionProbe = (path: string, args: readonly string[], env: Record<string, string>) => Promise<VersionProbeResult>

const VERSION_TIMEOUT_MS = 10_000

/** Run `<path> --version` with the allowlisted env, outside any project dir. */
const defaultVersionProbe: VersionProbe = (path, args, env) =>
  new Promise((resolveProbe) => {
    execFile(path, [...args], { env, cwd: tmpdir(), timeout: VERSION_TIMEOUT_MS, encoding: 'utf-8' }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0
      resolveProbe({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })
    })
  })

const VERSION_RE = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/

export function parseVersion(output: string): string | null {
  return VERSION_RE.exec(output)?.[1] ?? null
}

export interface ResolveExecutableOptions {
  /** Environment the override and PATH are read from (default process.env). */
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  probe?: VersionProbe
  /** Ignore the cache. */
  refresh?: boolean
}

const cache = new Map<string, Promise<ExecutableResolution>>()

export function clearExecutableCache(id?: CliEnvProfile): void {
  if (!id) {
    cache.clear()
    return
  }
  for (const key of cache.keys()) if (key.startsWith(`${id}\0`)) cache.delete(key)
}

async function withVersion(
  policy: ExecutablePolicy,
  path: string,
  source: ExecutableSource,
  probe: VersionProbe,
  env: NodeJS.ProcessEnv,
): Promise<ExecutableResolution> {
  const warnings: string[] = []
  const expectedVersion = policy.expectedVersion?.() ?? null
  if (source === 'sdk-bundled') {
    warnings.push(`${policy.id}: running the SDK-bundled binary as a last resort. ${policy.remedy}`)
    return { ok: true, id: policy.id, path, version: policy.bundledVersion?.() ?? null, source, expectedVersion, warnings }
  }
  let version: string | null = null
  try {
    const out = await probe(path, policy.versionArgs ?? ['--version'], buildCliEnv(policy.id, { source: env }))
    version = out.code === 0 ? parseVersion(`${out.stdout}\n${out.stderr}`) : null
  } catch {
    version = null
  }
  if (expectedVersion && version && version !== expectedVersion) {
    warnings.push(`${policy.id}: version skew — the binary reports ${version}, but the SDK that drives it was built for ${expectedVersion}.`)
  }
  return { ok: true, id: policy.id, path, version, source, expectedVersion, warnings }
}

async function resolveUncached(policy: ExecutablePolicy, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, probe: VersionProbe): Promise<ExecutableResolution> {
  const raw = policy.overrideEnv ? env[policy.overrideEnv] : undefined
  if (raw !== undefined && raw.trim() !== '') {
    const parsed = ExecutableOverrideSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        ok: false,
        id: policy.id,
        error: 'override-invalid',
        detail: `${policy.overrideEnv} ${parsed.error.issues[0]?.message ?? 'is invalid'}: ${raw}`,
        remedy: `Point ${policy.overrideEnv} at an absolute path to the executable, or unset it.`,
      }
    }
    return withVersion(policy, parsed.data, 'override', probe, env)
  }

  const onPath = policy.hostNames.length ? findOnPath(policy.hostNames, env, platform) : null
  if (onPath) return withVersion(policy, onPath, 'host', probe, env)

  const bundled = policy.bundled?.() ?? null
  if (bundled && isFile(bundled)) return withVersion(policy, bundled, 'sdk-bundled', probe, env)

  return {
    ok: false,
    id: policy.id,
    error: 'not-found',
    detail: `${policy.id}: no executable found${policy.hostNames.length ? ` (looked for ${policy.hostNames.join(', ')} on PATH)` : ''}`,
    remedy: policy.remedy,
  }
}

/**
 * Resolve a provider's executable: {path, version, source}. A found binary is
 * cached per provider, override value and PATH, so the version probe runs
 * once per configuration; `refresh` forces a new resolution.
 */
export function resolveCliExecutable(id: CliEnvProfile, opts: ResolveExecutableOptions = {}): Promise<ExecutableResolution> {
  const policy = POLICIES.get(id)
  if (!policy) {
    return Promise.resolve({ ok: false, id, error: 'no-policy', detail: `no executable policy registered for ${id}` })
  }
  const env = opts.env ?? process.env
  const key = [id, policy.overrideEnv ? env[policy.overrideEnv] ?? '' : '', env.PATH ?? env.Path ?? ''].join('\0')
  if (!opts.refresh) {
    const hit = cache.get(key)
    if (hit) return hit
  }
  const pending = resolveUncached(policy, env, opts.platform ?? process.platform, opts.probe ?? defaultVersionProbe)
  cache.set(key, pending)
  // Only a found binary is remembered: a CLI installed after boot must be
  // picked up by the next resolve, and a miss costs no version probe.
  void pending.then((r) => {
    if (!r.ok && cache.get(key) === pending) cache.delete(key)
  })
  return pending
}

/** A CLI on PATH that EYAS does not run. */
export interface ShadowedHostCli {
  path: string
  version: string | null
}

/**
 * The host CLI an override shadows: what PATH would give if the override
 * variable were unset, when that is another file than the one EYAS runs.
 * Null for any other source (a host binary is the one EYAS runs; the
 * SDK-bundled last resort means PATH has none).
 */
export async function findShadowedHostCli(resolution: ExecutableResolution, opts: ResolveExecutableOptions = {}): Promise<ShadowedHostCli | null> {
  if (!resolution.ok || resolution.source !== 'override') return null
  const overrideEnv = POLICIES.get(resolution.id)?.overrideEnv
  if (!overrideEnv) return null
  const withoutOverride: NodeJS.ProcessEnv = { ...(opts.env ?? process.env) }
  delete withoutOverride[overrideEnv]
  const host = await resolveCliExecutable(resolution.id, { ...opts, env: withoutOverride })
  return host.ok && host.source === 'host' && host.path !== resolution.path ? { path: host.path, version: host.version } : null
}
