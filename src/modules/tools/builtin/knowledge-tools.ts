// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolImplementation } from '../types.js'

/** `getService` resolves `ctx.knowledge`, which only exists after knowledge.onStart. */
export function createKnowledgeTools(getService: () => any): ToolImplementation[] {
  const NOT_READY = { error: 'Knowledge module not ready yet — try again shortly' }

  return [
    {
      name: 'search_knowledge',
      description: 'Search wiki pages in the knowledge base. Matches page titles and body text, and returns the page id, title and a snippet.',
      category: 'knowledge',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for wiki content' },
          spaceSlug: { type: 'string', description: 'Limit search to a specific knowledge space' },
          limit: { type: 'number', description: 'Maximum number of results (default: 10)' },
        },
        required: ['query'],
      },
      execute: async (input) => {
        const service = getService()
        if (!service) return NOT_READY

        const results = service.searchPages(input.query as string, {
          spaceSlug: input.spaceSlug as string | undefined,
          limit: input.limit as number | undefined,
        })
        return { results }
      },
    },
    {
      name: 'get_page',
      description: 'Retrieve the full content of a wiki page by its ID.',
      category: 'knowledge',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          pageId: { type: 'string', description: 'The unique identifier of the wiki page' },
        },
        required: ['pageId'],
      },
      execute: async (input) => {
        const service = getService()
        if (!service) return NOT_READY

        const page = service.getPage(input.pageId as string)
        if (!page) return { error: `Page not found: ${input.pageId as string}` }
        return { page }
      },
    },
    {
      name: 'create_page',
      description: 'Create a new wiki page in a knowledge space. Returns the created page with its ID.',
      category: 'knowledge',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          spaceId: { type: 'string', description: 'The knowledge space to create the page in' },
          title: { type: 'string', description: 'Page title' },
          content: { type: 'string', description: 'Page content' },
          parentId: { type: 'string', description: 'Parent page ID for nesting (optional)' },
        },
        required: ['spaceId', 'title', 'content'],
      },
      execute: async (input) => {
        const service = getService()
        if (!service) return NOT_READY

        // `content` is the agent-facing name for what the service stores as
        // `body` (rendered) plus `contentText` (plain-text search copy). The
        // service ignores an unknown `content` key, so mapping it here is what
        // keeps agent-authored pages from being saved empty.
        const content = input.content as string
        const page = service.createPage({
          spaceId: input.spaceId as string,
          title: input.title as string,
          body: content,
          contentText: content,
          parentId: input.parentId as string | undefined,
        })
        return { created: true, page }
      },
    },
  ]
}
