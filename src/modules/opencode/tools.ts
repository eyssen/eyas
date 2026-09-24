// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { z } from 'zod'
import type { ToolImplementation, ToolResult } from '@modules/tools/types.js'
import type { CliRunner } from '@modules/studio/cli-runner.js'
import { doctorOpencode } from './doctor.js'
import type { DeveloperAgent } from './developer-agent.js'
import type { OpencodeSettings } from './types.js'
import { normalizeOpencodeSettings } from './settings-store.js'

const NOT_READY = { error: 'OpenCode module not ready yet — try again shortly' }
const NO_CONVERSATION = { error: 'opencode_run runs only inside a conversation (its folder and memory belong to one).' }
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
        'Delegate a coding task to the OpenCode engine (HTTP session on 127.0.0.1, EYAS-owned config). Hydrates EYAS memory first, and an OpenCode server EYAS started gets the same read-only memory_search / memory_expand tools, locked to this conversation\'s project; every file, shell and web tool call inside OpenCode is checked by the EYAS security gate. Runs on the model and reasoning variant set on the OpenCode page (else OpenCode\'s default); the result\'s `effective` names what ran. Watch the live TUI in the conversation terminal panel. Call opencode_status first. Not a replacement for EYAS file tools on small edits.',
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
        // The task's folder, memory scope and capture all belong to the
        // calling conversation: there is no stand-in for a missing one.
        if (!ctx?.conversationId) return NO_CONVERSATION
        const agent = deps.getAgent()
        if (!agent) return NOT_READY
        try {
          const result = await agent.run({
            prompt: String(input.prompt),
            conversationId: ctx.conversationId,
            userId: ctx.userId,
            agentId: ctx.agentId,
            runId: ctx.runId,
            turnId: ctx.turnId,
            cwd: typeof input.cwd === 'string' ? input.cwd : ctx.workingDirectory,
            workingDirectories: ctx.workingDirectories,
            // The OpenCode page's model and reasoning variant; none set =
            // OpenCode's own default. Not a tool input: the operator picks it.
            model: settings.model,
            variant: settings.variant,
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
