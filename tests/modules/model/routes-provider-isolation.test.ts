// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K6 — GET /api/v1/model/providers/:id/isolation (read Model) and POST
// …/isolation/verify (manage Model): the provider panel's Runtime line,
// isolation status and Verify now. The runtime comes from the real resolver,
// pointed at throwaway executables in a temp dir (no real CLI, no model call).

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { Hono, type MiddlewareHandler } from 'hono'
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { errorHandler } from '@core/http/middleware/error-handler'
import { createModelRoutes } from '@modules/model/routes'
import { createModelGateway } from '@modules/model/gateway'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { buildAbilityForRole } from '@modules/permissions/roles'
import type { RoleId } from '@modules/permissions/types'
import type { CliSignInService } from '@modules/model/cli-runtime/sign-in'
import {
  getExecutablePolicy,
  registerExecutablePolicy,
  type ExecutablePolicy,
} from '@modules/model/cli-runtime/executables.js'
import { registerIsolationVerifier, resetIsolationStatuses, setIsolationStatus } from '@modules/model/cli-runtime/isolation.js'
import { CLI_VERIFIED_VERSIONS } from '@modules/model/cli-runtime/verified-versions.js'

const GROK_ENV = 'EYAS_TEST_K6_GROK_BIN'
const CLAUDE_ENV = 'EYAS_TEST_K6_CLAUDE_BIN'

let tmp: string
let original: { grok: ExecutablePolicy; claude: ExecutablePolicy }

function script(name: string, body: string): string {
  const path = join(tmp, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-k6-iso-')))
  original = { grok: getExecutablePolicy('grok-cli')!, claude: getExecutablePolicy('claude-code')! }
  // Only the override variable resolves: PATH and the SDK-bundled copy are never consulted.
  registerExecutablePolicy({ id: 'grok-cli', overrideEnv: GROK_ENV, hostNames: [], remedy: 'test' })
  registerExecutablePolicy({ id: 'claude-code', overrideEnv: CLAUDE_ENV, hostNames: [], remedy: 'test' })
  process.env[GROK_ENV] = script('grok', `echo "grok ${CLI_VERIFIED_VERSIONS['grok-cli'].version ?? '1.0.0'}"`)
  // `auth status --json` reports signed out (and exits 1, as the real CLI does).
  process.env[CLAUDE_ENV] = script('claude', [
    'if [ "$1" = "--version" ]; then echo "2.1.281 (Claude Code)"; exit 0; fi',
    'if [ "$1" = "auth" ]; then echo \'{"loggedIn":false}\'; exit 1; fi',
    'exit 2',
  ].join('\n'))
})

afterAll(() => {
  delete process.env[GROK_ENV]
  delete process.env[CLAUDE_ENV]
  registerExecutablePolicy(original.grok)
  registerExecutablePolicy(original.claude)
  rmSync(tmp, { recursive: true, force: true })
})

afterEach(() => {
  registerIsolationVerifier('grok-cli', null)
  registerIsolationVerifier('kimi-cli', null)
  resetIsolationStatuses()
})

function asRole(role: RoleId | null): MiddlewareHandler {
  const registry = createPermissionRegistry()
  return async (c, next) => {
    if (role) {
      c.set('userId' as never, 'u1' as never)
      c.set('role' as never, role as never)
      c.set('ability' as never, buildAbilityForRole(role, registry) as never)
    }
    await next()
  }
}

function signIn(signedIn: boolean): CliSignInService {
  return { isSignedIn: () => signedIn } as unknown as CliSignInService
}

function app(role: RoleId | null, cliSignIn?: CliSignInService) {
  const hono = new Hono()
  hono.onError(errorHandler)
  createModelRoutes(hono, createModelGateway(), asRole(role), undefined, undefined, undefined, undefined, undefined, cliSignIn)
  return hono
}

describe('GET /api/v1/model/providers/:id/isolation', () => {
  it('(+) any role that may read models gets the runtime, sign-in, status and proof', async () => {
    setIsolationStatus('grok-cli', { status: 'violation', checks: [{ check: 'hooks', detail: 'a hook in the home' }], runtime: null })
    for (const role of ['owner', 'user'] as const) {
      const res = await app(role, signIn(true)).request('/api/v1/model/providers/grok-cli/isolation')
      expect(res.status, role).toBe(200)
      const body = await res.json() as any
      expect(body).toMatchObject({
        providerId: 'grok-cli',
        status: 'violation',
        checks: [{ check: 'hooks', detail: 'a hook in the home' }],
        runtime: { available: true, path: process.env[GROK_ENV], source: 'override', version: CLI_VERIFIED_VERSIONS['grok-cli'].version },
        hostCli: null,
        signedIn: true,
        canVerify: false,
      })
      expect(body.proof.drift).toBe(CLI_VERIFIED_VERSIONS['grok-cli'].version ? 'match' : 'never-verified')
    }
  })

  it('(+) Claude Code reads its own sign-in from the resolved binary', async () => {
    const res = await app('owner').request('/api/v1/model/providers/claude-code/isolation')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body).toMatchObject({ providerId: 'claude-code', status: 'unverified', signedIn: false, canVerify: false })
    expect(body.runtime).toMatchObject({ available: true, source: 'override', version: '2.1.281' })
  })

  it('(−) a role that may not read models (guest) is 403 — no CLI is run and no sign-in is looked up', async () => {
    const ranMarker = join(tmp, 'claude-ran')
    const saved = process.env[CLAUDE_ENV]
    // A binary that records every run: any version or `auth status` probe leaves the marker.
    process.env[CLAUDE_ENV] = script('claude-recording', `touch '${ranMarker}'\necho "2.1.281 (Claude Code)"`)
    const isSignedIn = vi.fn(() => true)
    try {
      for (const id of ['claude-code', 'grok-cli']) {
        const res = await app('guest', { isSignedIn } as unknown as CliSignInService).request(`/api/v1/model/providers/${id}/isolation`)
        expect(res.status, id).toBe(403)
        const body = await res.json() as Record<string, unknown>
        expect(body, id).not.toHaveProperty('runtime')
        expect(JSON.stringify(body), id).not.toContain(tmp)
      }
      expect(existsSync(ranMarker), 'a CLI process was started').toBe(false)
      expect(isSignedIn).not.toHaveBeenCalled()
      // Control: a role that may read models does run it (the recorder works).
      expect((await app('owner').request('/api/v1/model/providers/claude-code/isolation')).status).toBe(200)
      expect(existsSync(ranMarker)).toBe(true)
    } finally {
      process.env[CLAUDE_ENV] = saved
    }
  })

  it('(−) a provider without CLI isolation is 404; no session is 401', async () => {
    for (const id of ['anthropic', 'opencode', 'claude-code-sdk']) {
      expect((await app('owner').request(`/api/v1/model/providers/${id}/isolation`)).status, id).toBe(404)
    }
    expect((await app(null).request('/api/v1/model/providers/grok-cli/isolation')).status).toBe(401)
  })
})

describe('POST /api/v1/model/providers/:id/isolation/verify', () => {
  const post = { method: 'POST' }

  it('(+) the owner runs the registered verifier and gets the view it produced', async () => {
    const verify = vi.fn(async () => {
      setIsolationStatus('grok-cli', { status: 'verified', checks: [], runtime: null })
    })
    registerIsolationVerifier('grok-cli', verify)
    const res = await app('owner', signIn(true)).request('/api/v1/model/providers/grok-cli/isolation/verify', post)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ providerId: 'grok-cli', status: 'verified', canVerify: true })
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('(−) a role without manage Model gets 403 and nothing runs', async () => {
    const verify = vi.fn(async () => {})
    registerIsolationVerifier('grok-cli', verify)
    for (const role of ['user', 'agent'] as const) {
      expect((await app(role).request('/api/v1/model/providers/grok-cli/isolation/verify', post)).status, role).toBe(403)
    }
    expect(verify).not.toHaveBeenCalled()
  })

  it('(−) Claude Code, or a provider that is not loaded, has no verifier: 409 verifyUnavailable', async () => {
    for (const id of ['claude-code', 'kimi-cli']) {
      const res = await app('owner').request(`/api/v1/model/providers/${id}/isolation/verify`, post)
      expect(res.status, id).toBe(409)
      expect(await res.json(), id).toMatchObject({ code: 'verifyUnavailable' })
    }
  })

  it('(−) an unknown provider is 404', async () => {
    expect((await app('owner').request('/api/v1/model/providers/anthropic/isolation/verify', post)).status).toBe(404)
  })
})
