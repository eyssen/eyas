import { describe, it, expect } from 'vitest'
import { resolveServerBinding } from '../../src/cli/commands/serve'
import { isProcessRunning, readPidFile, writePidFile, removePidFile } from '../../src/cli/utils/process-control'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync } from 'fs'

const config = { server: { host: '0.0.0.0', port: 3100 } }

describe('resolveServerBinding', () => {
  it('uses config host/port when no CLI flags are passed', () => {
    expect(resolveServerBinding({}, config)).toEqual({ host: '0.0.0.0', port: 3100 })
  })

  it('lets --port override the config port', () => {
    expect(resolveServerBinding({ port: '3200' }, config)).toEqual({ host: '0.0.0.0', port: 3200 })
  })

  it('lets --host override the config host', () => {
    expect(resolveServerBinding({ host: '127.0.0.1' }, config)).toEqual({ host: '127.0.0.1', port: 3100 })
  })

  it('honours both overrides together', () => {
    expect(resolveServerBinding({ host: '127.0.0.1', port: '8080' }, config)).toEqual({
      host: '127.0.0.1',
      port: 8080,
    })
  })
})

describe('process-control pidfile', () => {
  const dir = join(tmpdir(), `eyas-pid-${Date.now()}`)
  const pidFile = join(dir, 'eyas.pid')

  it('writes, reads, and removes a pidfile', () => {
    mkdirSync(dir, { recursive: true })
    writePidFile(pidFile, process.pid)
    expect(readPidFile(pidFile)).toBe(process.pid)
    expect(isProcessRunning(process.pid)).toBe(true)
    removePidFile(pidFile)
    expect(readPidFile(pidFile)).toBeNull()
    rmSync(dir, { recursive: true })
  })
})
