// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Kernel file sandbox for the CLI providers' own tools (B5): whether one is
// available for a CLI on this host, what security.cliSandbox asks for, and
// the one decision every CLI turn with tools takes from the two:
//
//   available            → run sandboxed (Grok: a custom profile in its EYAS
//                          home; Claude Code: sandbox.filesystem per query)
//   none, mode 'auto'    → run without it, and say so once per conversation
//                          (notice cliSandboxUnavailable); EYAS still checks
//                          every tool call it sees
//   none, mode 'required'→ refuse the turn (CliSandboxUnavailableError, kind
//                          'isolation': never retried, never failed over)
//
// A turn without tools (an isolated completion) needs no sandbox and is never
// refused for lack of one. Detection is PATH lookups plus, on Linux, one short
// bubblewrap probe run, cached for a minute; the per-OS work lives in the
// strategies (darwin-seatbelt.ts, linux-bubblewrap.ts), not here.

import { execFile } from 'node:child_process'
import { accessSync, constants as fsConstants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path'
import { CodedModelError } from '@shared/classify-model-error.js'
import { realpathBestEffort } from '@shared/fs-realpath.js'
import type { PathPolicy } from '@shared/memory-sovereignty/path-policy.js'
import type { StreamEvent } from '../../types.js'
import { darwinSeatbeltStrategy } from './darwin-seatbelt.js'
import { linuxBubblewrapStrategy } from './linux-bubblewrap.js'
import {
  CliSandboxModeSchema,
  type CliSandboxMode,
  type FileSandboxInfo,
  type KernelSandboxAvailability,
  type KernelSandboxReason,
  type KernelSandboxStrategy,
  type SandboxCli,
  type SandboxHostDeps,
} from './types.js'

export * from './types.js'

/** One strategy per operating system; a platform without one has no sandbox. */
const STRATEGIES: readonly KernelSandboxStrategy[] = [darwinSeatbeltStrategy, linuxBubblewrapStrategy]

/** How long a detection result stands (an operator may install bubblewrap meanwhile). */
export const SANDBOX_DETECTION_TTL_MS = 60_000
const PROBE_TIMEOUT_MS = 5_000

// ─── Host ──────────────────────────────────────

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

/** First executable `name` on `pathVar` (PATH). Never a shell, never a relative entry. */
export function whichOnPath(name: string, pathVar: string | undefined = process.env.PATH): string | null {
  for (const dir of (pathVar ?? '').split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue
    const candidate = join(dir, name)
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

function probeRun(bin: string, args: readonly string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      execFile(bin, [...args], { timeout: PROBE_TIMEOUT_MS, env: { PATH: process.env.PATH ?? '' } }, (err) => resolve(!err))
    } catch {
      resolve(false)
    }
  })
}

function defaultHost(): SandboxHostDeps {
  return { platform: process.platform, which: (name) => whichOnPath(name), probe: probeRun }
}

// ─── Detection ─────────────────────────────────

const cache = new Map<string, { at: number; result: Promise<KernelSandboxAvailability> }>()

export interface DetectKernelSandboxOptions {
  /** Host facts (tests); any field left out comes from this process. Never cached. */
  host?: Partial<SandboxHostDeps>
  /** Ignore a cached result. */
  refresh?: boolean
  now?: () => number
}

async function detectUncached(cli: SandboxCli, host: SandboxHostDeps): Promise<KernelSandboxAvailability> {
  if (cli === 'kimi-cli') return { available: false, reason: 'cli-has-none' }
  const strategy = STRATEGIES.find((s) => s.platform === host.platform)
  if (!strategy) return { available: false, reason: 'unsupported-platform' }
  try {
    return await strategy.detect(cli, host)
  } catch {
    // A strategy that cannot tell is no sandbox — never assumed present.
    return { available: false, reason: strategy.failureReason }
  }
}

/** Tests only: host facts that replace this process's when a caller passes none. */
let hostOverride: Partial<SandboxHostDeps> | null = null

/**
 * Tests only: pin the host detection sees when a caller passes none, so a
 * test run does not depend on the machine it runs on (the vitest setup pins
 * one); null restores this process's own host.
 */
export function setDefaultSandboxHostForTests(host: Partial<SandboxHostDeps> | null): void {
  hostOverride = host
  cache.clear()
}

/**
 * Whether the kernel file sandbox is available for `cli` on this host, and
 * why not. Kimi has none ('cli-has-none'); macOS always has Seatbelt; Linux
 * needs a working bubblewrap (plus socat for Claude Code).
 */
export function detectKernelSandbox(cli: SandboxCli, opts: DetectKernelSandboxOptions = {}): Promise<KernelSandboxAvailability> {
  if (opts.host || hostOverride) return detectUncached(cli, { ...defaultHost(), ...hostOverride, ...opts.host })
  const now = (opts.now ?? Date.now)()
  const key = `${cli}\0${process.platform}`
  const hit = cache.get(key)
  if (!opts.refresh && hit && now - hit.at < SANDBOX_DETECTION_TTL_MS) return hit.result
  const result = detectUncached(cli, defaultHost())
  cache.set(key, { at: now, result })
  return result
}

/** Forget cached detections (tests, provider reload). */
export function clearKernelSandboxCache(): void {
  cache.clear()
}

// ─── Mode (security.cliSandbox) ────────────────

let modeSource: () => unknown = () => undefined

/**
 * Where the configured mode is read from, on every call (the model module
 * points it at ctx.config.security.cliSandbox at register).
 */
export function configureCliSandbox(opts: { mode: () => unknown }): void {
  modeSource = opts.mode
}

/**
 * The configured mode. Unset → 'auto' (the documented default); a value that
 * is set but not a known mode fails closed to 'required'. The config schema
 * already refuses such a value at load (EYAS does not start), so this is only
 * the backstop for a mode source that bypasses it.
 */
export function getCliSandboxMode(): CliSandboxMode {
  let raw: unknown
  try {
    raw = modeSource()
  } catch {
    raw = undefined
  }
  if (raw === undefined || raw === null) return 'auto'
  const parsed = CliSandboxModeSchema.safeParse(raw)
  return parsed.success ? parsed.data : 'required'
}

/** What the provider panel and doctor show for one CLI. */
export async function describeFileSandbox(
  cli: SandboxCli,
  opts: DetectKernelSandboxOptions & { mode?: CliSandboxMode } = {},
): Promise<FileSandboxInfo> {
  const mode = opts.mode ?? getCliSandboxMode()
  const availability = await detectKernelSandbox(cli, opts)
  if (availability.available) return { status: 'active', reason: availability.reason, mode }
  return { status: availability.reason === 'cli-has-none' ? 'unsupported' : 'unavailable', reason: availability.reason, mode }
}

// ─── The per-turn decision ─────────────────────

/**
 * A turn with tools was refused: security.cliSandbox is 'required' and no
 * kernel sandbox is available for this CLI here. Kind 'isolation' — a retry
 * or a failover would meet the same host. Localized in the chat as
 * conversations.errors.cliSandboxUnavailable.
 */
export class CliSandboxUnavailableError extends CodedModelError {
  readonly providerId: string
  readonly reason: KernelSandboxReason

  constructor(providerId: string, reason: KernelSandboxReason) {
    super('isolation', 'cliSandboxUnavailable', { provider: providerId, reason }, {
      message: `${providerId}: security.cliSandbox is 'required' but no kernel file sandbox is available (${reason}) — turn refused`,
    })
    this.name = 'CliSandboxUnavailableError'
    this.providerId = providerId
    this.reason = reason
  }
}

export type CliSandboxTurn =
  | { sandboxed: true; mode: CliSandboxMode; reason: KernelSandboxReason }
  | {
      sandboxed: false
      mode: 'auto'
      reason: KernelSandboxReason
      /** The notice to show, the first time in this conversation; null after that. */
      notice: Extract<StreamEvent, { type: 'notice' }> | null
    }

/** Brand names for the notice text (not translated). */
const CLI_LABELS: Record<SandboxCli, string> = {
  'claude-code': 'Claude Code',
  'grok-cli': 'Grok CLI',
  'kimi-cli': 'Kimi Code CLI',
}

/** Conversations already told that this CLI runs unsandboxed here (bounded). */
const announced = new Set<string>()
const MAX_ANNOUNCED = 2_000

function firstAnnouncement(cli: SandboxCli, conversationId: string | undefined): boolean {
  const key = `${cli}\0${conversationId ?? ''}`
  if (announced.has(key)) return false
  if (announced.size >= MAX_ANNOUNCED) {
    const oldest = announced.values().next().value
    if (oldest !== undefined) announced.delete(oldest)
  }
  announced.add(key)
  return true
}

/** What a CLI provider takes for its sandbox decision; tests inject both, production neither. */
export interface CliSandboxDeps {
  /** Default: the configured security.cliSandbox (getCliSandboxMode). */
  mode?: () => CliSandboxMode
  /** Host facts for detection (default: this process's). */
  host?: Partial<SandboxHostDeps>
}

export interface PlanCliSandboxTurnOptions extends DetectKernelSandboxOptions {
  conversationId?: string
  /** Default: the configured mode. */
  mode?: CliSandboxMode
}

/**
 * The sandbox decision for one CLI turn WITH tools. Throws
 * CliSandboxUnavailableError when the mode is 'required' and none is
 * available — before anything is spawned.
 */
export async function planCliSandboxTurn(cli: SandboxCli, opts: PlanCliSandboxTurnOptions = {}): Promise<CliSandboxTurn> {
  const mode = opts.mode ?? getCliSandboxMode()
  const availability = await detectKernelSandbox(cli, opts)
  if (availability.available) return { sandboxed: true, mode, reason: availability.reason }
  if (mode === 'required') throw new CliSandboxUnavailableError(cli, availability.reason)
  return {
    sandboxed: false,
    mode: 'auto',
    reason: availability.reason,
    notice: firstAnnouncement(cli, opts.conversationId)
      ? { type: 'notice', code: 'cliSandboxUnavailable', params: { provider: CLI_LABELS[cli], reason: availability.reason } }
      : null,
  }
}

/** A path as written and as resolved through symlinks, case-folded where the filesystem folds case. */
function pathForms(path: string): string[] {
  const fold = process.platform === 'darwin' || process.platform === 'win32'
  const forms = new Set([resolve(path)])
  try {
    forms.add(realpathBestEffort(path))
  } catch {
    // As written only.
  }
  return [...forms].map((f) => (fold ? f.toLowerCase() : f))
}

/** `child` is `parent` itself or lies inside it. */
function insideOrSame(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * The folders a sandbox may keep usable inside the deny list (a CLI's own
 * home, its binary's folder). Never the filesystem root, the home or a folder
 * above it, and never a folder that holds something the deny list protects —
 * exempting it would exempt what is inside. Compared as written and through
 * symlinks.
 */
export function exemptableDirs(paths: readonly string[], homeDir: string, denied: readonly string[] = []): string[] {
  const homeForms = pathForms(homeDir)
  const deniedForms = denied.flatMap(pathForms)
  const out = new Set<string>()
  for (const raw of paths) {
    if (typeof raw !== 'string' || !isAbsolute(raw)) continue
    const forms = pathForms(raw)
    if (forms.some((f) => f === '/' || homeForms.some((h) => insideOrSame(h, f)))) continue
    if (forms.some((f) => deniedForms.some((d) => d !== f && insideOrSame(d, f)))) continue
    out.add(resolve(raw))
  }
  return [...out]
}

/**
 * The deny list of one sandboxed CLI session: the path policy's kernel deny
 * list for the session's folders, with `keep` (the CLI's own home, its binary)
 * left usable — but only those keeps that shelter nothing protected.
 */
export function sandboxDenyList(
  policy: Pick<PathPolicy, 'kernelDenyList'>,
  opts: { workingDirectories: readonly string[]; keep: readonly string[]; homeDir: string },
): string[] {
  const base = policy.kernelDenyList({ workingDirectories: opts.workingDirectories })
  const keeps = exemptableDirs(opts.keep, opts.homeDir, base)
  return keeps.length > 0 ? policy.kernelDenyList({ workingDirectories: opts.workingDirectories, exclude: keeps }) : base
}

/** Tests only: forget the configured mode source, cached detections and announcements. */
export function resetCliSandboxForTests(): void {
  modeSource = () => undefined
  cache.clear()
  announced.clear()
}
