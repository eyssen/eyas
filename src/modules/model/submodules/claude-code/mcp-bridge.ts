// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { ToolImplementation, ToolContext } from '@modules/tools/types.js'
import type { ExecutionResult, ModelToolText, RenderableResult } from '@modules/tools/tool-executor.js'
import type { ToolOutputContext } from '@modules/privacy/service.js'

/** ToolExecutor interface (subset needed by bridge) */
export interface BridgeToolExecutor {
  execute(toolName: string, input: Record<string, unknown>, ctx?: ToolContext): Promise<ExecutionResult>
  /**
   * The executor's one model-facing serialisation. A bridged answer goes from
   * EYAS to the Claude Code CLI and on to its vendor without passing the
   * gateway's egress filter, so memory-bearing output is masked here.
   */
  renderForModel(toolName: string, result: RenderableResult, ctx: ToolOutputContext): ModelToolText
}

/** Who a bridged answer is sent for: the query's tool context, never the model's arguments. */
function bridgeOutputContext(ctx: ToolContext): ToolOutputContext {
  return {
    transport: 'mcp-bridge',
    ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
    ...(ctx.runId ? { runId: ctx.runId } : {}),
    ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
    ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
  }
}

/**
 * Convert an EYAS ToolImplementation to an SDK MCP tool definition.
 *
 * The Zod schema is a passthrough (all properties as z.unknown()) because
 * the MCP protocol transmits the real JSON Schema to the LLM. The Zod
 * schema is only used for TypeScript type inference inside the SDK.
 */
function convertTool(
  eyasTool: ToolImplementation,
  executor: BridgeToolExecutor,
  ctx: ToolContext,
) {
  // Build a ZodRawShape where each known property accepts any value.
  // This satisfies the SDK's type system while the real JSON Schema
  // is transmitted via the MCP protocol for LLM tool selection.
  const properties = (eyasTool.inputSchema as any)?.properties ?? {}
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const key of Object.keys(properties)) {
    shape[key] = z.unknown()
  }

  const out = bridgeOutputContext(ctx)
  const answer = (result: RenderableResult) => {
    const { text, isError } = executor.renderForModel(eyasTool.name, result, out)
    return {
      content: [{ type: 'text' as const, text }],
      ...(isError ? { isError: true } : {}),
    }
  }

  return tool(
    eyasTool.name,
    eyasTool.description,
    shape,
    async (args) => {
      try {
        return answer(await executor.execute(eyasTool.name, args as Record<string, unknown>, ctx))
      } catch (err) {
        return answer({ success: false, error: err instanceof Error ? err.message : String(err) })
      }
    },
  )
}

/**
 * Build an in-process MCP server that bridges EYAS tools to the Claude Code SDK.
 *
 * The bridge:
 * 1. Converts each EYAS ToolImplementation it is given to an
 *    SdkMcpToolDefinition. Which tools those are is the caller's decision
 *    (provider.ts: selectBridgeTools of the request's tool scope), made once.
 * 2. Creates an in-process MCP server via createSdkMcpServer()
 *
 * The returned server is passed to the SDK query as mcpServers.eyas.
 * All tool calls through the bridge go via ToolExecutor, which handles
 * audit logging, timeouts, and permission checks, and every answer is
 * written by its renderForModel (memory-bearing output masked).
 */
export function buildMcpBridge(
  tools: ToolImplementation[],
  executor: BridgeToolExecutor,
  ctx: ToolContext,
): McpSdkServerConfigWithInstance {
  const sdkTools = tools.map(t => convertTool(t, executor, ctx))

  return createSdkMcpServer({
    name: 'eyas',
    version: '1.0.0',
    tools: sdkTools,
  })
}
