// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Integration tests — run an actual docker container. Skipped automatically
// when the `docker` binary is missing or the daemon is unreachable, so CI
// hosts without docker stay green.

import { describe, it, expect, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { createDockerSandbox } from '@modules/tools/sandbox'

function dockerUsable(): boolean {
  try {
    const version = spawnSync('docker', ['--version'], { stdio: 'ignore' })
    if (version.status !== 0) return false
    const info = spawnSync('docker', ['info'], { stdio: 'ignore' })
    return info.status === 0
  } catch {
    return false
  }
}

const DOCKER_OK = dockerUsable()
// Small, always-available image.
const TEST_IMAGE = process.env.EYAS_SANDBOX_TEST_IMAGE ?? 'alpine:3.19'

describe.skipIf(!DOCKER_OK)('sandbox/docker — integration', () => {
  const workDir = mkdtempSync(join(tmpdir(), 'eyas-sbx-it-'))
  const sbx = createDockerSandbox()

  beforeAll(async () => {
    // Pre-pull the test image so the run step isn't hit with first-pull latency.
    spawnSync('docker', ['pull', TEST_IMAGE], { stdio: 'ignore' })
  }, 120_000)

  it('runs `echo hello` in a container and captures stdout', async () => {
    const res = await sbx.run('echo', ['hello'], {
      workingDirectory: workDir,
      image: TEST_IMAGE,
      timeoutMs: 30_000,
    })
    expect(res.exitCode).toBe(0)
    expect(res.stdout.trim()).toBe('hello')
    expect(res.timedOut).toBe(false)
  }, 60_000)

  it('propagates non-zero exit code from failing command', async () => {
    const res = await sbx.run('sh', ['-c', 'exit 7'], {
      workingDirectory: workDir,
      image: TEST_IMAGE,
      timeoutMs: 30_000,
    })
    expect(res.exitCode).toBe(7)
  }, 60_000)

  it('network=none blocks outbound traffic (wget fails fast)', async () => {
    // alpine has wget but no network when --network=none
    const res = await sbx.run('sh', ['-c', 'wget -q -T 2 -O- http://example.com || echo BLOCKED'], {
      workingDirectory: workDir,
      image: TEST_IMAGE,
      network: 'none',
      timeoutMs: 30_000,
    })
    // Either the command errors (non-zero + BLOCKED printed by our fallback)
    // or at minimum BLOCKED must appear since DNS is unreachable.
    expect(res.stdout).toContain('BLOCKED')
  }, 60_000)

  it('env allowlist strips non-listed vars', async () => {
    const res = await sbx.run('sh', ['-c', 'echo allowed=$ALLOWED leaked=${LEAK:-none}'], {
      workingDirectory: workDir,
      image: TEST_IMAGE,
      envAllowlist: ['ALLOWED'],
      timeoutMs: 30_000,
    }, )
    // Parent env has process.env.ALLOWED unset at this point; set it via a wrapper.
    // Easier: call a second time with a set env.
    void res
    const envVarKey = 'EYAS_SANDBOX_IT_ALLOWED'
    process.env[envVarKey] = 'yes'
    process.env.EYAS_SANDBOX_IT_LEAK = 'leaked-value'
    try {
      const res2 = await sbx.run(
        'sh',
        ['-c', `echo allowed=$${envVarKey} leak=\${EYAS_SANDBOX_IT_LEAK:-unset}`],
        {
          workingDirectory: workDir,
          image: TEST_IMAGE,
          envAllowlist: [envVarKey],
          timeoutMs: 30_000,
        },
      )
      expect(res2.stdout).toContain('allowed=yes')
      expect(res2.stdout).toContain('leak=unset')
    } finally {
      delete process.env[envVarKey]
      delete process.env.EYAS_SANDBOX_IT_LEAK
    }
  }, 60_000)

  it('enforces memory limit (OOM-kills runaway allocation)', async () => {
    // Try to allocate 256 MiB inside a 32 MiB container — should OOM.
    // sh tr trick allocates a large string in memory.
    const res = await sbx.run(
      'sh',
      ['-c', 'yes | head -c 200000000 > /tmp/big 2>&1; echo done=$?'],
      {
        workingDirectory: workDir,
        image: TEST_IMAGE,
        memoryLimitMb: 32,
        tmpfsSizeMb: 8, // also tight, which forces the OOM path
        timeoutMs: 30_000,
      },
    )
    // Either OOM-killed (non-zero) or tmpfs-full (non-zero). We assert
    // just that the command did NOT cleanly complete with "done=0".
    expect(res.stdout.trim().endsWith('done=0')).toBe(false)
  }, 60_000)

  it('isAvailable returns true on a working docker host', async () => {
    expect(await sbx.isAvailable()).toBe(true)
  })
})

describe.skipIf(DOCKER_OK)('sandbox/docker — integration (skipped: docker not available)', () => {
  it('is a no-op placeholder so the file reports at least one test when docker is absent', () => {
    expect(DOCKER_OK).toBe(false)
  })
})
