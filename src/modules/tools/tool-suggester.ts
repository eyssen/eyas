// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolRegistry } from './tool-registry.js'

/** Task context for tool suggestion */
export interface TaskContext {
  goal: string
  category?: string
  keywords?: string[]
  activeTools?: string[]
}

/** A single tool suggestion with relevance score */
export interface ToolSuggestion {
  name: string
  score: number
  reason: string
}

export interface ToolSuggester {
  suggest(ctx: TaskContext, limit?: number): ToolSuggestion[]
  categorizeTask(goal: string): string
}

/** Keyword sets for task category classification */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  coding: [
    'code', 'implement', 'fix', 'bug', 'refactor', 'function', 'class', 'module',
    'test', 'compile', 'build', 'lint', 'debug', 'pr', 'commit', 'branch', 'merge',
    'develop', 'programming', 'typescript', 'python', 'javascript',
  ],
  research: [
    'search', 'find', 'look up', 'investigate', 'what is', 'how to',
    'documentation', 'compare', 'analyze', 'learn', 'explore', 'discover',
  ],
  communication: [
    'send', 'email', 'message', 'slack', 'notify', 'share', 'post',
    'announce', 'meeting', 'schedule', 'chat', 'reply', 'forward',
  ],
  devops: [
    'deploy', 'docker', 'kubernetes', 'k8s', 'container', 'pod', 'pipeline',
    'ci', 'cd', 'server', 'infrastructure', 'monitor', 'logs', 'helm', 'nginx',
  ],
  data: [
    'database', 'query', 'sql', 'table', 'migration', 'schema', 'csv',
    'import', 'export', 'etl', 'transform', 'dataset', 'aggregate',
  ],
  design: [
    'ui', 'frontend', 'component', 'layout', 'style', 'css', 'page',
    'widget', 'form', 'responsive', 'tailwind', 'figma',
  ],
}

/** Tool name patterns associated with each task category */
const CATEGORY_TOOL_PATTERNS: Record<string, string[]> = {
  coding: [
    'mcp_git_', 'mcp_filesystem_', 'mcp_vscode_', 'mcp_github_', 'mcp_e2b_',
    'shell_', 'mcp_playwright_',
    // EYAS model-agnostic coding surface
    'read_', 'write_', 'edit_', 'grep', 'glob', 'run_command', 'git_',
    // Ground code changes in indexed sources — do not invent APIs/paths.
    'search_', 'list_search_',
    'odoo_search_',
  ],
  research: [
    'mcp_brave-search_', 'mcp_exa_', 'mcp_tavily_', 'mcp_fetch_', 'mcp_context7_',
    'search_', 'list_search_',
  ],
  communication: [
    'mcp_slack_', 'mcp_notion_', 'conversation_',
  ],
  devops: [
    'mcp_docker_', 'mcp_kubernetes_', 'mcp_cloudflare_', 'mcp_sentry_',
    'shell_',
    'search_',
  ],
  data: [
    'mcp_prisma_', 'mcp_supabase_', 'mcp_qdrant_', 'mcp_obsidian_',
    // Schema/query work should hit indexed code/docs when available.
    'search_', 'list_search_',
  ],
  design: [
    'mcp_figma_', 'mcp_playwright_', 'mcp_browser_',
  ],
}

/** Tool patterns that are always useful regardless of category */
const ALWAYS_USEFUL_PATTERNS = ['mcp_memory_', 'mcp_sequential-thinking_', 'memory_']

function matchesAnyPattern(name: string, patterns: string[]): boolean {
  return patterns.some(p => name.startsWith(p))
}

function normalizeGoal(goal: string): string {
  return goal.toLowerCase()
}

export function createToolSuggester(registry: ToolRegistry): ToolSuggester {
  function categorizeTask(goal: string): string {
    const lower = normalizeGoal(goal)
    let bestCategory = 'coding' // default fallback
    let bestCount = 0

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      let count = 0
      for (const kw of keywords) {
        // Use word boundary matching for short keywords to avoid false positives
        if (kw.includes(' ')) {
          if (lower.includes(kw)) count++
        } else {
          const regex = new RegExp(`\\b${kw}\\b`, 'i')
          if (regex.test(lower)) count++
        }
      }
      if (count > bestCount) {
        bestCount = count
        bestCategory = category
      }
    }

    return bestCategory
  }

  function suggest(ctx: TaskContext, limit = 10): ToolSuggestion[] {
    const category = ctx.category ?? categorizeTask(ctx.goal)
    const goalLower = normalizeGoal(ctx.goal)
    const keywords = ctx.keywords?.map(k => k.toLowerCase()) ?? []
    const activeSet = new Set(ctx.activeTools ?? [])

    const categoryPatterns = CATEGORY_TOOL_PATTERNS[category] ?? []
    const allTools = registry.list()
    const suggestions: ToolSuggestion[] = []

    for (const tool of allTools) {
      let score = 0
      const reasons: string[] = []

      // Category pattern match → base 0.7
      if (matchesAnyPattern(tool.name, categoryPatterns)) {
        score = 0.7
        reasons.push(`matches ${category} category`)
      }

      // Always-useful tools → base 0.3
      if (matchesAnyPattern(tool.name, ALWAYS_USEFUL_PATTERNS)) {
        score = Math.max(score, 0.3)
        if (reasons.length === 0) reasons.push('always useful utility tool')
      }

      // Keyword match in tool name or description → +0.2
      const nameAndDesc = `${tool.name} ${tool.description}`.toLowerCase()
      const matchedKeywords = keywords.filter(kw => nameAndDesc.includes(kw))
      if (matchedKeywords.length > 0) {
        score += 0.2
        reasons.push(`keyword match: ${matchedKeywords.join(', ')}`)
      }

      // Goal text match in tool description → +0.2
      if (score === 0) {
        // Check if any words from the goal appear in tool name/description
        const goalWords = goalLower.split(/\s+/).filter(w => w.length > 3)
        const goalMatches = goalWords.filter(w => nameAndDesc.includes(w))
        if (goalMatches.length >= 2) {
          score = 0.4
          reasons.push(`goal text overlap: ${goalMatches.slice(0, 3).join(', ')}`)
        }
      }

      // Active tool familiarity boost → +0.1
      if (activeSet.has(tool.name)) {
        score += 0.1
        reasons.push('recently used')
      }

      // Only include tools with a score
      if (score > 0) {
        suggestions.push({
          name: tool.name,
          score: Math.min(score, 1), // cap at 1.0
          reason: reasons.join('; '),
        })
      }
    }

    // Sort by score descending, then alphabetically for stable ordering
    suggestions.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))

    return suggestions.slice(0, limit)
  }

  return { suggest, categorizeTask }
}
