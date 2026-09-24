// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { ToolContext, ToolImplementation, ToolResult } from '@modules/tools/types.js'
import type { StudioGateway } from '../../types.js'

const NOT_READY = { error: 'Studio module not ready yet — try again shortly' }
const ENGINE = 'hyperframes'
const RENDER_TIMEOUT_MS = 600_000

function errorOf(err: unknown): ToolResult {
  return { error: err instanceof Error ? err.message : String(err) }
}

export function createHyperframesTools(deps: {
  getGateway: () => StudioGateway | undefined
}): ToolImplementation[] {
  return [
    {
      name: 'hyperframes_status',
      description:
        'Check whether the Hyperframes studio engine can render: Node.js 22+, FFmpeg, CLI, chrome-headless-shell. Returns remedies when something is missing. Call this before hyperframes_render.',
      category: 'custom',
      riskTier: 'green',
      inputSchema: { type: 'object', properties: {} },
      validator: z.object({}).passthrough(),
      execute: async () => {
        const gw = deps.getGateway()
        if (!gw) return NOT_READY
        try {
          const engine = gw.getEngine(ENGINE)
          if (!engine) return { error: 'Hyperframes engine is not registered. Open /studio.' }
          return await engine.status()
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'hyperframes_create',
      description:
        'Scaffold a Hyperframes composition project (index.html with a 5s title clip). Returns project id and directory. Then use hyperframes_write to replace the HTML.',
      category: 'custom',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Project title' },
        },
        required: ['title'],
      },
      validator: z.object({ title: z.string().min(1).max(200) }),
      execute: async (input, ctx) => {
        const gw = deps.getGateway()
        if (!gw) return NOT_READY
        try {
          const project = await gw.createProject({
            engineId: ENGINE,
            title: String(input.title),
            conversationId: ctx?.conversationId,
            userId: ctx?.userId,
            agentId: ctx?.agentId,
          })
          return { project }
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'hyperframes_write',
      description:
        'Write or replace a file inside a Hyperframes project (HTML/CSS/JS/JSON/media text). Path must be relative. Typical: index.html for the composition.',
      category: 'custom',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          path: { type: 'string', description: 'Relative path, e.g. index.html' },
          content: { type: 'string' },
        },
        required: ['projectId', 'path', 'content'],
      },
      validator: z.object({
        projectId: z.string().min(1),
        path: z.string().min(1).max(500),
        content: z.string(),
      }),
      execute: async (input) => {
        const gw = deps.getGateway()
        if (!gw) return NOT_READY
        try {
          return await gw.writeFile(String(input.projectId), String(input.path), String(input.content))
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'hyperframes_lint',
      description:
        'Lint a Hyperframes composition. Always runs a structural check (clip, data-start, paused GSAP). Uses the Hyperframes CLI when installed.',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        required: ['projectId'],
      },
      validator: z.object({ projectId: z.string().min(1) }),
      execute: async (input) => {
        const gw = deps.getGateway()
        if (!gw) return NOT_READY
        try {
          return await gw.lint(String(input.projectId))
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'hyperframes_render',
      description:
        'Render a Hyperframes project to MP4. Blocks until done (may take minutes). On success the file is stored in Documents and attached to this conversation. Call hyperframes_status and hyperframes_lint first.',
      category: 'custom',
      riskTier: 'yellow',
      timeoutMs: RENDER_TIMEOUT_MS + 10_000,
      inputSchema: {
        type: 'object',
        properties: { projectId: { type: 'string' } },
        required: ['projectId'],
      },
      validator: z.object({ projectId: z.string().min(1) }),
      execute: async (input, ctx?: ToolContext) => {
        const gw = deps.getGateway()
        if (!gw) return NOT_READY
        try {
          const job = await gw.render({
            projectId: String(input.projectId),
            conversationId: ctx?.conversationId,
            userId: ctx?.userId,
            agentId: ctx?.agentId,
          })
          return { job }
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'hyperframes_list',
      description: 'List Hyperframes projects and recent studio jobs for this conversation.',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string' },
          limit: { type: 'number' },
        },
      },
      validator: z.object({
        conversationId: z.string().optional(),
        limit: z.number().int().positive().max(100).optional(),
      }),
      execute: async (input, ctx) => {
        const gw = deps.getGateway()
        if (!gw) return NOT_READY
        try {
          const conversationId =
            typeof input.conversationId === 'string' ? input.conversationId : ctx?.conversationId
          const limit = typeof input.limit === 'number' ? input.limit : 20
          return {
            projects: gw.listProjects({ engineId: ENGINE, conversationId }),
            jobs: gw.listJobs({ conversationId, limit }),
          }
        } catch (err) {
          return errorOf(err)
        }
      },
    },
  ]
}
