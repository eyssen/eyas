// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The system/init message a real Claude Code CLI sends first on every query,
// for tests that fake the Agent SDK's query(). The provider's isolation
// tripwire refuses any answer that arrives without one, so every fake stream
// starts with this. By default it reports exactly what the query options asked
// for (cwd, the MCP servers EYAS passed, no plugins, 'default' permission
// mode); a test that wants a violation overrides the offending field.

export interface FakeClaudeInitOverrides {
  cwd?: string
  mcp_servers?: Array<{ name: string; status?: string }>
  plugins?: Array<{ name: string; path?: string }>
  permissionMode?: string
  claude_code_version?: string
  [key: string]: unknown
}

export function fakeClaudeInit(options: Record<string, any> | undefined, overrides: FakeClaudeInitOverrides = {}): Record<string, unknown> {
  const servers = Object.keys(options?.mcpServers ?? {}).map((name) => ({ name, status: 'connected' }))
  return {
    type: 'system',
    subtype: 'init',
    cwd: options?.cwd,
    claude_code_version: '2.1.280',
    permissionMode: 'default',
    mcp_servers: servers,
    plugins: [],
    tools: [],
    model: 'claude-sonnet',
    apiKeySource: 'none',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    uuid: '00000000-0000-4000-8000-000000000000',
    session_id: 'fake-session',
    ...overrides,
  }
}
