// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Sign-in into the EYAS-owned homes of the ACP CLIs (Grok, Kimi). Their HOME
// and config dir are EYAS's own folder (acp-profiles.ts), so the operator's
// host login is never seen: EYAS signs in once for itself, with one of
//
//   - a device code: the CLI's own login command runs through the provider's
//     launch profile (same executable, allowlisted env, EYAS home), prints a
//     verification link and a code, and writes its credential into the EYAS
//     home once the code is confirmed in any browser — the server needs no
//     browser of its own;
//   - an API key EYAS stores encrypted in its secrets (Grok only): passed to
//     every grok spawn as XAI_API_KEY through the profile's extraEnv, never
//     through the host environment.
//
// Observed on grok 1.0.40 (A1 spike, tests/fixtures/cli/grok/1.0.40):
// `grok login --device-auth` prints everything on STDERR (stdout stays
// empty), with ANSI escape codes — the link line, the code line and
// "Waiting for authorization...". The credential is $GROK_HOME/auth.json.
// grok prefers a stored sign-in over XAI_API_KEY.
// Kimi (kimi-cli 1.52.0 source, not verified on a host): `kimi login --json`
// emits JSON lines on stdout ({type:'verification_url', data:{verification_url,
// user_code}}, 'waiting', 'error', 'success'), restarts with a new code when
// one expires, and calls webbrowser.open (BROWSER is set to a no-op). The
// credential is <KIMI_SHARE_DIR>/credentials/kimi-code.json.
//
// The non-TTY output format is undocumented, so the parser is lenient (ANSI
// stripped, either stream, JSON or text) and a miss shows the CLI's raw text
// instead of a link. The status check only looks at whether the credential
// file exists; it never reads it.

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Logger } from 'pino'
import { z } from 'zod'
import { CodedModelError } from '@shared/classify-model-error.js'
import type { Requester, SecretsRegistry } from '@modules/secrets/types.js'
import { homeFileExists, removeHomeFile } from './homes.js'
import { getIsolationStatus, resetIsolationStatuses, setIsolationStatus } from './isolation.js'

// ─── Providers ─────────────────────────────────

export const CLI_SIGN_IN_PROVIDERS = ['grok-cli', 'kimi-cli'] as const
export type CliSignInProviderId = typeof CLI_SIGN_IN_PROVIDERS[number]

export function isCliSignInProvider(id: string): id is CliSignInProviderId {
  return (CLI_SIGN_IN_PROVIDERS as readonly string[]).includes(id)
}

export type CliSignInMethod = 'device' | 'apiKey'

interface ApiKeySpec {
  /** Secret name (scope 'system') the key is stored under. */
  secretName: string
  /** Environment variable the CLI reads it from. */
  envVar: string
}

interface SignInSpec {
  /** Product name used in operator-facing text. */
  displayName: string
  /** argv of the device login. */
  loginArgs: readonly string[]
  /** The credential the login writes, relative to the CLI's config dir. */
  credentialFile: string
  /**
   * argv of the CLI's own sign-out, or null when EYAS removes the credential
   * file itself (Kimi: `kimi logout` also deletes its token from the OS
   * keyring, which is the operator's host store — a redirected HOME does not
   * isolate the keyring).
   */
  logoutArgs: readonly string[] | null
  apiKey: ApiKeySpec | null
}

/** Secret the EYAS-stored xAI API key for the Grok CLI lives under. */
export const GROK_CLI_API_KEY_SECRET = 'grok-cli-api-key'

const SPECS: Record<CliSignInProviderId, SignInSpec> = {
  'grok-cli': {
    displayName: 'Grok CLI',
    loginArgs: ['login', '--device-auth'],
    credentialFile: 'auth.json',
    logoutArgs: ['logout'],
    apiKey: { secretName: GROK_CLI_API_KEY_SECRET, envVar: 'XAI_API_KEY' },
  },
  'kimi-cli': {
    displayName: 'Kimi Code CLI',
    loginArgs: ['login', '--json'],
    credentialFile: join('credentials', 'kimi-code.json'),
    logoutArgs: null,
    apiKey: null,
  },
}

/**
 * What sign-in needs from a provider's launch profile (acp-profiles.ts
 * AcpCliProfile satisfies it): the login runs with exactly the executable,
 * environment and EYAS home every turn uses.
 */
export interface CliSignInProfile {
  readonly providerId: CliSignInProviderId
  readonly home: string
  readonly configDir: string
  resolveExecutable(): Promise<string>
  env(extra?: Record<string, string | undefined>): Record<string, string>
  ensureHome(): void
}

// ─── Output parsing ────────────────────────────

// CSI sequences (colours, cursor), OSC sequences (titles, hyperlinks) and
// the remaining two-byte escapes.
const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g
// C0 controls except tab and newline, plus DEL.
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/g

/** Terminal escape codes and control characters removed; newlines kept. */
export function sanitizeCliOutput(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(ANSI_RE, '').replace(CONTROL_RE, '')
}

const URL_RE = /https:\/\/[^\s"'<>`]+/g
const USER_CODE_RE = /^[A-Z0-9]{3,12}(?:-[A-Z0-9]{3,12}){1,3}$/i

/** The link as a clean https URL, or null (other schemes are never shown as a link). */
function httpsUrl(raw: string): string | null {
  const trimmed = raw.replace(/[).,;:!?\]]+$/, '')
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

function userCode(raw: string | null | undefined): string | null {
  const code = raw?.trim() ?? ''
  return USER_CODE_RE.test(code) ? code : null
}

/** One line of `kimi login --json`. */
const OAuthEventSchema = z.object({
  type: z.string(),
  message: z.string().optional(),
  data: z.object({
    verification_url: z.string().optional(),
    user_code: z.string().optional(),
  }).passthrough().nullish(),
}).passthrough()

export interface DeviceAuthPrompt {
  verificationUrl: string | null
  userCode: string | null
  /** Error messages the CLI reported (JSON 'error' events). */
  errors: string[]
}

/**
 * Parse whatever a device login printed so far (both streams, any order).
 * JSON event lines (Kimi) and plain text (Grok) are both understood; the
 * latest link and code win, so a restarted flow shows its new code. The code
 * falls back to the link's user_code parameter.
 */
export function parseDeviceAuthOutput(text: string): DeviceAuthPrompt {
  let verificationUrl: string | null = null
  let code: string | null = null
  const errors: string[] = []
  for (const rawLine of sanitizeCliOutput(text).split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('{')) {
      let json: unknown
      try {
        json = JSON.parse(line)
      } catch {
        json = undefined
      }
      const event = OAuthEventSchema.safeParse(json)
      if (event.success) {
        if (event.data.type === 'verification_url') {
          const url = httpsUrl(event.data.data?.verification_url ?? '')
          if (url) verificationUrl = url
          const c = userCode(event.data.data?.user_code)
          if (c) code = c
        } else if (event.data.type === 'error' && event.data.message) {
          errors.push(event.data.message.slice(0, 300))
        }
        continue
      }
    }
    for (const match of line.match(URL_RE) ?? []) {
      const url = httpsUrl(match)
      if (url) verificationUrl = url
    }
    const c = userCode(line)
    if (c) code = c
  }
  if (!code && verificationUrl) code = userCode(new URL(verificationUrl).searchParams.get('user_code'))
  return { verificationUrl, userCode: code, errors }
}

// ─── Errors ────────────────────────────────────

/**
 * The failure of a turn on a CLI whose EYAS home is not signed in. Terminal
 * ('auth' is never retried); the UI shows conversations.errors.cliSignIn.
 */
export function cliSignInError(providerId: CliSignInProviderId, cause?: unknown): CodedModelError {
  const name = SPECS[providerId].displayName
  return new CodedModelError('auth', 'cliSignIn', { provider: providerId }, {
    message: `${name} is not signed in for EYAS: EYAS runs it in its own home and does not use the host login. Sign in under Providers → ${name} (device code${SPECS[providerId].apiKey ? ' or API key' : ''}).`,
    ...(cause !== undefined ? { cause } : {}),
  })
}

/** How the ACP CLIs word a missing or rejected login (ACP auth_required, grok, kimi _check_auth). */
const CLI_AUTH_FAILURE_RE = /auth(?:entication)?[ _]required|auth(?:entication)? failed|not (?:logged|signed) in|log ?in required|please (?:log|sign) ?in|unauthori[sz]ed|\b401\b|invalid[ _]api[ _]key|api[ _]key[ _](?:is[ _])?(?:invalid|blocked)/i

/**
 * Map a failed CLI turn onto the sign-in error when it is one: the EYAS home
 * is not signed in, or the CLI reported a missing or rejected login. Any
 * other failure (and an already coded one) is returned unchanged.
 */
export function asCliSignInFailure(providerId: CliSignInProviderId, err: Error, isSignedIn?: () => boolean): Error {
  if (err instanceof CodedModelError) return err
  let signedIn = true
  try {
    signedIn = isSignedIn ? isSignedIn() : true
  } catch {
    signedIn = true
  }
  if (!signedIn || CLI_AUTH_FAILURE_RE.test(err.message)) return cliSignInError(providerId, err)
  return err
}

/** Why a sign-in request cannot be served. */
export class CliSignInRequestError extends Error {
  readonly code: 'unsupported' | 'apiKeyUnsupported' | 'secretsUnavailable'
  constructor(code: CliSignInRequestError['code'], message: string) {
    super(message)
    this.name = 'CliSignInRequestError'
    this.code = code
  }
}

// ─── Sessions ──────────────────────────────────

export type CliSignInState = 'pending' | 'succeeded' | 'failed' | 'expired' | 'cancelled'

export interface CliSignInSession {
  id: string
  providerId: CliSignInProviderId
  method: 'device'
  state: CliSignInState
  /** The link to open in a browser (https only); null until the CLI printed it. */
  verificationUrl: string | null
  /** The code to confirm there; null until printed. */
  userCode: string | null
  /** The CLI's own text, shown verbatim when no link could be parsed from it. */
  rawPrompt: string | null
  /** Why the sign-in failed (the CLI's last words), when it did. */
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export interface CliSignInStatus {
  providerId: CliSignInProviderId
  /** A credential in the EYAS home, or an EYAS-stored API key. */
  signedIn: boolean
  /** Which one the CLI uses: a stored sign-in wins over the API key. */
  method: CliSignInMethod | null
  apiKeySupported: boolean
  apiKeyStored: boolean
  /** The latest device sign-in of this process (pending or finished). */
  session: CliSignInSession | null
}

export type CliSignInRequest = { method: 'device' } | { method: 'apiKey'; apiKey: string }

/** Validated body of POST /api/v1/model/providers/:id/sign-in. */
export const CliSignInRequestSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('device') }).strict(),
  z.object({ method: z.literal('apiKey'), apiKey: z.string().trim().min(8).max(512).regex(/^[\x21-\x7e]+$/, 'must be printable ASCII without spaces') }).strict(),
])

export interface CliSignInService {
  /** Current state; also picks up an API key added or removed on the Secrets page. */
  status(providerId: CliSignInProviderId): Promise<CliSignInStatus>
  /**
   * Start a device sign-in (one in flight per provider: a second start while
   * one is pending returns it) or store an API key.
   */
  start(providerId: CliSignInProviderId, request: CliSignInRequest, requester?: Requester): Promise<CliSignInStatus>
  /** Stop a pending device sign-in. */
  cancel(providerId: CliSignInProviderId): Promise<CliSignInStatus>
  /** Remove the EYAS sign-in: the CLI's credential and the stored API key. */
  signOut(providerId: CliSignInProviderId, requester?: Requester): Promise<CliSignInStatus>
  /** Signed in right now (credential file or stored key); never reads the credential. */
  isSignedIn(providerId: CliSignInProviderId): boolean
  /** What the provider's profile adds to every spawn (the stored API key). */
  profileEnv(providerId: CliSignInProviderId): Record<string, string | undefined>
  /** Reload the stored API key and bring the isolation status in line (provider load). */
  refresh(providerId: CliSignInProviderId): Promise<void>
  /** Stop every pending sign-in (module stop). */
  dispose(): void
}

type Spawn = (command: string, args: readonly string[], options: { cwd: string; env: Record<string, string>; stdio: ['pipe', 'pipe', 'pipe'] }) => ChildProcess

export interface CliSignInServiceDeps {
  /** The provider's launch profile — the same one its turns spawn through. */
  profileFor: (providerId: CliSignInProviderId) => CliSignInProfile
  /** EYAS secrets, where the API key is stored. Absent: API keys are unavailable. */
  secrets?: Pick<SecretsRegistry, 'get' | 'set' | 'delete' | 'has'>
  logger?: Pick<Logger, 'info' | 'warn' | 'debug'>
  /** Called after anything that may change whether a provider is signed in. */
  onChange?: (providerId: CliSignInProviderId, signedIn: boolean) => void
  /** Process spawner (tests). */
  spawn?: Spawn
  /** How long a device sign-in waits for the confirmation (default 15 minutes). */
  deviceTimeoutMs?: number
  /** How long the CLI's sign-out may run (default 30 seconds). */
  logoutTimeoutMs?: number
  /** Without a parsed link after this long, the raw CLI text is shown (default 5 seconds). */
  rawPromptAfterMs?: number
}

const DEFAULT_DEVICE_TIMEOUT_MS = 15 * 60 * 1000
const DEFAULT_LOGOUT_TIMEOUT_MS = 30 * 1000
const DEFAULT_RAW_PROMPT_AFTER_MS = 5 * 1000
/** Output kept per sign-in (the prompt is a few hundred bytes). */
const MAX_OUTPUT = 64 * 1024
const MAX_SHOWN = 1_500
const KILL_GRACE_MS = 3_000

/** Internal reads of the stored key (module bootstrap, provider load). */
const SYSTEM_REQUESTER: Requester = { userId: 'system', role: 'owner', trusted: true }

/** The browser the Kimi login may try to open: a command that does nothing. */
const NO_OP_BROWSER = 'true'

interface Running {
  session: CliSignInSession
  child: ChildProcess | null
  output: string
  timers: Array<ReturnType<typeof setTimeout>>
  /** Set before EYAS kills the child: the state it ends in. */
  endAs: CliSignInState | null
}

/** Something (a file, a link) sits at `path`; a link is not followed. */
function entryExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function lastWords(output: string): string | null {
  const lines = sanitizeCliOutput(output).split('\n').map((l) => l.trim()).filter(Boolean)
  const last = lines[lines.length - 1]
  return last ? last.slice(0, 300) : null
}

function shown(output: string): string | null {
  const text = sanitizeCliOutput(output).trim()
  if (!text) return null
  return text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN)}…` : text
}

const EXPIRED_RE = /expired|timed out|time ?out/i

export function createCliSignInService(deps: CliSignInServiceDeps): CliSignInService {
  const spawnFn: Spawn = deps.spawn ?? ((command, args, options) => nodeSpawn(command, [...args], options))
  const deviceTimeoutMs = deps.deviceTimeoutMs ?? DEFAULT_DEVICE_TIMEOUT_MS
  const logoutTimeoutMs = deps.logoutTimeoutMs ?? DEFAULT_LOGOUT_TIMEOUT_MS
  const rawPromptAfterMs = deps.rawPromptAfterMs ?? DEFAULT_RAW_PROMPT_AFTER_MS

  const profiles = new Map<CliSignInProviderId, CliSignInProfile>()
  const runs = new Map<CliSignInProviderId, Running>()
  /** Stored API keys, kept in memory so a spawn's env stays synchronous. */
  const apiKeys = new Map<CliSignInProviderId, string>()

  const profileOf = (id: CliSignInProviderId): CliSignInProfile => {
    let profile = profiles.get(id)
    if (!profile) {
      profile = deps.profileFor(id)
      profiles.set(id, profile)
    }
    return profile
  }

  const credentialPath = (id: CliSignInProviderId): { home: string; path: string } => {
    const profile = profileOf(id)
    return { home: profile.home, path: relative(profile.home, join(profile.configDir, SPECS[id].credentialFile)) }
  }

  const hasCredential = (id: CliSignInProviderId): boolean => {
    const { home, path } = credentialPath(id)
    try {
      return homeFileExists(home, path)
    } catch {
      return false
    }
  }

  const isSignedIn = (id: CliSignInProviderId): boolean => hasCredential(id) || apiKeys.has(id)

  /**
   * Keep the isolation status honest: a signed-out CLI is 'auth-required',
   * unless a check already failed (a violation, or a check that could not
   * run) — that finding is the graver one and keeps its detail. A sign-in
   * clears 'auth-required' back to 'unverified', so the next preflight
   * (acp-verify.ts) records what it proves.
   */
  const syncIsolationStatus = (id: CliSignInProviderId): void => {
    const current = getIsolationStatus(id)
    if (!isSignedIn(id)) {
      const graver = current.status === 'violation' || (current.status === 'unverified' && current.checks.length > 0)
      if (!graver && current.status !== 'auth-required') {
        setIsolationStatus(id, { status: 'auth-required', checks: [], runtime: current.runtime })
      }
    } else if (current.status === 'auth-required') {
      resetIsolationStatuses(id)
    }
  }

  const changed = (id: CliSignInProviderId): void => {
    syncIsolationStatus(id)
    try {
      deps.onChange?.(id, isSignedIn(id))
    } catch (err) {
      deps.logger?.warn({ provider: id, err: String(err) }, 'cli sign-in: change listener failed')
    }
  }

  /** Bring the cached key in line with the secrets store. */
  const loadApiKey = async (id: CliSignInProviderId, opts: { onlyIfPresenceChanged?: boolean } = {}): Promise<void> => {
    const spec = SPECS[id].apiKey
    if (!spec || !deps.secrets) return
    try {
      if (opts.onlyIfPresenceChanged) {
        const stored = await deps.secrets.has(spec.secretName, 'system', SYSTEM_REQUESTER)
        if (stored === apiKeys.has(id)) return
      }
      const value = (await deps.secrets.get(spec.secretName, 'system', SYSTEM_REQUESTER))?.trim()
      if (value) apiKeys.set(id, value)
      else apiKeys.delete(id)
    } catch (err) {
      deps.logger?.warn({ provider: id, err: String(err) }, 'cli sign-in: reading the stored API key failed')
    }
  }

  const snapshot = (id: CliSignInProviderId): CliSignInStatus => {
    const credential = hasCredential(id)
    const keyStored = apiKeys.has(id)
    const run = runs.get(id)
    return {
      providerId: id,
      signedIn: credential || keyStored,
      method: credential ? 'device' : keyStored ? 'apiKey' : null,
      apiKeySupported: SPECS[id].apiKey !== null && !!deps.secrets,
      apiKeyStored: keyStored,
      session: run ? { ...run.session } : null,
    }
  }

  const finish = (id: CliSignInProviderId, run: Running, state: CliSignInState, error: string | null): void => {
    if (run.session.state !== 'pending') return
    for (const timer of run.timers) clearTimeout(timer)
    run.timers = []
    run.session.state = state
    run.session.error = error
    run.session.finishedAt = new Date().toISOString()
    if (state !== 'succeeded' && !run.session.verificationUrl) run.session.rawPrompt = shown(run.output)
    run.child = null
    deps.logger?.info({ provider: id, state }, 'cli sign-in: device sign-in ended')
    changed(id)
  }

  const kill = (child: ChildProcess | null): void => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    try {
      child.kill('SIGTERM')
    } catch {
      return
    }
    const hard = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill('SIGKILL') } catch { /* already gone */ }
      }
    }, KILL_GRACE_MS)
    hard.unref?.()
  }

  const startDevice = async (id: CliSignInProviderId): Promise<CliSignInStatus> => {
    const existing = runs.get(id)
    if (existing?.session.state === 'pending') return snapshot(id)

    const spec = SPECS[id]
    const run: Running = {
      session: {
        id: randomUUID(),
        providerId: id,
        method: 'device',
        state: 'pending',
        verificationUrl: null,
        userCode: null,
        rawPrompt: null,
        error: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      },
      child: null,
      output: '',
      timers: [],
      endAs: null,
    }
    // Registered before anything is awaited: a concurrent start sees it.
    runs.set(id, run)

    const profile = profileOf(id)
    let executable: string
    let env: Record<string, string>
    try {
      executable = await profile.resolveExecutable()
      profile.ensureHome()
      // The profile's env (EYAS home, allowlist, isolation switches); no
      // browser is opened on the server, and a stored API key plays no part
      // in the login itself.
      env = profile.env({
        BROWSER: NO_OP_BROWSER,
        ...(spec.apiKey ? { [spec.apiKey.envVar]: undefined } : {}),
      })
    } catch (err) {
      finish(id, run, 'failed', err instanceof Error ? err.message : String(err))
      return snapshot(id)
    }
    if (run.endAs) {
      // Cancelled while the executable was being resolved.
      finish(id, run, run.endAs, null)
      return snapshot(id)
    }

    let child: ChildProcess
    try {
      child = spawnFn(executable, spec.loginArgs, { cwd: profile.home, env, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      finish(id, run, 'failed', err instanceof Error ? err.message : String(err))
      return snapshot(id)
    }
    run.child = child
    deps.logger?.info({ provider: id }, 'cli sign-in: device sign-in started')

    // stdin stays open and unused: the CLI reads nothing, and an early EOF
    // could read as a cancel.
    child.stdin?.on('error', () => { /* the close handler reports the outcome */ })

    // After a grace period without a parsed link, the CLI's own text is
    // shown as it is (and kept current as more arrives).
    let rawDue = false
    const showRawIfDue = (): void => {
      if (rawDue && run.session.state === 'pending' && !run.session.verificationUrl) run.session.rawPrompt = shown(run.output)
    }
    const onOutput = (chunk: Buffer | string): void => {
      if (run.output.length < MAX_OUTPUT) run.output += String(chunk).slice(0, MAX_OUTPUT - run.output.length)
      const prompt = parseDeviceAuthOutput(run.output)
      if (prompt.verificationUrl) {
        run.session.verificationUrl = prompt.verificationUrl
        run.session.rawPrompt = null
      }
      if (prompt.userCode) run.session.userCode = prompt.userCode
      showRawIfDue()
    }
    child.stdout?.on('data', onOutput)
    child.stderr?.on('data', onOutput)

    const rawTimer = setTimeout(() => {
      rawDue = true
      showRawIfDue()
    }, rawPromptAfterMs)
    rawTimer.unref?.()
    const expiry = setTimeout(() => {
      run.endAs = 'expired'
      kill(child)
    }, deviceTimeoutMs)
    expiry.unref?.()
    run.timers.push(rawTimer, expiry)

    child.once('error', (err) => {
      finish(id, run, 'failed', err.message)
    })
    child.once('close', (code) => {
      if (run.endAs) {
        finish(id, run, run.endAs, run.endAs === 'expired' ? lastWords(run.output) : null)
        return
      }
      if (code === 0) {
        finish(id, run, 'succeeded', null)
        return
      }
      const prompt = parseDeviceAuthOutput(run.output)
      const error = prompt.errors[prompt.errors.length - 1] ?? lastWords(run.output) ?? `exited with code ${code}`
      finish(id, run, EXPIRED_RE.test(error) ? 'expired' : 'failed', error)
    })

    return snapshot(id)
  }

  const setApiKey = async (id: CliSignInProviderId, apiKey: string, requester?: Requester): Promise<CliSignInStatus> => {
    const spec = SPECS[id].apiKey
    if (!spec) throw new CliSignInRequestError('apiKeyUnsupported', `${SPECS[id].displayName} has no API-key sign-in in EYAS; use the device code`)
    if (!deps.secrets) throw new CliSignInRequestError('secretsUnavailable', 'the secrets store is not available')
    const value = apiKey.trim()
    await deps.secrets.set(spec.secretName, 'system', value, 'model', requester)
    apiKeys.set(id, value)
    deps.logger?.info({ provider: id }, 'cli sign-in: API key stored')
    changed(id)
    return snapshot(id)
  }

  /** Run the CLI's own sign-out through the profile; failures only log. */
  const runLogout = async (id: CliSignInProviderId, args: readonly string[]): Promise<void> => {
    const profile = profileOf(id)
    let child: ChildProcess
    try {
      const executable = await profile.resolveExecutable()
      profile.ensureHome()
      child = spawnFn(executable, args, { cwd: profile.home, env: profile.env({ BROWSER: NO_OP_BROWSER }), stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err) {
      deps.logger?.warn({ provider: id, err: String(err) }, 'cli sign-in: the CLI sign-out could not start')
      return
    }
    child.stdin?.end()
    child.stdout?.resume()
    child.stderr?.resume()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        kill(child)
        resolve()
      }, logoutTimeoutMs)
      timer.unref?.()
      const done = (): void => {
        clearTimeout(timer)
        resolve()
      }
      child.once('error', (err) => {
        deps.logger?.warn({ provider: id, err: String(err) }, 'cli sign-in: the CLI sign-out failed')
        done()
      })
      child.once('close', done)
    })
  }

  const cancel = async (id: CliSignInProviderId): Promise<CliSignInStatus> => {
    const run = runs.get(id)
    if (run?.session.state === 'pending') {
      run.endAs = 'cancelled'
      if (run.child) kill(run.child)
    }
    return snapshot(id)
  }

  return {
    async status(id) {
      await loadApiKey(id, { onlyIfPresenceChanged: true })
      syncIsolationStatus(id)
      return snapshot(id)
    },

    async start(id, request, requester) {
      if (!isCliSignInProvider(id)) throw new CliSignInRequestError('unsupported', `no EYAS sign-in for ${String(id)}`)
      if (request.method === 'apiKey') return setApiKey(id, request.apiKey, requester)
      return startDevice(id)
    },

    cancel,

    async signOut(id, requester) {
      await cancel(id)
      const spec = SPECS[id]
      if (hasCredential(id) && spec.logoutArgs) await runLogout(id, spec.logoutArgs)
      // Whatever the CLI did: the credential is gone from the EYAS home (a
      // planted link in its place is unlinked too, never followed).
      const { home, path } = credentialPath(id)
      if (entryExists(join(home, path))) {
        try {
          if (removeHomeFile(home, path)) deps.logger?.info({ provider: id }, 'cli sign-in: credential removed from the EYAS home')
        } catch (err) {
          deps.logger?.warn({ provider: id, err: String(err) }, 'cli sign-in: removing the credential failed')
        }
      }
      if (spec.apiKey && deps.secrets) {
        await deps.secrets.delete(spec.apiKey.secretName, 'system', requester)
      }
      apiKeys.delete(id)
      changed(id)
      return snapshot(id)
    },

    isSignedIn,

    profileEnv(id) {
      const spec = SPECS[id].apiKey
      const key = apiKeys.get(id)
      return spec && key ? { [spec.envVar]: key } : {}
    },

    async refresh(id) {
      await loadApiKey(id)
      syncIsolationStatus(id)
    },

    dispose() {
      for (const [id, run] of runs) {
        if (run.session.state !== 'pending') continue
        run.endAs = 'cancelled'
        kill(run.child)
        finish(id, run, 'cancelled', null)
      }
    },
  }
}
