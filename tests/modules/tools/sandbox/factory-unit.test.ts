// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createDockerSandbox } from '@modules/tools/sandbox'

class MockChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  stdin = new PassThrough()
}

function makeSpawnFn(responder: (cmd: string, args: string[], child: MockChild) => void) {
  const fn: any = (cmd: string, args: string[]) => {
    const child = new MockChild()
    queueMicrotask(() => responder(cmd, args, child))
    return child
  }
  return fn
}

describe('sandbox/index — createDockerSandbox', () => {
  it('isAvailable returns true when `docker --version` exits 0', async () => {
    const fn = makeSpawnFn((cmd, args, child) => {
      expect(cmd).toBe('docker')
      expect(args).toEqual(['--version'])
      child.emit('close', 0)
    })
    const sbx = createDockerSandbox({ spawnFn: fn })
    expect(await sbx.isAvailable()).toBe(true)
  })

  it('isAvailable returns false when docker CLI exits non-zero', async () => {
    const fn = makeSpawnFn((_cmd, _args, child) => child.emit('close', 127))
    const sbx = createDockerSandbox({ spawnFn: fn })
    expect(await sbx.isAvailable()).toBe(false)
  })

  it('isAvailable returns false and logs warn when spawn errors', async () => {
    const warns: unknown[] = []
    const fn: any = () => {
      const child = new MockChild()
      queueMicrotask(() => child.emit('error', new Error('ENOENT docker')))
      return child
    }
    const sbx = createDockerSandbox({
      spawnFn: fn,
      logger: {
        info: () => {},
        warn: (o) => warns.push(o),
        debug: () => {},
      },
    })
    expect(await sbx.isAvailable()).toBe(false)
    expect(warns.length).toBeGreaterThan(0)
  })

  it('isAvailable with probeDaemon=true also runs `docker info`', async () => {
    const seen: string[][] = []
    const fn: any = (cmd: string, args: string[]) => {
      seen.push([cmd, ...args])
      const child = new MockChild()
      queueMicrotask(() => child.emit('close', 0))
      return child
    }
    const sbx = createDockerSandbox({ spawnFn: fn, probeDaemon: true })
    expect(await sbx.isAvailable()).toBe(true)
    expect(seen[0]).toEqual(['docker', '--version'])
    expect(seen[1]).toEqual(['docker', 'info'])
  })

  it('isAvailable with probeDaemon=true returns false when daemon unreachable', async () => {
    let step = 0
    const fn: any = () => {
      const child = new MockChild()
      queueMicrotask(() => {
        if (step === 0) { step++; child.emit('close', 0) } // version ok
        else child.emit('close', 1) // info fails
      })
      return child
    }
    const sbx = createDockerSandbox({ spawnFn: fn, probeDaemon: true })
    expect(await sbx.isAvailable()).toBe(false)
  })

  it('run delegates to runInContainer with the injected spawnFn', async () => {
    const fn: any = (cmd: string, args: string[]) => {
      const child = new MockChild()
      queueMicrotask(() => {
        // Only handle the run; ignore kill for this test.
        if (args[0] === 'run') {
          child.stdout.write('ok')
          child.emit('close', 0)
        } else {
          child.emit('close', 0)
        }
        void cmd
      })
      return child
    }
    const sbx = createDockerSandbox({ spawnFn: fn })
    const res = await sbx.run('echo', ['ok'], { workingDirectory: '/tmp' })
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toBe('ok')
  })
})
