// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ConnectionSystemType } from './types.js'

/**
 * Static catalog of external systems EYAS can track as Connections.
 * Adapters realize the link (MCP server, native module, HTTP API).
 * Skills under config/skills/integrations remain the how-to layer.
 */
export const CONNECTION_CATALOG: ConnectionSystemType[] = [
  {
    id: 'odoo',
    name: 'Odoo',
    description: 'Odoo ERP / Helpdesk via JSON-RPC (native client + ticket tools).',
    adapter: 'native',
    nativeModuleId: 'odoo',
    category: 'Business',
    icon: '📦',
    skillName: undefined,
    setupIntro: 'URL, database name, username, and an API key (or password).',
    setupSteps: [
      'Open Odoo → Settings → Users → your user → Account Security → New API Key (or use password).',
      'Note the instance base URL (https://…) and database name.',
      'Create a connection below and paste credentials; they go into the secrets vault.',
      'Run Test to verify authentication.',
    ],
    configFields: [
      { name: 'url', label: 'Base URL', required: true, placeholder: 'https://odoo.example.com' },
      { name: 'db', label: 'Database', required: true, placeholder: 'prod' },
      { name: 'username', label: 'Username', required: true, placeholder: 'admin@example.com' },
    ],
    secretFields: [
      {
        name: 'api-key',
        label: 'API key / password',
        required: true,
        sensitive: true,
        hint: 'Stored as connection-scoped secret in the vault',
      },
    ],
    tags: ['erp', 'tickets', 'helpdesk'],
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'GitHub REST API — repos, issues, PRs, releases.',
    adapter: 'http',
    category: 'DevTools',
    icon: '🐙',
    skillName: 'github-integration',
    setupIntro: 'A Personal Access Token (classic or fine-grained) with the scopes you need.',
    setupSteps: [
      'GitHub → Settings → Developer settings → Personal access tokens.',
      'Create a token with repo (or fine-grained repo access) as needed.',
      'Optionally set org / default owner in config.',
      'Save and Test (calls GET /user).',
    ],
    configFields: [
      { name: 'baseUrl', label: 'API base URL', required: false, placeholder: 'https://api.github.com' },
      { name: 'org', label: 'Default org / owner', required: false, placeholder: 'eyssen' },
    ],
    secretFields: [
      { name: 'token', label: 'Personal access token', required: true, sensitive: true },
    ],
    tags: ['git', 'issues', 'prs'],
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'GitLab REST API — projects, issues, MRs.',
    adapter: 'http',
    category: 'DevTools',
    icon: '🦊',
    skillName: 'gitlab-integration',
    configFields: [
      { name: 'baseUrl', label: 'GitLab URL', required: true, placeholder: 'https://gitlab.com' },
    ],
    secretFields: [
      { name: 'token', label: 'Personal access token', required: true, sensitive: true },
    ],
    tags: ['git', 'mr'],
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Linear GraphQL API for issues and projects.',
    adapter: 'http',
    category: 'Business',
    icon: '📐',
    skillName: 'linear-integration',
    configFields: [
      { name: 'teamId', label: 'Default team ID', required: false },
    ],
    secretFields: [
      { name: 'api-key', label: 'API key', required: true, sensitive: true },
    ],
    tags: ['issues', 'pm'],
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Notion API for pages and databases.',
    adapter: 'http',
    category: 'Knowledge',
    icon: '📝',
    skillName: 'notion-integration',
    configFields: [],
    secretFields: [
      { name: 'token', label: 'Integration token', required: true, sensitive: true },
    ],
    tags: ['wiki', 'docs'],
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Atlassian Jira Cloud REST API.',
    adapter: 'http',
    category: 'Business',
    icon: '🎫',
    skillName: 'jira-integration',
    configFields: [
      { name: 'baseUrl', label: 'Site URL', required: true, placeholder: 'https://your-domain.atlassian.net' },
      { name: 'email', label: 'Account email', required: true },
    ],
    secretFields: [
      { name: 'api-token', label: 'API token', required: true, sensitive: true },
    ],
    tags: ['issues', 'atlassian'],
  },
  {
    id: 'slack',
    name: 'Slack (API)',
    description: 'Slack Web API bot token for workspace tools (chat channel is separate under Communication).',
    adapter: 'http',
    category: 'Communication',
    icon: '💬',
    skillName: 'slack-integration',
    configFields: [
      { name: 'workspace', label: 'Workspace label', required: false },
    ],
    secretFields: [
      { name: 'bot-token', label: 'Bot user OAuth token', required: true, sensitive: true, placeholder: 'xoxb-…' },
    ],
    tags: ['chat', 'workspace'],
  },
  {
    id: 'mcp',
    name: 'MCP server',
    description: 'Link a connection inventory entry to an MCP client server (tools already discovered by the MCP module).',
    adapter: 'mcp',
    category: 'Integrations',
    icon: '🔌',
    setupIntro: 'Register the MCP server under Settings → MCP Servers first, then link it here by server id or name.',
    setupSteps: [
      'Settings → MCP Servers → add / install the server and connect it.',
      'Copy the server id from the list (or use its name).',
      'Create a connection of type MCP and paste mcpServerId or mcpServerName.',
      'Test verifies the MCP client reports that server as connected.',
    ],
    configFields: [
      { name: 'mcpServerId', label: 'MCP server id', required: false, hint: 'Preferred: stable id from /mcp/servers' },
      { name: 'mcpServerName', label: 'MCP server name', required: false },
    ],
    secretFields: [],
    tags: ['mcp', 'tools'],
  },
  {
    id: 'playwright-mcp',
    name: 'Playwright MCP',
    description:
      'Microsoft @playwright/mcp — accessibility snapshot and element refs (Apache-2.0 npx sidecar). Optional Playwright MCP Bridge extension for a live Chrome/Edge tab. Agent tools arrive through the MCP bridge. Not the Python browser-use MCP.',
    adapter: 'mcp',
    category: 'Browser',
    icon: '🎭',
    setupIntro:
      'Optional. Install from Settings → MCP Servers → Catalog → Playwright MCP, then link the server here so Test can doctor it (Node 18+, npx). Telemetry off. Never --no-sandbox.',
    setupSteps: [
      'Settings → MCP Servers → Catalog → Playwright MCP → Install (npx -y @playwright/mcp@latest --isolated).',
      'Do not install the Python browser-use MCP — it asks for an LLM API key and exposes retry_with_browser_use_agent.',
      'For a live tab, install the Playwright MCP Bridge extension and switch args to --extension (drop --isolated). Never the daily Chrome profile.',
      'Create a connection of this type. mcpServerName defaults to playwright (the catalog install name).',
      'Test runs the fail-closed doctor (Node 18+, npx) then checks the MCP server is connected. Tools appear as mcp_playwright_* on the agent.',
    ],
    configFields: [
      { name: 'mcpServerName', label: 'MCP server name', required: false, placeholder: 'playwright', hint: 'Catalog install uses name "playwright"' },
      { name: 'mcpServerId', label: 'MCP server id', required: false, hint: 'Preferred: stable id from /mcp/servers' },
    ],
    secretFields: [],
    tags: ['mcp', 'browser', 'playwright', 'a11y'],
  },
  {
    id: 'agent-browser',
    name: 'Agent Browser',
    description:
      'Vercel agent-browser — Apache-2.0 Rust CLI+MCP, @e1 snapshot refs, state save/load, domain allowlist. No LLM in the sidecar. Agent tools arrive through the MCP bridge. Not chat, not the Python browser-use MCP, not the daily Chrome profile.',
    adapter: 'mcp',
    category: 'Browser',
    icon: '🧭',
    setupIntro:
      'Optional. Install the CLI (`npm i -g agent-browser` then `agent-browser install`, or set EYAS_AGENT_BROWSER_BIN), then Settings → MCP Servers → Catalog → Agent Browser. Telemetry off. Never --no-sandbox. Never chat.',
    setupSteps: [
      'Install agent-browser on PATH or set EYAS_AGENT_BROWSER_BIN. Then `agent-browser install` (Chrome for Testing).',
      'Settings → MCP Servers → Catalog → Agent Browser → Install (`agent-browser mcp --tools core,state`).',
      'Do not install mcp-agent-browser (wrapper) or the Python browser-use MCP.',
      'Profile is EYAS-owned under data/browser/agent-browser/profile. Never --profile Default or the daily Chrome profile (Chrome 136+).',
      'Create a connection of this type. mcpServerName defaults to agent-browser.',
      'Test runs the fail-closed doctor (binary + doctor --offline --quick --json) then checks the MCP server is connected. Tools appear as mcp_agent_browser_* on the agent.',
    ],
    configFields: [
      { name: 'mcpServerName', label: 'MCP server name', required: false, placeholder: 'agent-browser', hint: 'Catalog install uses name "agent-browser"' },
      { name: 'mcpServerId', label: 'MCP server id', required: false, hint: 'Preferred: stable id from /mcp/servers' },
    ],
    secretFields: [],
    tags: ['mcp', 'browser', 'agent-browser', 'a11y'],
  },
  {
    id: 'chrome-devtools-mcp',
    name: 'Chrome DevTools MCP',
    description:
      'Google chrome-devtools-mcp — live Chrome console, network, Lighthouse, and WebMCP (Apache-2.0 npx sidecar). Coding/debug lane, not form-filling. Agent tools arrive through the MCP bridge. WebMCP tools only if the sidecar advertises them. Not the Python browser-use MCP, not the daily Chrome profile.',
    adapter: 'mcp',
    category: 'DevTools',
    icon: '🐞',
    skillName: 'chrome-devtools-mcp',
    setupIntro:
      'Optional. Install from Settings → MCP Servers → Catalog → Chrome DevTools MCP, then link the server here so Test can doctor it (Node 18+, npx). Telemetry off. Never --no-sandbox. Never --autoConnect (daily Chrome). Not form-filling.',
    setupSteps: [
      'Settings → MCP Servers → Catalog → Chrome DevTools MCP → Install (npx -y chrome-devtools-mcp@latest --isolated, telemetry off, WebMCP category on).',
      'Do not use this server to fill forms — that is native browser_* / Playwright MCP / agent-browser.',
      'Never --autoConnect and never --user-data-dir pointing at the daily Chrome profile (Chrome 136+). Catalog uses --isolated.',
      'Create a connection of this type. mcpServerName defaults to chrome-devtools (the catalog install name).',
      'Test runs the fail-closed doctor (Node 18+, npx) then checks the MCP server is connected. Tools appear as mcp_chrome-devtools_* on the agent. WebMCP tools only if the sidecar lists them.',
    ],
    configFields: [
      { name: 'mcpServerName', label: 'MCP server name', required: false, placeholder: 'chrome-devtools', hint: 'Catalog install uses name "chrome-devtools"' },
      { name: 'mcpServerId', label: 'MCP server id', required: false, hint: 'Preferred: stable id from /mcp/servers' },
    ],
    secretFields: [],
    tags: ['mcp', 'chrome', 'devtools', 'debug', 'lighthouse', 'webmcp'],
  },
  {
    id: 'magnific',
    name: 'Magnific',
    description: 'Image, video, audio, 3D, and Magnific upscale via hosted Magnific MCP (OAuth).',
    adapter: 'mcp',
    category: 'AI',
    icon: '✨',
    setupIntro: 'OAuth — open Settings → Media and click Connect, or install the Magnific MCP catalog row.',
    setupSteps: [
      'Open Settings → Media and click Connect on Magnific.',
      'Sign in with OAuth in the browser, then return to EYAS.',
      'Test verifies the Magnific MCP server reports connected.',
    ],
    configFields: [
      { name: 'mcpServerName', label: 'MCP server name', required: false, placeholder: 'magnific' },
      { name: 'mcpServerId', label: 'MCP server id', required: false },
    ],
    secretFields: [],
    tags: ['mcp', 'media', 'image', 'upscale'],
  },
  {
    id: 'higgsfield',
    name: 'Higgsfield',
    description: 'Image and video generation via hosted Higgsfield MCP (OAuth).',
    adapter: 'mcp',
    category: 'AI',
    icon: '🎬',
    setupIntro: 'OAuth — open Settings → Media and click Connect.',
    setupSteps: [
      'Open Settings → Media and click Connect on Higgsfield.',
      'Sign in with OAuth in the browser, then return to EYAS.',
      'Test verifies the Higgsfield MCP server reports connected.',
    ],
    configFields: [
      { name: 'mcpServerName', label: 'MCP server name', required: false, placeholder: 'higgsfield' },
      { name: 'mcpServerId', label: 'MCP server id', required: false },
    ],
    secretFields: [],
    tags: ['mcp', 'media', 'image', 'video'],
  },
  {
    id: 'fal',
    name: 'fal',
    description: '1,000+ generative models via hosted fal MCP (Bearer API key).',
    adapter: 'mcp',
    category: 'AI',
    icon: '🟣',
    setupIntro: 'Create a key at fal.ai → API Keys. Store it as fal-api-key, then Connect under Settings → Media.',
    setupSteps: [
      'Create an API key at fal.ai → API Keys.',
      'Save it as fal-api-key in EYAS Secrets (system, trusted).',
      'Open Settings → Media and click Connect on fal.',
    ],
    configFields: [
      { name: 'mcpServerName', label: 'MCP server name', required: false, placeholder: 'fal' },
      { name: 'mcpServerId', label: 'MCP server id', required: false },
    ],
    secretFields: [
      { name: 'api-key', label: 'API key', required: true, sensitive: true, hint: 'Also stored as fal-api-key for the Media adapter' },
    ],
    tags: ['mcp', 'media', 'image', 'video'],
  },
  {
    id: 'custom-http',
    name: 'Custom HTTP',
    description: 'Generic REST endpoint with bearer or API-key auth — for one-off systems.',
    adapter: 'http',
    category: 'Integrations',
    icon: '🌐',
    configFields: [
      { name: 'baseUrl', label: 'Base URL', required: true, placeholder: 'https://api.example.com' },
      { name: 'healthPath', label: 'Health path', required: false, placeholder: '/health', hint: 'GET relative path for Test' },
      {
        name: 'authHeader',
        label: 'Auth header name',
        required: false,
        placeholder: 'Authorization',
        hint: 'Default Authorization: Bearer <token>',
      },
    ],
    secretFields: [
      { name: 'token', label: 'Token / API key', required: false, sensitive: true },
    ],
    tags: ['rest', 'custom'],
  },
]

const byId = new Map(CONNECTION_CATALOG.map((e) => [e.id, e]))

export function getSystemType(id: string): ConnectionSystemType | undefined {
  return byId.get(id)
}

export function listSystemTypes(): ConnectionSystemType[] {
  return [...CONNECTION_CATALOG]
}

/**
 * Resolve vault secret name for a connection field.
 * Pattern: `conn-{connectionId}-{fieldName}` so multi-instance is safe.
 */
export function connectionSecretName(connectionId: string, fieldName: string): string {
  const safeField = fieldName.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase()
  return `conn-${connectionId}-${safeField}`
}
