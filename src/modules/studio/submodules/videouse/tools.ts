// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { ToolContext, ToolImplementation, ToolResult } from '@modules/tools/types.js'
import type { StudioGateway } from '../../types.js'
import type { VideoUseEngine } from './adapter.js'

const NOT_READY = { error: 'Studio module not ready yet — try again shortly' }
const ENGINE = 'videouse'
const RENDER_TIMEOUT_MS = 600_000

function errorOf(err: unknown): ToolResult {
  return { error: err instanceof Error ? err.message : String(err) }
}

function asVideoUse(gw: StudioGateway): VideoUseEngine {
  const engine = gw.getEngine(ENGINE)
  if (!engine) throw new Error('Video Use engine is not registered. Open /studio.')
  return engine as VideoUseEngine
}

export function createVideoUseTools(deps: {
  getGateway: () => StudioGateway | undefined
}): ToolImplementation[] {
  return [
    {
      name: 'videouse_status',
      description:
        'Check whether the Video Use studio engine can cut footage: FFmpeg, ffprobe, ElevenLabs key (optional). Call this before videouse_render.',
      category: 'custom',
      riskTier: 'green',
      inputSchema: { type: 'object', properties: {} },
      validator: z.object({}).passthrough(),
      execute: async () => {
        const gw = deps.getGateway()
        if (!gw) return NOT_READY
        try {
          return await asVideoUse(gw).status()
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'videouse_create',
      description:
        'Create a Video Use project (sources/ + edit/). Then ingest footage, inventory, transcribe, pack, write edl.json, render.',
      category: 'custom',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: { title: { type: 'string', description: 'Project title' } },
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
      name: 'videouse_ingest',
      description:
        'Copy local video/audio files into the project sources/ directory. Paths must be absolute existing files.',
      category: 'custom',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' }, description: 'Absolute source file paths' },
        },
        required: ['projectId', 'paths'],
      },
      validator: z.object({
        projectId: z.string().min(1),
        paths: z.array(z.string().min(1)).min(1).max(50),
      }),
      execute: async (input) => {
        const gw = deps.getGateway()
        if (!gw) return NOT_READY
        try {
          const project = gw.getProject(String(input.projectId))
          if (!project) return { error: `Studio project not found: ${input.projectId}` }
          return await asVideoUse(gw).ingest(project, input.paths as string[])
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'videouse_inventory',
      description: 'List ingested sources with duration from ffprobe.',
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
          const project = gw.getProject(String(input.projectId))
          if (!project) return { error: `Studio project not found: ${input.projectId}` }
          return await asVideoUse(gw).inventory(project)
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'videouse_transcribe',
      description:
        'Transcribe sources with ElevenLabs Scribe (word-level, cached per file). Requires videouse-elevenlabs-api-key or ELEVENLABS_API_KEY.',
      category: 'custom',
      riskTier: 'yellow',
      timeoutMs: 300_000,
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
          const project = gw.getProject(String(input.projectId))
          if (!project) return { error: `Studio project not found: ${input.projectId}` }
          return await asVideoUse(gw).transcribe(project)
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'videouse_pack',
      description: 'Pack transcripts/*.json into edit/takes_packed.md (the LLM reading view).',
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
          const project = gw.getProject(String(input.projectId))
          if (!project) return { error: `Studio project not found: ${input.projectId}` }
          return await asVideoUse(gw).pack(project)
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'videouse_write',
      description:
        'Write a text file inside the project (edit/edl.json, edit/project.md, edit/master.srt, …). Path must be relative. Confirm the cut strategy with the user before writing ranges.',
      category: 'custom',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          projectId: { type: 'string' },
          path: { type: 'string' },
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
      name: 'videouse_lint',
      description: 'Validate edit/edl.json (sources, ranges, duration).',
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
      name: 'videouse_render',
      description:
        'Render edit/edl.json to MP4 (per-segment extract, 30ms fades, overlays PTS-shifted, subtitles last). Blocks until done. Confirm the strategy first.',
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
      name: 'videouse_list',
      description: 'List Video Use projects and recent studio jobs for this conversation.',
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
