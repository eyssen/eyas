// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { McpTransportType } from './types.js'

// ── Types ────────────────────────────────────────────────────────────────────

/** Installation tier for MCP servers */
export type McpTier = 'bundled' | 'one-click' | 'manual'

/** License compatibility classification */
export type McpLicenseCompat = 'mit-compatible' | 'copyleft' | 'proprietary' | 'unknown'

/** Category for MCP server classification */
export type McpCategory =
  | 'DevTools'
  | 'Search'
  | 'Database'
  | 'Browser'
  | 'AI'
  | 'Communication'
  | 'Knowledge'
  | 'DevOps'
  | 'IDE'
  | 'Business'
  | 'Web'

/** Registry entry for a known MCP server */
export interface McpRegistryEntry {
  id: string
  name: string
  description: string
  tier: McpTier
  license: string
  licenseCompat: McpLicenseCompat
  author: string
  repoUrl: string
  transport: McpTransportType
  command?: string
  args?: string[]
  envKeys?: string[]
  category: McpCategory
  icon: string
  tags: string[]
  setupGuide?: string
}

// ── Registry ─────────────────────────────────────────────────────────────────

/**
 * Built-in MCP server registry.
 *
 * Servers are NOT bundled with EYAS — they are installed on-demand via npx
 * or manually by the user. This catalog provides discovery and one-click setup.
 *
 * Tiers:
 *  - bundled:   MIT-compatible, no API key, install-and-go
 *  - one-click: MIT-compatible, requires API key configuration
 *  - manual:    Non-MIT or complex setup, user installs independently
 */
export const mcpServerRegistry: McpRegistryEntry[] = [

  // ═══════════════════════════════════════════════════════════════════════════
  // Tier 1 — Bundled (MIT-compatible, no API key needed)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Secure file operations with configurable directory restrictions.',
    tier: 'bundled',
    license: 'MIT',
    licenseCompat: 'mit-compatible',
    author: 'Anthropic',
    repoUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/eyas-workspace'],
    category: 'DevTools',
    icon: '📁',
    tags: ['filesystem', 'files', 'directories', 'read', 'write'],
  },
  {
    id: 'git',
    name: 'Git',
    description: 'Repository operations: diff, log, blame, commit, and branch management.',
    tier: 'bundled',
    license: 'MIT',
    licenseCompat: 'mit-compatible',
    author: 'Anthropic',
    repoUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-git'],
    category: 'DevTools',
    icon: '🔀',
    tags: ['git', 'version-control', 'diff', 'commit', 'blame'],
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Knowledge graph-based persistent memory for entities and relations.',
    tier: 'bundled',
    license: 'MIT',
    licenseCompat: 'mit-compatible',
    author: 'Anthropic',
    repoUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    category: 'AI',
    icon: '🧠',
    tags: ['memory', 'knowledge-graph', 'entities', 'relations', 'persistence'],
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Dynamic reasoning with reflection, branching, and revision capabilities.',
    tier: 'bundled',
    license: 'MIT',
    licenseCompat: 'mit-compatible',
    author: 'Anthropic',
    repoUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequentialthinking'],
    category: 'AI',
    icon: '💭',
    tags: ['reasoning', 'thinking', 'reflection', 'chain-of-thought'],
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: 'Web content fetching and conversion to markdown for LLM consumption.',
    tier: 'bundled',
    license: 'MIT',
    licenseCompat: 'mit-compatible',
    author: 'Anthropic',
    repoUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    category: 'Web',
    icon: '🌐',
    tags: ['fetch', 'http', 'web', 'markdown', 'scraping'],
  },
  {
    id: 'playwright',
    name: 'Playwright',
    description: 'Browser automation and testing with full page interaction support.',
    tier: 'bundled',
    license: 'Apache-2.0',
    licenseCompat: 'mit-compatible',
    author: 'Microsoft',
    repoUrl: 'https://github.com/playwright-community/mcp',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@playwright/mcp'],
    category: 'Browser',
    icon: '🎭',
    tags: ['browser', 'automation', 'testing', 'playwright', 'e2e'],
  },
  {
    id: 'docker',
    name: 'Docker',
    description: 'Container and image management — build, run, inspect, and compose.',
    tier: 'bundled',
    license: 'MIT',
    licenseCompat: 'mit-compatible',
    author: 'Docker Inc.',
    repoUrl: 'https://github.com/docker/mcp-server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@docker/mcp-server'],
    category: 'DevOps',
    icon: '🐳',
    tags: ['docker', 'containers', 'images', 'compose', 'devops'],
  },
  {
    id: 'e2b',
    name: 'E2B Code Sandbox',
    description: 'Sandboxed code execution in isolated cloud environments.',
    tier: 'bundled',
    license: 'Apache-2.0',
    licenseCompat: 'mit-compatible',
    author: 'E2B',
    repoUrl: 'https://github.com/e2b-dev/mcp-server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@e2b/mcp-server'],
    category: 'DevTools',
    icon: '📦',
    tags: ['sandbox', 'code-execution', 'isolated', 'cloud'],
  },
  {
    id: 'context7',
    name: 'Context7',
    description: 'Up-to-date library documentation search with version-aware results.',
    tier: 'bundled',
    license: 'MIT',
    licenseCompat: 'mit-compatible',
    author: 'Upstash',
    repoUrl: 'https://github.com/upstash/context7',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    category: 'Knowledge',
    icon: '📚',
    tags: ['documentation', 'libraries', 'search', 'context', 'api-docs'],
  },
  {
    id: 'prisma',
    name: 'Prisma',
    description: 'PostgreSQL database management with schema introspection and migrations.',
    tier: 'bundled',
    license: 'Apache-2.0',
    licenseCompat: 'mit-compatible',
    author: 'Prisma',
    repoUrl: 'https://github.com/prisma/prisma',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@prisma/mcp'],
    category: 'Database',
    icon: '💎',
    tags: ['prisma', 'database', 'postgresql', 'schema', 'migrations'],
  },
  {
    id: 'qdrant',
    name: 'Qdrant',
    description: 'Vector search and semantic memory with collection management.',
    tier: 'bundled',
    license: 'Apache-2.0',
    licenseCompat: 'mit-compatible',
    author: 'Qdrant',
    repoUrl: 'https://github.com/qdrant/mcp-server-qdrant',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-server-qdrant'],
    category: 'Database',
    icon: '🔮',
    tags: ['vector', 'search', 'semantic', 'embeddings', 'qdrant'],
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    description: 'Obsidian vault access for reading and searching notes and knowledge.',
    tier: 'bundled',
    license: 'MIT',
    licenseCompat: 'mit-compatible',
    author: 'MarkusPfworlds',
    repoUrl: 'https://github.com/MarkusPfworlds/mcp-obsidian',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-obsidian'],
    category: 'Knowledge',
    icon: '🪨',
    tags: ['obsidian', 'notes', 'knowledge', 'markdown', 'vault'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Tier 2 — One-click (MIT-compatible, requires API key)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'github',
    name: 'GitHub',
    description: 'Issues, PRs, repos, code search, and review management.',
    tier: 'one-click',
    license: 'MIT',
    licenseCompat: 'mit-compatible',
    author: 'GitHub',
    repoUrl: 'https://github.com/github/github-mcp-server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@github/mcp-server'],
    envKeys: ['GITHUB_TOKEN'],
    category: 'DevTools',
    icon: '🐙',
    tags: ['github', 'issues', 'pull-requests', 'repos', 'code-search'],
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Privacy-focused web and local search with AI snippets.',
    tier: 'one-click',
    license: 'MIT',
    licenseCompat: 'mit-compatible',
    author: 'Anthropic',
    repoUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    envKeys: ['BRAVE_API_KEY'],
    category: 'Search',
    icon: '🦁',
    tags: ['search', 'web', 'brave', 'privacy', 'local-search'],
  },
  {
    id: 'exa',
    name: 'Exa',
    description: 'AI-optimized semantic search with neural retrieval.',
    tier: 'one-click',
    license: 'MIT',
    licenseCompat: 'mit-compatible',
    author: 'Exa AI',
    repoUrl: 'https://github.com/exa-labs/exa-mcp-server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'exa-mcp-server'],
    envKeys: ['EXA_API_KEY'],
    category: 'Search',
    icon: '🔎',
    tags: ['search', 'semantic', 'neural', 'ai-search', 'exa'],
  },
  {
    id: 'tavily',
    name: 'Tavily',
    description: 'AI agent search with content extraction and real-time results.',
    tier: 'one-click',
    license: 'MIT',
    licenseCompat: 'mit-compatible',
    author: 'Tavily',
    repoUrl: 'https://github.com/tavily-ai/tavily-mcp',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'tavily-mcp'],
    envKeys: ['TAVILY_API_KEY'],
    category: 'Search',
    icon: '🔍',
    tags: ['search', 'ai-agent', 'extraction', 'real-time', 'tavily'],
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    description: 'Web scraping and crawling optimized for LLM consumption.',
    tier: 'one-click',
    license: 'MIT',
    licenseCompat: 'mit-compatible',
    author: 'Mendable',
    repoUrl: 'https://github.com/mendableai/firecrawl-mcp-server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'firecrawl-mcp'],
    envKeys: ['FIRECRAWL_API_KEY'],
    category: 'Web',
    icon: '🔥',
    tags: ['scraping', 'crawling', 'web', 'markdown', 'firecrawl'],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Channel management, messages, threads, and user interaction.',
    tier: 'one-click',
    license: 'MIT',
    licenseCompat: 'mit-compatible',
    author: 'Anthropic',
    repoUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    envKeys: ['SLACK_BOT_TOKEN'],
    category: 'Communication',
    icon: '💬',
    tags: ['slack', 'messaging', 'channels', 'threads', 'communication'],
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Workspace, pages, and databases management with rich content.',
    tier: 'one-click',
    license: 'MIT',
    licenseCompat: 'mit-compatible',
    author: 'Notion',
    repoUrl: 'https://github.com/notionhq/notion-mcp-server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@notionhq/notion-mcp-server'],
    envKeys: ['NOTION_TOKEN'],
    category: 'Knowledge',
    icon: '📝',
    tags: ['notion', 'workspace', 'pages', 'databases', 'wiki'],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Payment processing, subscriptions, and financial management.',
    tier: 'one-click',
    license: 'MIT',
    licenseCompat: 'mit-compatible',
    author: 'Stripe',
    repoUrl: 'https://github.com/stripe/agent-toolkit',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@stripe/agent-toolkit'],
    envKeys: ['STRIPE_SECRET_KEY'],
    category: 'Business',
    icon: '💳',
    tags: ['stripe', 'payments', 'subscriptions', 'billing', 'finance'],
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'Workers, KV, R2 storage, and D1 database management.',
    tier: 'one-click',
    license: 'Apache-2.0',
    licenseCompat: 'mit-compatible',
    author: 'Cloudflare',
    repoUrl: 'https://github.com/cloudflare/mcp-server-cloudflare',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@cloudflare/mcp-server-cloudflare'],
    envKeys: ['CF_API_TOKEN'],
    category: 'DevOps',
    icon: '☁️',
    tags: ['cloudflare', 'workers', 'kv', 'r2', 'd1', 'cdn'],
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Postgres database, auth, and storage management.',
    tier: 'one-click',
    license: 'Apache-2.0',
    licenseCompat: 'mit-compatible',
    author: 'Supabase',
    repoUrl: 'https://github.com/supabase-community/supabase-mcp',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'supabase-mcp'],
    envKeys: ['SUPABASE_URL', 'SUPABASE_ANON_KEY'],
    category: 'Database',
    icon: '⚡',
    tags: ['supabase', 'postgres', 'auth', 'storage', 'realtime'],
  },
  {
    id: 'kubernetes',
    name: 'Kubernetes',
    description: 'Cluster management — pods, deployments, services, and logs.',
    tier: 'one-click',
    license: 'Apache-2.0',
    licenseCompat: 'mit-compatible',
    author: 'Community',
    repoUrl: 'https://github.com/stoolap/kubernetes-mcp-server',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'kubernetes-mcp-server'],
    envKeys: ['KUBECONFIG'],
    category: 'DevOps',
    icon: '☸️',
    tags: ['kubernetes', 'k8s', 'pods', 'deployments', 'cluster'],
  },
  {
    id: 'browserbase',
    name: 'Browserbase',
    description: 'Cloud browser sessions for web automation and scraping at scale.',
    tier: 'one-click',
    license: 'Apache-2.0',
    licenseCompat: 'mit-compatible',
    author: 'Browserbase',
    repoUrl: 'https://github.com/browserbase/mcp-server-browserbase',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@browserbase/mcp-server-browserbase'],
    envKeys: ['BROWSERBASE_API_KEY'],
    category: 'Browser',
    icon: '🌍',
    tags: ['browser', 'cloud', 'automation', 'scraping', 'browserbase'],
  },
  {
    id: 'vscode',
    name: 'VS Code',
    description: 'VS Code editing, diagnostics, terminal, and symbol navigation.',
    tier: 'one-click',
    license: 'MIT',
    licenseCompat: 'mit-compatible',
    author: 'Community',
    repoUrl: 'https://github.com/nicepkg/vscode-mcp',
    transport: 'http',
    category: 'IDE',
    icon: '💻',
    tags: ['vscode', 'editor', 'diagnostics', 'terminal', 'ide'],
    setupGuide:
      '## Setup VS Code MCP Server\n\n' +
      '### 1. Install the Extension\n' +
      'Search for "MCP Server" in VS Code Extensions marketplace and install it.\n\n' +
      '### 2. Enable the MCP Server\n' +
      'Open VS Code settings and enable the MCP server endpoint.\n' +
      'Default URL: `http://localhost:3100`\n\n' +
      '### 3. Connect from EYAS\n' +
      'Add the server in EYAS Settings > MCP Servers with transport "http" ' +
      'and the URL from step 2.',
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Tier 3 — Manual (non-MIT license or complex setup)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Error tracking, performance monitoring, and issue management.',
    tier: 'manual',
    license: 'FSL-1.1-ALv2',
    licenseCompat: 'proprietary',
    author: 'Sentry',
    repoUrl: 'https://github.com/getsentry/sentry-mcp',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@sentry/mcp-server'],
    envKeys: ['SENTRY_AUTH_TOKEN'],
    category: 'DevOps',
    icon: '🐛',
    tags: ['sentry', 'errors', 'monitoring', 'performance', 'issues'],
    setupGuide:
      '## Setup Sentry MCP Server\n\n' +
      '### License Notice\n' +
      'Sentry MCP uses the FSL-1.1-ALv2 (Functional Source License) which ' +
      'converts to Apache-2.0 after 2 years. During the FSL period, it may NOT ' +
      'be used to compete with Sentry\'s commercial offerings.\n\n' +
      '### 1. Get Auth Token\n' +
      'Create a token at https://sentry.io/settings/auth-tokens/\n\n' +
      '### 2. Configure\n' +
      'Set `SENTRY_AUTH_TOKEN` in EYAS Settings > MCP Servers.',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Issue tracking, project management, and team workflows.',
    tier: 'manual',
    license: 'Proprietary',
    licenseCompat: 'proprietary',
    author: 'Linear',
    repoUrl: 'https://linear.app',
    transport: 'http',
    category: 'Business',
    icon: '📐',
    tags: ['linear', 'issues', 'project-management', 'tracking', 'workflow'],
    setupGuide:
      '## Setup Linear MCP Server\n\n' +
      '### License Notice\n' +
      'Linear MCP is a proprietary hosted service requiring OAuth authentication.\n\n' +
      '### 1. Create OAuth App\n' +
      'Go to Linear Settings > API > OAuth Applications.\n\n' +
      '### 2. Configure\n' +
      'Set the HTTP endpoint and OAuth credentials in EYAS Settings > MCP Servers.',
  },
  {
    id: 'grafana-mcp',
    name: 'Grafana MCP',
    description: 'Metrics, logs, and traces dashboard interaction and querying.',
    tier: 'manual',
    license: 'AGPL-3.0',
    licenseCompat: 'copyleft',
    author: 'Grafana Labs',
    repoUrl: 'https://github.com/grafana/mcp-grafana',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@grafana/mcp-server'],
    envKeys: ['GRAFANA_URL', 'GRAFANA_API_KEY'],
    category: 'DevOps',
    icon: '📊',
    tags: ['grafana', 'metrics', 'logs', 'traces', 'monitoring', 'observability'],
    setupGuide:
      '## Setup Grafana MCP Server\n\n' +
      '### License Notice\n' +
      'Grafana MCP is licensed under AGPL-3.0. It runs as a separate process — ' +
      'EYAS communicates via stdio, no code linking. EYAS itself remains MIT licensed.\n\n' +
      '### 1. Prerequisites\n' +
      'A running Grafana instance (self-hosted or Grafana Cloud).\n\n' +
      '### 2. Get API Key\n' +
      'Create a service account token in Grafana > Administration > Service Accounts.\n\n' +
      '### 3. Configure\n' +
      'Set `GRAFANA_URL` and `GRAFANA_API_KEY` in EYAS Settings > MCP Servers.',
  },
]
