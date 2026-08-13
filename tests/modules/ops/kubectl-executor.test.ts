import { describe, it, expect } from 'vitest'
import { createKubectlExecutor } from '@modules/ops/actions/kubectl-executor'

// Fake spawn: returns a process-like object with exitCode + piped streams.
function fakeSpawn(out: string, code = 0, err = '') {
  return (_argv: string[]) => ({
    exited: Promise.resolve(code),
    get exitCode() { return code },
    stdout: new Response(out).body, stderr: new Response(err).body,
    kill() {},
  }) as any
}

it('returns honest error when disabled', async () => {
  const ex = createKubectlExecutor({ enabled: false, spawn: fakeSpawn('') })
  const r = await ex.exec('get', ['pods'])
  expect(r.ok).toBe(false); expect(r.error).toMatch(/disabled/i)
})
it('rejects a command not on the read-only allow-list', async () => {
  const ex = createKubectlExecutor({ enabled: true, spawn: fakeSpawn('') })
  const r = await ex.exec('delete', ['pod', 'x'])
  expect(r.ok).toBe(false); expect(r.error).toMatch(/not allowed/i)
})
it('rejects an unsafe argument', async () => {
  const ex = createKubectlExecutor({ enabled: true, spawn: fakeSpawn('') })
  const r = await ex.exec('get', ['pods;rm -rf /'])
  expect(r.ok).toBe(false); expect(r.error).toMatch(/argument/i)
})
it('rejects a denied identity/connection-override flag at exec time (M-3)', async () => {
  const ex = createKubectlExecutor({ enabled: true, spawn: fakeSpawn('') })
  const r = await ex.exec('get', ['pods', '--as=system:admin'])
  expect(r.ok).toBe(false); expect(r.error).toMatch(/argument/i)
})
it('runs an allow-listed command and returns stdout', async () => {
  const ex = createKubectlExecutor({ enabled: true, spawn: fakeSpawn('pod/a Running') })
  const r = await ex.exec('get', ['pods', '-n', 'default'])
  expect(r.ok).toBe(true); expect(r.output).toContain('pod/a Running')
})
it('maps a non-zero exit to an honest error', async () => {
  const ex = createKubectlExecutor({ enabled: true, spawn: fakeSpawn('', 1, 'boom') })
  const r = await ex.exec('get', ['pods'])
  expect(r.ok).toBe(false); expect(r.error).toContain('boom')
})
