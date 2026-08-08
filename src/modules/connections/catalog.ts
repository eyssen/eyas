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
