import { describe, it, expect, beforeEach } from 'vitest'
import { createToolSuggester, type ToolSuggester, type TaskContext } from '@modules/tools/tool-suggester'
import { createToolRegistry } from '@modules/tools/tool-registry'
import type { ToolRegistry } from '@modules/tools/tool-registry'
import type { ToolImplementation } from '@modules/tools/types'

function makeTool(name: string, description: string, category: ToolImplementation['category'] = 'custom'): ToolImplementation {
  return {
    name,
    description,
    category,
    riskTier: 'green',
    inputSchema: {},
    execute: async () => ({}),
  }
}

describe('ToolSuggester', () => {
  let registry: ToolRegistry
  let suggester: ToolSuggester

  beforeEach(() => {
    registry = createToolRegistry()

    // Register a realistic set of tools
    const tools: ToolImplementation[] = [
      makeTool('mcp_git_commit', 'Create a git commit'),
      makeTool('mcp_git_diff', 'Show git diff'),
      makeTool('mcp_github_create_pr', 'Create a pull request on GitHub'),
      makeTool('mcp_filesystem_read', 'Read a file from disk'),
      makeTool('mcp_filesystem_write', 'Write a file to disk'),
      makeTool('mcp_brave-search_search', 'Search the web using Brave'),
      makeTool('mcp_exa_search', 'Search using Exa API'),
      makeTool('mcp_tavily_search', 'Search using Tavily'),
      makeTool('mcp_fetch_url', 'Fetch a URL'),
      makeTool('mcp_context7_resolve', 'Resolve library documentation'),
      makeTool('mcp_slack_send', 'Send a Slack message'),
      makeTool('mcp_notion_create_page', 'Create a Notion page'),
      makeTool('mcp_docker_run', 'Run a Docker container'),
      makeTool('mcp_kubernetes_apply', 'Apply Kubernetes manifest'),
      makeTool('mcp_cloudflare_dns', 'Manage Cloudflare DNS'),
      makeTool('mcp_sentry_query', 'Query Sentry errors'),
      makeTool('mcp_prisma_query', 'Run Prisma query'),
      makeTool('mcp_supabase_sql', 'Run SQL on Supabase'),
      makeTool('mcp_memory_store', 'Store a memory', 'memory'),
      makeTool('mcp_memory_recall', 'Recall stored memories', 'memory'),
      makeTool('mcp_sequential-thinking_think', 'Sequential thinking tool'),
      makeTool('mcp_playwright_navigate', 'Navigate browser with Playwright'),
      makeTool('mcp_e2b_execute', 'Execute code in E2B sandbox'),
      makeTool('shell_exec', 'Execute a shell command', 'shell'),
      makeTool('search_hybrid', 'Hybrid search across indexes', 'search'),
      makeTool('memory_store', 'Store to EYAS memory', 'memory'),
      makeTool('conversation_reply', 'Reply in a conversation', 'conversation'),
    ]
    for (const t of tools) registry.register(t)

    suggester = createToolSuggester(registry)
  })

  describe('categorizeTask', () => {
    it('classifies coding goals', () => {
      expect(suggester.categorizeTask('Fix the bug in the login module')).toBe('coding')
      expect(suggester.categorizeTask('Implement a new function for parsing')).toBe('coding')
      expect(suggester.categorizeTask('Refactor the class hierarchy')).toBe('coding')
    })

    it('classifies research goals', () => {
      expect(suggester.categorizeTask('Search for documentation on React hooks')).toBe('research')
      expect(suggester.categorizeTask('How to configure Nginx reverse proxy')).toBe('research')
      expect(suggester.categorizeTask('Investigate the performance issue and analyze logs')).toBe('research')
    })

    it('classifies communication goals', () => {
      expect(suggester.categorizeTask('Send a message to the team on Slack')).toBe('communication')
      expect(suggester.categorizeTask('Schedule a meeting and notify participants')).toBe('communication')
    })

    it('classifies devops goals', () => {
      expect(suggester.categorizeTask('Deploy the Docker container to Kubernetes')).toBe('devops')
      expect(suggester.categorizeTask('Monitor server logs and check the pipeline')).toBe('devops')
    })

    it('classifies data goals', () => {
      expect(suggester.categorizeTask('Run a SQL query on the database')).toBe('data')
      expect(suggester.categorizeTask('Export the table to CSV and transform it')).toBe('data')
    })

    it('classifies design goals', () => {
      expect(suggester.categorizeTask('Create a responsive UI component with Tailwind CSS')).toBe('design')
      expect(suggester.categorizeTask('Update the form layout and page style')).toBe('design')
    })

    it('defaults to coding for ambiguous goals', () => {
      expect(suggester.categorizeTask('do something interesting')).toBe('coding')
    })
  })

  describe('suggest', () => {
    it('returns coding tools for coding tasks', () => {
      const results = suggester.suggest({ goal: 'Fix a bug in the authentication module' })
      const names = results.map(r => r.name)

      expect(names).toContain('mcp_git_commit')
      expect(names).toContain('mcp_filesystem_read')
      expect(names).toContain('mcp_github_create_pr')
      // Indexed search is part of coding so agents ground changes in real code/docs.
      expect(names).toContain('search_hybrid')
    })

    it('returns search tools for data tasks', () => {
      const results = suggester.suggest({ goal: 'Run a SQL query on the database schema' })
      const names = results.map(r => r.name)

      expect(names).toContain('mcp_prisma_query')
      expect(names).toContain('search_hybrid')
    })

    it('returns search tools for research tasks', () => {
      const results = suggester.suggest({ goal: 'Search for information about WebSocket protocols' })
      const names = results.map(r => r.name)

      expect(names).toContain('mcp_brave-search_search')
      expect(names).toContain('mcp_exa_search')
      expect(names).toContain('mcp_tavily_search')
    })

    it('returns relevant MCP tools by name pattern', () => {
      const results = suggester.suggest({ goal: 'Deploy to Kubernetes cluster', category: 'devops' })
      const names = results.map(r => r.name)

      expect(names).toContain('mcp_docker_run')
      expect(names).toContain('mcp_kubernetes_apply')
      expect(names).toContain('mcp_cloudflare_dns')
    })

    it('respects limit parameter', () => {
      const results = suggester.suggest({ goal: 'Fix a bug in the code' }, 3)
      expect(results.length).toBeLessThanOrEqual(3)
    })

    it('always includes always-useful tools in suggestions', () => {
      const codingResults = suggester.suggest({ goal: 'Fix a bug' }, 20)
      const researchResults = suggester.suggest({ goal: 'Search for docs' }, 20)
      const devopsResults = suggester.suggest({ goal: 'Deploy container' }, 20)

      for (const results of [codingResults, researchResults, devopsResults]) {
        const names = results.map(r => r.name)
        // At least one memory/thinking tool should be present
        const hasAlwaysUseful = names.some(
          n => n.startsWith('mcp_memory_') || n.startsWith('mcp_sequential-thinking_') || n.startsWith('memory_')
        )
        expect(hasAlwaysUseful).toBe(true)
      }
    })

    it('boosts score for active tools', () => {
      const ctx: TaskContext = {
        goal: 'Fix a bug in the code',
        activeTools: ['mcp_memory_store'],
      }
      const results = suggester.suggest(ctx, 20)
      const memoryTool = results.find(r => r.name === 'mcp_memory_store')

      expect(memoryTool).toBeDefined()
      // Should have base 0.3 (always useful) + 0.1 (active) = 0.4
      expect(memoryTool!.score).toBeCloseTo(0.4, 1)
      expect(memoryTool!.reason).toContain('recently used')
    })

    it('boosts score for keyword matches', () => {
      const ctx: TaskContext = {
        goal: 'Fix a bug',
        category: 'coding',
        keywords: ['git', 'commit'],
      }
      const results = suggester.suggest(ctx, 20)
      const gitCommit = results.find(r => r.name === 'mcp_git_commit')

      expect(gitCommit).toBeDefined()
      // Should have 0.7 (category) + 0.2 (keyword) = 0.9
      expect(gitCommit!.score).toBeCloseTo(0.9, 1)
    })

    it('returns scores between 0 and 1', () => {
      const results = suggester.suggest({ goal: 'Do everything possible' }, 50)
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0)
        expect(r.score).toBeLessThanOrEqual(1)
      }
    })

    it('results are sorted by score descending', () => {
      const results = suggester.suggest({ goal: 'Search for documentation' })
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
      }
    })

    it('uses explicit category over inferred one', () => {
      const results = suggester.suggest({ goal: 'Fix a bug', category: 'devops' })
      const names = results.map(r => r.name)

      // Should use devops patterns, not coding
      expect(names).toContain('mcp_docker_run')
      expect(names).toContain('mcp_kubernetes_apply')
    })

    it('returns empty when no tools match', () => {
      const emptyRegistry = createToolRegistry()
      const emptySuggester = createToolSuggester(emptyRegistry)
      const results = emptySuggester.suggest({ goal: 'Fix a bug' })
      expect(results).toEqual([])
    })
  })
})
