// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A7 — sign-in into the EYAS-owned Grok/Kimi homes. The device login runs
// the CLI through its real launch profile (EYAS home, allowlisted env); only
// the executable is a fake that replays the A1 spike's grok 1.0.40 output
// (tests/fixtures/cli/grok/1.0.40/device-auth-stderr.txt: everything on
// STDERR, with ANSI codes) or the kimi-cli `login --json` event lines, and
// waits for a trigger file before it exits.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAcpProfile, type AcpProviderId } from '@modules/model/submodules/grok-cli/acp-profiles.js'
import {
  asCliSignInFailure,
  cliSignInError,
  createCliSignInService,
  CliSignInRequestError,
  CliSignInRequestSchema,
  GROK_CLI_API_KEY_SECRET,
  parseDeviceAuthOutput,
  sanitizeCliOutput,
  type CliSignInService,
  type CliSignInStatus,
} from '@modules/model/cli-runtime/sign-in.js'
import { getIsolationStatus, resetIsolationStatuses, setIsolationStatus } from '@modules/model/cli-runtime/isolation.js'
import { CodedModelError, classifyModelError } from '@shared/classify-model-error.js'

const FIXTURE = fileURLToPath(new URL('../../../fixtures/cli/grok/1.0.40/device-auth-stderr.txt', import.meta.url))

let root: string
let homesDir: string
let hostHome: string
let service: CliSignInService | null

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-sign-in-')))
  homesDir = join(root, 'data', 'cli-homes')
  hostHome = join(root, 'host-home')
  mkdirSync(join(hostHome, '.grok'), { recursive: true })
  writeFileSync(join(hostHome, '.grok', 'auth.json'), '{"token":"HOST"}')
  resetIsolationStatuses()
  service = null
})

afterEach(() => {
  service?.dispose()
  resetIsolationStatuses()
  rmSync(root, { recursive: true, force: true })
})

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

interface FakeCli {
  path: string
  trigger: string
  envLog: string
  argvLog: string
}

/**
 * A fake grok/kimi: logs argv and env, answers `logout` at once, otherwise
 * prints the login prompt and exits with the code written to the trigger
 * file — writing the credential into the EYAS home first when it is 0.
 */
function fakeCli(kind: 'grok' | 'kimi' | 'garbled'): FakeCli {
  const dir = join(root, `fake-${kind}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  const cli: FakeCli = {
    path: join(dir, kind),
    trigger: join(dir, 'trigger'),
    envLog: join(dir, 'env.log'),
    argvLog: join(dir, 'argv.log'),
  }
  const prompt = kind === 'grok'
    ? `cat ${shQuote(FIXTURE)} >&2`
    : kind === 'kimi'
      ? [
          `echo '{"type": "info", "message": "Please visit the following URL to finish authorization."}'`,
          `echo '{"type": "verification_url", "message": "Verification URL: https://auth.example.com/device?user_code=ABCD-EFGH", "data": {"verification_url": "https://auth.example.com/device?user_code=ABCD-EFGH", "user_code": "ABCD-EFGH"}}'`,
          `echo '{"type": "waiting", "message": "Waiting for user authorization...: "}'`,
        ].join('\n')
      : `printf 'Visit the portal and enter the magic words\\n' >&2`
  const credential = kind === 'kimi'
    ? 'mkdir -p "$KIMI_SHARE_DIR/credentials" && printf x > "$KIMI_SHARE_DIR/credentials/kimi-code.json"'
    : 'mkdir -p "$GROK_HOME" && printf x > "$GROK_HOME/auth.json"'
  const failure = kind === 'kimi'
    ? `echo '{"type": "error", "message": "Login failed: access denied"}'`
    : `printf 'Error: authorization was denied\\n' >&2`
  writeFileSync(cli.path, [
    '#!/bin/sh',
    `printf '%s\\n' "$*" >> ${shQuote(cli.argvLog)}`,
    `env > ${shQuote(cli.envLog)}`,
    'if [ "$1" = "logout" ]; then rm -f "$GROK_HOME/auth.json"; exit 0; fi',
    prompt,
    `while [ ! -f ${shQuote(cli.trigger)} ]; do sleep 0.05; done`,
    `code=$(cat ${shQuote(cli.trigger)})`,
    `if [ "$code" = "0" ]; then ${credential}; else ${failure}; fi`,
    'exit $code',
  ].join('\n') + '\n')
  chmodSync(cli.path, 0o755)
  return cli
}

function fakeSecrets() {
  const store = new Map<string, string>()
  const key = (name: string, scope: string) => `${scope}:${name}`
  return {
    store,
    get: async (name: string, scope: string) => store.get(key(name, scope)) ?? null,
    set: async (name: string, scope: string, value: string) => { store.set(key(name, scope), value) },
    delete: async (name: string, scope: string) => store.delete(key(name, scope)),
    has: async (name: string, scope: string) => store.has(key(name, scope)),
  }
}

/** The host environment the profile filters: a signed-in operator. */
function hostEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '',
    HOME: hostHome,
    GROK_HOME: join(hostHome, '.grok'),
    KIMI_SHARE_DIR: join(hostHome, '.kimi'),
    XAI_API_KEY: 'HOST-XAI-KEY',
    BROWSER: 'firefox',
  }
}

function makeService(clis: Partial<Record<AcpProviderId, FakeCli>>, opts: { secrets?: ReturnType<typeof fakeSecrets>; deviceTimeoutMs?: number; rawPromptAfterMs?: number; changes?: Array<[string, boolean]> } = {}) {
  const svc: CliSignInService = createCliSignInService({
    profileFor: (id) => createAcpProfile(id, {
      homesDir,
      resolveExecutable: async () => {
        const cli = clis[id]
        if (!cli) throw new Error(`${id}: no executable found`)
        return cli.path
      },
      sourceEnv: hostEnv(),
      extraEnv: () => svc.profileEnv(id),
    }),
    secrets: opts.secrets,
    deviceTimeoutMs: opts.deviceTimeoutMs,
    rawPromptAfterMs: opts.rawPromptAfterMs,
    onChange: (id, signedIn) => opts.changes?.push([id, signedIn]),
  })
  service = svc
  return svc
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error(`condition not met: ${JSON.stringify(value)}`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

function envOf(cli: FakeCli): Record<string, string> {
  return Object.fromEntries(readFileSync(cli.envLog, 'utf8').split('\n').filter(Boolean).map((line) => {
    const at = line.indexOf('=')
    return [line.slice(0, at), line.slice(at + 1)]
  }))
}

// ─── Parsing ───────────────────────────────────

describe('parseDeviceAuthOutput', () => {
  it('reads the link and the code from the grok 1.0.40 stderr fixture, ANSI codes included (positive)', () => {
    const raw = readFileSync(FIXTURE, 'utf8')
    expect(raw).toContain('\u001b[')
    const prompt = parseDeviceAuthOutput(raw)
    expect(prompt.verificationUrl).toBe('https://accounts.x.ai/oauth2/device?user_code=XXXX-XXXX')
    expect(prompt.userCode).toBe('XXXX-XXXX')
    expect(sanitizeCliOutput(raw)).not.toContain('\u001b')
  })

  it('reads kimi JSON events; a restarted flow shows its newest code (positive)', () => {
    const line = (url: string, code: string) => JSON.stringify({ type: 'verification_url', message: `Verification URL: ${url}`, data: { verification_url: url, user_code: code } })
    const out = [
      JSON.stringify({ type: 'info', message: 'Please visit the following URL to finish authorization.' }),
      line('https://auth.example.com/device?user_code=AAAA-BBBB', 'AAAA-BBBB'),
      JSON.stringify({ type: 'info', message: 'Device code expired, restarting login...' }),
      line('https://auth.example.com/device?user_code=CCCC-DDDD', 'CCCC-DDDD'),
      JSON.stringify({ type: 'error', message: 'Login failed: nope' }),
    ].join('\n')
    expect(parseDeviceAuthOutput(out)).toEqual({
      verificationUrl: 'https://auth.example.com/device?user_code=CCCC-DDDD',
      userCode: 'CCCC-DDDD',
      errors: ['Login failed: nope'],
    })
  })

  it('takes the code from the link when no code line was printed', () => {
    expect(parseDeviceAuthOutput('open https://auth.example.com/d?user_code=WXYZ-1234 now').userCode).toBe('WXYZ-1234')
  })

  it('never offers a non-https link, and finds nothing in unrelated text (negative)', () => {
    expect(parseDeviceAuthOutput('open http://auth.example.com/device?user_code=AAAA-BBBB').verificationUrl).toBeNull()
    expect(parseDeviceAuthOutput('javascript:alert(1)\nhttps://user:pw@auth.example.com/x').verificationUrl).toBeNull()
    expect(parseDeviceAuthOutput('Waiting for authorization...\nsomething else')).toEqual({ verificationUrl: null, userCode: null, errors: [] })
  })
})

describe('CliSignInRequestSchema', () => {
  it('accepts a device request and an API key (positive)', () => {
    expect(CliSignInRequestSchema.safeParse({ method: 'device' }).success).toBe(true)
    expect(CliSignInRequestSchema.safeParse({ method: 'apiKey', apiKey: 'xai-0123456789' }).success).toBe(true)
  })

  it('rejects an unknown method, a short key and extra fields (negative)', () => {
    expect(CliSignInRequestSchema.safeParse({ method: 'password' }).success).toBe(false)
    expect(CliSignInRequestSchema.safeParse({ method: 'apiKey', apiKey: 'short' }).success).toBe(false)
    expect(CliSignInRequestSchema.safeParse({ method: 'apiKey', apiKey: 'has spaces in it' }).success).toBe(false)
    expect(CliSignInRequestSchema.safeParse({ method: 'device', command: 'rm -rf /' }).success).toBe(false)
  })
})

// ─── Device sign-in ────────────────────────────

describe.skipIf(process.platform === 'win32')('device sign-in', () => {
  it('parses the link and code, and exit 0 with a credential in the EYAS home means signed in (positive)', async () => {
    const cli = fakeCli('grok')
    const changes: Array<[string, boolean]> = []
    const svc = makeService({ 'grok-cli': cli }, { changes })

    const started = await svc.start('grok-cli', { method: 'device' })
    expect(started.session?.state).toBe('pending')
    const shown = await until(() => svc.status('grok-cli'), (s) => !!s.session?.verificationUrl && !!s.session.userCode)
    expect(shown.session).toMatchObject({
      state: 'pending',
      verificationUrl: 'https://accounts.x.ai/oauth2/device?user_code=XXXX-XXXX',
      userCode: 'XXXX-XXXX',
      rawPrompt: null,
    })
    expect(shown.signedIn).toBe(false)

    writeFileSync(cli.trigger, '0')
    const done = await until(() => svc.status('grok-cli'), (s) => s.session?.state !== 'pending')
    expect(done.session?.state).toBe('succeeded')
    expect(done).toMatchObject({ signedIn: true, method: 'device' })
    expect(existsSync(join(homesDir, 'grok-cli', '.grok', 'auth.json'))).toBe(true)
    expect(readFileSync(cli.argvLog, 'utf8').trim()).toBe('login --device-auth')
    expect(changes).toContainEqual(['grok-cli', true])
  })

  it('exit 1 means failed, with the CLI last words, and the home stays signed out (negative)', async () => {
    const cli = fakeCli('grok')
    const svc = makeService({ 'grok-cli': cli })
    await svc.start('grok-cli', { method: 'device' })
    await until(() => svc.status('grok-cli'), (s) => !!s.session?.verificationUrl)
    writeFileSync(cli.trigger, '1')
    const done = await until(() => svc.status('grok-cli'), (s) => s.session?.state !== 'pending')
    expect(done.session?.state).toBe('failed')
    expect(done.session?.error).toContain('authorization was denied')
    expect(done.signedIn).toBe(false)
  })

  it('a second start while one is pending returns the same session and spawns nothing new', async () => {
    const cli = fakeCli('grok')
    const svc = makeService({ 'grok-cli': cli })
    const [a, b] = await Promise.all([
      svc.start('grok-cli', { method: 'device' }),
      svc.start('grok-cli', { method: 'device' }),
    ])
    const c = await svc.start('grok-cli', { method: 'device' })
    expect(b.session?.id).toBe(a.session?.id)
    expect(c.session?.id).toBe(a.session?.id)
    await until(() => svc.status('grok-cli'), (s) => !!s.session?.verificationUrl)
    expect(readFileSync(cli.argvLog, 'utf8').trim().split('\n')).toHaveLength(1)
    writeFileSync(cli.trigger, '0')
    await until(() => svc.status('grok-cli'), (s) => s.session?.state === 'succeeded')
  })

  it('runs the CLI with GROK_HOME in the EYAS home, never the host HOME, key or browser (negative)', async () => {
    const cli = fakeCli('grok')
    const svc = makeService({ 'grok-cli': cli })
    await svc.start('grok-cli', { method: 'device' })
    await until(() => svc.status('grok-cli'), (s) => !!s.session?.verificationUrl)
    const env = envOf(cli)
    expect(env.HOME).toBe(join(homesDir, 'grok-cli'))
    expect(env.GROK_HOME).toBe(join(homesDir, 'grok-cli', '.grok'))
    expect(env.HOME).not.toBe(hostHome)
    expect(env.GROK_HOME).not.toBe(join(hostHome, '.grok'))
    expect(env.XAI_API_KEY).toBeUndefined()
    expect(env.BROWSER).toBe('true')
    expect(env.GROK_MEMORY).toBe('0')
    // The operator's own credential is untouched and never counts.
    writeFileSync(cli.trigger, '1')
    const done = await until(() => svc.status('grok-cli'), (s) => s.session?.state !== 'pending')
    expect(done.signedIn).toBe(false)
    expect(readFileSync(join(hostHome, '.grok', 'auth.json'), 'utf8')).toBe('{"token":"HOST"}')
  })

  it('kimi: JSON events are parsed, the credential lands in KIMI_SHARE_DIR (positive)', async () => {
    const cli = fakeCli('kimi')
    const svc = makeService({ 'kimi-cli': cli })
    await svc.start('kimi-cli', { method: 'device' })
    const shown = await until(() => svc.status('kimi-cli'), (s) => !!s.session?.verificationUrl)
    expect(shown.session).toMatchObject({ verificationUrl: 'https://auth.example.com/device?user_code=ABCD-EFGH', userCode: 'ABCD-EFGH' })
    expect(envOf(cli).KIMI_SHARE_DIR).toBe(join(homesDir, 'kimi-cli', '.kimi'))
    expect(readFileSync(cli.argvLog, 'utf8').trim()).toBe('login --json')
    writeFileSync(cli.trigger, '0')
    const done = await until(() => svc.status('kimi-cli'), (s) => s.session?.state !== 'pending')
    expect(done).toMatchObject({ signedIn: true, method: 'device', apiKeySupported: false })
  })

  it('kimi: an error event is the failure reason (negative)', async () => {
    const cli = fakeCli('kimi')
    const svc = makeService({ 'kimi-cli': cli })
    await svc.start('kimi-cli', { method: 'device' })
    await until(() => svc.status('kimi-cli'), (s) => !!s.session?.verificationUrl)
    writeFileSync(cli.trigger, '1')
    const done = await until(() => svc.status('kimi-cli'), (s) => s.session?.state !== 'pending')
    expect(done.session).toMatchObject({ state: 'failed', error: 'Login failed: access denied' })
  })

  it('an output EYAS cannot parse is shown raw instead of a link', async () => {
    const cli = fakeCli('garbled')
    const svc = makeService({ 'grok-cli': cli }, { rawPromptAfterMs: 50 })
    await svc.start('grok-cli', { method: 'device' })
    const shown = await until(() => svc.status('grok-cli'), (s) => !!s.session?.rawPrompt)
    expect(shown.session?.verificationUrl).toBeNull()
    expect(shown.session?.rawPrompt).toContain('Visit the portal and enter the magic words')
    writeFileSync(cli.trigger, '1')
  })

  it('cancel stops a pending sign-in; a confirmation that never comes expires', async () => {
    const cli = fakeCli('grok')
    const svc = makeService({ 'grok-cli': cli })
    await svc.start('grok-cli', { method: 'device' })
    await until(() => svc.status('grok-cli'), (s) => !!s.session?.verificationUrl)
    await svc.cancel('grok-cli')
    const cancelled = await until(() => svc.status('grok-cli'), (s) => s.session?.state !== 'pending')
    expect(cancelled.session?.state).toBe('cancelled')

    const slow = fakeCli('grok')
    const svc2 = makeService({ 'grok-cli': slow }, { deviceTimeoutMs: 300 })
    await svc2.start('grok-cli', { method: 'device' })
    const expired = await until(() => svc2.status('grok-cli'), (s) => s.session?.state !== 'pending')
    expect(expired.session?.state).toBe('expired')
    expect(expired.signedIn).toBe(false)
  })

  it('an executable that cannot be resolved fails the session instead of throwing (negative)', async () => {
    const svc = makeService({})
    const status = await svc.start('grok-cli', { method: 'device' })
    expect(status.session).toMatchObject({ state: 'failed' })
    expect(status.session?.error).toMatch(/no executable found/)
  })
})

// ─── Status, API key, sign-out ─────────────────

describe.skipIf(process.platform === 'win32')('status, API key and sign-out', () => {
  it('a credential file counts without being read; a symlinked one does not (negative)', async () => {
    const svc = makeService({})
    const grokDir = join(homesDir, 'grok-cli', '.grok')
    mkdirSync(grokDir, { recursive: true })
    symlinkSync(join(hostHome, '.grok', 'auth.json'), join(grokDir, 'auth.json'))
    expect(svc.isSignedIn('grok-cli')).toBe(false)
    rmSync(join(grokDir, 'auth.json'))
    writeFileSync(join(grokDir, 'auth.json'), '{"token":"EYAS"}')
    chmodSync(join(grokDir, 'auth.json'), 0o000)
    expect(svc.isSignedIn('grok-cli')).toBe(true)
    chmodSync(join(grokDir, 'auth.json'), 0o600)
  })

  it('an API key is stored in secrets and reaches grok only through the profile env (positive)', async () => {
    const secrets = fakeSecrets()
    const svc = makeService({}, { secrets })
    expect((await svc.status('grok-cli')).apiKeySupported).toBe(true)
    const status = await svc.start('grok-cli', { method: 'apiKey', apiKey: '  xai-EYAS-KEY-123  ' })
    expect(status).toMatchObject({ signedIn: true, method: 'apiKey', apiKeyStored: true })
    expect(secrets.store.get(`system:${GROK_CLI_API_KEY_SECRET}`)).toBe('xai-EYAS-KEY-123')
    expect(svc.profileEnv('grok-cli')).toEqual({ XAI_API_KEY: 'xai-EYAS-KEY-123' })
    const profile = createAcpProfile('grok-cli', { homesDir, sourceEnv: hostEnv(), extraEnv: () => svc.profileEnv('grok-cli') })
    expect(profile.env().XAI_API_KEY).toBe('xai-EYAS-KEY-123')
    expect(svc.profileEnv('kimi-cli')).toEqual({})
  })

  it('kimi has no API-key sign-in; without secrets grok has none either (negative)', async () => {
    const svc = makeService({}, { secrets: fakeSecrets() })
    await expect(svc.start('kimi-cli', { method: 'apiKey', apiKey: 'sk-0123456789' })).rejects.toBeInstanceOf(CliSignInRequestError)
    const bare = makeService({})
    expect((await bare.status('grok-cli')).apiKeySupported).toBe(false)
    await expect(bare.start('grok-cli', { method: 'apiKey', apiKey: 'xai-0123456789' })).rejects.toMatchObject({ code: 'secretsUnavailable' })
  })

  it('status picks up a key added or removed on the Secrets page; refresh re-reads it', async () => {
    const secrets = fakeSecrets()
    const svc = makeService({}, { secrets })
    expect((await svc.status('grok-cli')).signedIn).toBe(false)
    await secrets.set(GROK_CLI_API_KEY_SECRET, 'system', 'xai-FROM-SECRETS-PAGE')
    expect(await svc.status('grok-cli')).toMatchObject({ signedIn: true, method: 'apiKey' })
    await secrets.set(GROK_CLI_API_KEY_SECRET, 'system', 'xai-ROTATED-KEY')
    await svc.refresh('grok-cli')
    expect(svc.profileEnv('grok-cli')).toEqual({ XAI_API_KEY: 'xai-ROTATED-KEY' })
    await secrets.delete(GROK_CLI_API_KEY_SECRET, 'system')
    expect((await svc.status('grok-cli')).signedIn).toBe(false)
    expect(svc.profileEnv('grok-cli')).toEqual({})
  })

  it('grok sign-out runs `grok logout` through the profile, removes the credential and the stored key', async () => {
    const cli = fakeCli('grok')
    const secrets = fakeSecrets()
    const svc = makeService({ 'grok-cli': cli }, { secrets })
    const grokDir = join(homesDir, 'grok-cli', '.grok')
    mkdirSync(grokDir, { recursive: true })
    writeFileSync(join(grokDir, 'auth.json'), '{"token":"EYAS"}')
    await svc.start('grok-cli', { method: 'apiKey', apiKey: 'xai-0123456789' })
    const out: CliSignInStatus = await svc.signOut('grok-cli')
    expect(out).toMatchObject({ signedIn: false, method: null, apiKeyStored: false })
    expect(readFileSync(cli.argvLog, 'utf8').trim()).toBe('logout')
    expect(envOf(cli).GROK_HOME).toBe(grokDir)
    expect(existsSync(join(grokDir, 'auth.json'))).toBe(false)
    expect(secrets.store.size).toBe(0)
    expect(readFileSync(join(hostHome, '.grok', 'auth.json'), 'utf8')).toBe('{"token":"HOST"}')
  })

  it('kimi sign-out removes the EYAS credential itself and never runs `kimi logout` (it would clear the host keyring)', async () => {
    const cli = fakeCli('kimi')
    const svc = makeService({ 'kimi-cli': cli })
    const credentials = join(homesDir, 'kimi-cli', '.kimi', 'credentials')
    mkdirSync(credentials, { recursive: true })
    writeFileSync(join(credentials, 'kimi-code.json'), '{}')
    expect(svc.isSignedIn('kimi-cli')).toBe(true)
    const out = await svc.signOut('kimi-cli')
    expect(out.signedIn).toBe(false)
    expect(existsSync(join(credentials, 'kimi-code.json'))).toBe(false)
    expect(existsSync(cli.argvLog)).toBe(false)
  })

  it('sign-out of a never signed-in CLI does nothing; a planted credential link is unlinked, its target kept (negative)', async () => {
    const warn = vi.fn()
    const svc = createCliSignInService({
      profileFor: (id) => createAcpProfile(id, { homesDir, resolveExecutable: async () => { throw new Error('not installed') }, sourceEnv: hostEnv() }),
      logger: { info: () => {}, warn, debug: () => {} } as any,
    })
    service = svc
    expect((await svc.signOut('grok-cli')).signedIn).toBe(false)
    expect(warn).not.toHaveBeenCalled()

    const grokDir = join(homesDir, 'grok-cli', '.grok')
    mkdirSync(grokDir, { recursive: true })
    symlinkSync(join(hostHome, '.grok', 'auth.json'), join(grokDir, 'auth.json'))
    await svc.signOut('grok-cli')
    expect(existsSync(join(grokDir, 'auth.json'))).toBe(false)
    expect(readFileSync(join(hostHome, '.grok', 'auth.json'), 'utf8')).toBe('{"token":"HOST"}')
  })

  it('isolation status: signed out is auth-required, a sign-in clears it, a violation is kept', async () => {
    const secrets = fakeSecrets()
    const svc = makeService({}, { secrets })
    await svc.refresh('grok-cli')
    expect(getIsolationStatus('grok-cli').status).toBe('auth-required')
    await svc.start('grok-cli', { method: 'apiKey', apiKey: 'xai-0123456789' })
    expect(getIsolationStatus('grok-cli').status).toBe('unverified')

    setIsolationStatus('kimi-cli', { status: 'violation', checks: [{ check: 'hooks', detail: 'x' }], runtime: null })
    await svc.refresh('kimi-cli')
    expect(getIsolationStatus('kimi-cli').status).toBe('violation')

    // A preflight that could not run keeps its detail too; a bare 'verified' does not.
    resetIsolationStatuses()
    setIsolationStatus('kimi-cli', { status: 'unverified', checks: [{ check: 'unverified', detail: 'inspect failed' }], runtime: null })
    await svc.refresh('kimi-cli')
    expect(getIsolationStatus('kimi-cli')).toMatchObject({ status: 'unverified', checks: [{ check: 'unverified' }] })
    setIsolationStatus('kimi-cli', { status: 'verified', checks: [], runtime: null })
    await svc.refresh('kimi-cli')
    expect(getIsolationStatus('kimi-cli').status).toBe('auth-required')
  })
})

// ─── Turn failures ─────────────────────────────

describe('asCliSignInFailure / cliSignInError', () => {
  it('the sign-in error is a terminal auth failure with the cliSignIn code (positive)', () => {
    const err = cliSignInError('grok-cli')
    expect(err).toBeInstanceOf(CodedModelError)
    expect(classifyModelError(err)).toEqual({ kind: 'auth', retryable: false, code: 'cliSignIn', params: { provider: 'grok-cli' } })
    expect(err.message).toMatch(/does not use the host login/)
  })

  it('maps an ACP auth failure, or any failure while signed out (positive)', () => {
    const acp = asCliSignInFailure('kimi-cli', new Error('Authentication required'), () => true)
    expect(classifyModelError(acp).code).toBe('cliSignIn')
    const signedOut = asCliSignInFailure('grok-cli', new Error('grok-cli exited (code 1)'), () => false)
    expect(classifyModelError(signedOut).code).toBe('cliSignIn')
    expect((signedOut as CodedModelError & { cause?: unknown }).cause).toBeInstanceOf(Error)
  })

  it('leaves unrelated failures and already coded ones alone (negative)', () => {
    const boom = new Error('grok-cli exited (code 1)')
    expect(asCliSignInFailure('grok-cli', boom, () => true)).toBe(boom)
    expect(asCliSignInFailure('grok-cli', boom)).toBe(boom)
    const coded = new CodedModelError('isolation', 'cliIsolation', { provider: 'grok-cli' })
    expect(asCliSignInFailure('grok-cli', coded, () => false)).toBe(coded)
  })
})
