// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { ToolImplementation, ToolResult } from '@modules/tools/types.js'
import type { CliRunner } from '@modules/studio/cli-runner.js'
import { doctorOpencode } from './doctor.js'
import type { DeveloperAgent } from './developer-agent.js'
import type { OpencodeSettings } from './types.js'
import { normalizeOpencodeSettings } from './settings-store.js'

const NOT_READY = { error: 'OpenCode module not ready yet — try again shortly' }
const RUN_TIMEOUT_MS = 180_000

function errorOf(err: unknown): ToolResult {
  return { error: err instanceof Error ? err.message : String(err) }
}

export function createOpencodeTools(deps: {
  getRunner: () => CliRunner | undefined
  getSettings: () => OpencodeSettings
  getDoctorExtras?: () => { serverUrl: string | null; serverVersion: string | null }
  getAgent: () => DeveloperAgent | undefined
}): ToolImplementation[] {
  return [
    {
      name: 'opencode_status',
      description:
        'Check whether the OpenCode sidecar (MIT CLI + HTTP server) is ready. Missing binary returns a remedy. Does not call an LLM. Call this before opencode_run.',
      category: 'agent',
      riskTier: 'green',
      inputSchema: { type: 'object', properties: {} },
      validator: z.object({}).passthrough(),
      execute: async () => {
        const runner = deps.getRunner()
        if (!runner) return NOT_READY
        try {
          const extra = deps.getDoctorExtras?.()
          return await doctorOpencode(runner, deps.getSettings(), extra) as unknown as ToolResult
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'opencode_run',
      description:
        'Delegate a coding task to the OpenCode engine (HTTP session on 127.0.0.1). Hydrates EYAS memory first. Watch the live TUI in the conversation terminal panel. Call opencode_status first. Not a replacement for EYAS file tools on small edits.',
      category: 'shell',
      riskTier: 'red',
      requiresApproval: true,
      timeoutMs: RUN_TIMEOUT_MS + 5_000,
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Task for OpenCode' },
          cwd: { type: 'string', description: 'Workspace directory (must be inside working directories)' },
        },
        required: ['prompt'],
      },
      validator: z.object({
        prompt: z.string().min(1).max(32_000),
        cwd: z.string().max(4_096).optional(),
      }),
      execute: async (input, ctx) => {
        const settings = normalizeOpencodeSettings(deps.getSettings())
        if (!settings.enabled) return { error: 'OpenCode is disabled in settings.' }
        const agent = deps.getAgent()
        if (!agent) return NOT_READY
        try {
          const result = await agent.run({
            prompt: String(input.prompt),
            conversationId: ctx?.conversationId ?? 'opencode',
            userId: ctx?.userId ?? 'agent',
            projectId: ctx?.projectId ?? null,
            cwd: typeof input.cwd === 'string' ? input.cwd : ctx?.workingDirectory,
            workingDirectories: ctx?.workingDirectories,
            timeoutMs: RUN_TIMEOUT_MS,
          })
          return result as unknown as ToolResult
        } catch (err) {
          return errorOf(err)
        }
      },
    },
  ]
}
