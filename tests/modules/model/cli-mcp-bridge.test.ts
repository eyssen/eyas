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
