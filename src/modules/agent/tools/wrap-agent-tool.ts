// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ZodTypeAny, infer as ZodInfer } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type {
  ToolImplementation,
  ToolContext,
  ToolCategory,
  ToolResult,
  RiskTier,
} from '@modules/tools/types'

export interface AgentToolFactoryShape<TSchema extends ZodTypeAny> {
  name: string
  description: string
  inputSchema: TSchema
  invoke: (agentId: string, input: ZodInfer<TSchema>) => Promise<unknown>
}

export interface WrapAgentToolOptions {
  category: ToolCategory
  riskTier: RiskTier
  requiresApproval?: boolean
  timeoutMs?: number
}

/**
 * Adapter that converts a Phase 6 self-edit tool factory (with Zod inputSchema and
 * an `invoke(agentId, input)` shape) into a runtime `ToolImplementation` accepted
 * by the central `ToolRegistry`.
 *
 * - Converts the Zod schema to JSON Schema for the LLM provider.
 * - Keeps the Zod schema as `validator` for runtime input validation.
 * - Pulls `agentId` from `ToolContext`; throws if absent (these tools require identity).
 */
export function wrapAgentTool<TSchema extends ZodTypeAny>(
  tool: AgentToolFactoryShape<TSchema>,
  opts: WrapAgentToolOptions,
): ToolImplementation {
  const jsonSchema = zodToJsonSchema(tool.inputSchema, { target: 'jsonSchema7' }) as Record<string, unknown>

  return {
    name: tool.name,
    description: tool.description,
    category: opts.category,
    riskTier: opts.riskTier,
    requiresApproval: opts.requiresApproval,
    timeoutMs: opts.timeoutMs,
    inputSchema: jsonSchema,
    validator: tool.inputSchema,
    async execute(input: Record<string, unknown>, ctx?: ToolContext): Promise<ToolResult> {
      const agentId = ctx?.agentId
      if (!agentId) {
        throw new Error(`Tool "${tool.name}" requires ctx.agentId — refusing to run without agent identity`)
      }
      const result = await tool.invoke(agentId, input as ZodInfer<TSchema>)
      // The tool factories return plain objects already shaped as ToolResult.
      return result as ToolResult
    },
  }
}
