import { describe, it, expect } from 'vitest'
import {
  issueBridgeSecret,
  revokeBridgeSecret,
  buildAcpMcpServerConfig,
} from '@modules/model/cli-mcp/bridge-routes'

describe('CLI MCP bridge config', () => {
  it('issues unique secrets', () => {
    const a = issueBridgeSecret()
    const b = issueBridgeSecret()
    expect(a).not.toBe(b)
    expect(a.startsWith('eyas-mcp-')).toBe(true)
    revokeBridgeSecret(a)
    revokeBridgeSecret(b)
  })

  it('draws secrets from the CSPRNG, not from a time-seeded generator', () => {
    const secrets = Array.from({ length: 50 }, () => issueBridgeSecret())
    expect(new Set(secrets).size).toBe(50)

    // The secret authenticates a bridge session, so it needs real entropy:
    // at least 128 bits of random material after the prefix.
    for (const s of secrets) {
      expect(s.slice('eyas-mcp-'.length).length).toBeGreaterThanOrEqual(22)
    }

    // It must not encode the clock. Secrets built from Date.now() share a prefix
    // when issued in the same millisecond, which narrows a guess enormously.
    const stamp = Date.now().toString(36)
    expect(secrets.filter((s) => s.includes(stamp))).toHaveLength(0)

    secrets.forEach(revokeBridgeSecret)
  })

  it('builds ACP mcpServers entry with bun + env', () => {
    const secret = issueBridgeSecret()
    const cfg = buildAcpMcpServerConfig({
      baseUrl: 'http://127.0.0.1:3100',
      secret,
      installRoot: '/tmp/eyas',
      context: { conversationId: 'c1', agentId: 'a1' },
    })
    expect(cfg.name).toBe('eyas')
    expect(cfg.command).toBe('bun')
    expect(cfg.args[0]).toBe('run')
    expect(cfg.args[1]).toContain('stdio-mcp-server.ts')
    const env = Object.fromEntries(cfg.env.map((e) => [e.name, e.value]))
    expect(env.EYAS_MCP_BRIDGE_URL).toBe('http://127.0.0.1:3100')
    expect(env.EYAS_MCP_BRIDGE_SECRET).toBe(secret)
    expect(JSON.parse(env.EYAS_MCP_TOOL_CONTEXT).conversationId).toBe('c1')
    revokeBridgeSecret(secret)
  })
})
