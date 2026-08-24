import { describe, it, expect } from 'vitest'
import { parseBackendPort, readBackendPort } from '../../src/web/backend-port'

describe('Vite dev proxy backend port', () => {
  it('reads server.port from yaml', () => {
    expect(parseBackendPort('server:\n  host: "0.0.0.0"\n  port: 3200\n')).toBe(3200)
  })

  it('falls back to 3100 when server.port is absent', () => {
    expect(parseBackendPort('database:\n  path: data/eyas.db\n')).toBe(3100)
  })

  it('falls back to 3100 for empty yaml', () => {
    expect(parseBackendPort('')).toBe(3100)
  })

  it('reads the checked-in config/default.yaml as a valid port', () => {
    const port = readBackendPort('config/default.yaml')
    expect(port).toBe(3100)
  })

  it('falls back to 3100 for a missing file', () => {
    expect(readBackendPort('/tmp/nonexistent-eyas-config-xyz.yaml')).toBe(3100)
  })
})
