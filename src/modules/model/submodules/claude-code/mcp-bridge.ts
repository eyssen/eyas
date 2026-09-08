// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { ToolImplementation, ToolContext, ToolCategory } from '@modules/tools/types.js'
import type { ExecutionResult } from '@modules/tools/tool-executor.js'

/** Categories excluded from MCP bridge — SDK handles these natively */
const EXCLUDED_CATEGORIES: ToolCategory[] = ['shell', 'browser']

/** ToolExecutor interface (subset needed by bridge) */
export interface BridgeToolExecutor {
  execute(toolName: string, input: Record<string, unknown>, ctx?: ToolContext): Promise<ExecutionResult>
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

  return tool(
    eyasTool.name,
    eyasTool.description,
    shape,
    async (args) => {
      try {
        const result = await executor.execute(eyasTool.name, args as Record<string, unknown>, ctx)
        if (!result.success) {
          return {
            content: [{ type: 'text' as const, text: `Error: ${result.error}` }],
            isError: true,
          }
        }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result.output ?? {}) }],
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        }
      }
    },
  )
}

/**
 * Build an in-process MCP server that bridges EYAS tools to the Claude Code SDK.
 *
 * The bridge:
 * 1. Filters out shell/browser tools (SDK handles these natively)
 * 2. Converts each EYAS ToolImplementation to an SdkMcpToolDefinition
 * 3. Creates an in-process MCP server via createSdkMcpServer()
 *
 * The returned server is passed to the SDK query as mcpServers.eyas.
 * All tool calls through the bridge go via ToolExecutor, which handles
 * audit logging, timeouts, and permission checks.
 */
export function buildMcpBridge(
  tools: ToolImplementation[],
  executor: BridgeToolExecutor,
  ctx: ToolContext,
): McpSdkServerConfigWithInstance {
  const bridgeTools = tools.filter(t => !EXCLUDED_CATEGORIES.includes(t.category))
  const sdkTools = bridgeTools.map(t => convertTool(t, executor, ctx))

  return createSdkMcpServer({
    name: 'eyas',
    version: '1.0.0',
    tools: sdkTools,
  })
}
