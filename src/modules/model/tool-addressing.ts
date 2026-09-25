// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/model/tool-addressing.ts
//
// Provider-exact names for EYAS tools in prompt text.
//
// EYAS tools have one canonical name (`memory_search`). A model on a CLI
// provider reaches them over the EYAS MCP server, where the host lists them
// under a different name — and a bare canonical name can resolve to the CLI's
// OWN tool: on Grok, `memory_search` is Grok's native memory, which reads the
// host's ~/.grok store instead of EYAS. So every prompt line that tells a
// model to call an EYAS tool renders the name through here, from the
// provider's `toolAddressing` (types.ts), never from a provider id.
//
// Pure: type-only imports, so the web bundle can re-export it if it needs to.
//
// Declared today: claude-code { kind: 'mcp-prefix', prefix: 'mcp__eyas__' }
// (its in-process SDK MCP server), grok-cli meta-tool, kimi-cli mcp-server;
// every API provider is native. The recall block (memory/v2/assemble.ts)
// renders its drill hint and its 'more notes' trailer through renderToolRef
// too.

import type { AIProvider, ToolAddressing } from './types.js'

export const NATIVE_TOOL_ADDRESSING: ToolAddressing = { kind: 'native' }

/** The provider's addressing; no provider or no declaration means native. */
export function toolAddressingOf(provider: Pick<AIProvider, 'toolAddressing'> | null | undefined): ToolAddressing {
  return provider?.toolAddressing ?? NATIVE_TOOL_ADDRESSING
}

/**
 * How a prompt names the EYAS tool `name` for this addressing, as inline
 * Markdown code that completes a sentence such as "use …".
 *   native      → `memory_search`
 *   mcp-prefix  → `mcp__eyas__memory_search`
 *   meta-tool   → `use_tool` with tool_name `eyas__memory_search`
 *   mcp-server  → `memory_search` on the `eyas` MCP server
 */
export function renderToolRef(addressing: ToolAddressing | null | undefined, name: string): string {
  const a = addressing ?? NATIVE_TOOL_ADDRESSING
  switch (a.kind) {
    case 'mcp-prefix':
      return `\`${a.prefix}${name}\``
    case 'meta-tool':
      return `\`${a.via}\` with tool_name \`${a.qualify}${name}\``
    case 'mcp-server':
      return `\`${name}\` on the \`${a.server}\` MCP server`
    case 'native':
    default:
      return `\`${name}\``
  }
}

/**
 * One line for the tool inventory's footer telling the model how to call the
 * listed (canonical) names on its host. Empty for native addressing: there the
 * listed names are exact and nothing needs saying.
 */
export function toolAddressingNote(addressing: ToolAddressing | null | undefined): string {
  const a = addressing ?? NATIVE_TOOL_ADDRESSING
  const pattern = renderToolRef(a, '<name>')
  const example = renderToolRef(a, 'memory_search')
  switch (a.kind) {
    case 'mcp-prefix':
      return `The EYAS tools above come from the EYAS MCP server; your host lists each one as ${pattern} — for example, call ${example}.`
    case 'meta-tool':
      // Verified on grok 1.0.40 (tests/fixtures/cli/grok/1.0.40/mcp-dispatch.json):
      // MCP tools are not in the function list; search_tool returns their
      // input_schema and use_tool takes {tool_name, tool_input}.
      return `The EYAS tools above are on the \`eyas\` MCP server, not in your function list: look one up with \`search_tool\`, then call ${pattern} and its arguments in tool_input — for example ${example}. A name without the \`${a.qualify}\` prefix is not an EYAS tool.`
    case 'mcp-server':
      return `The EYAS tools above are served by the MCP server named \`${a.server}\`: call each one by the name your host lists for that server — for example ${example}, not a built-in tool of the same name.`
    case 'native':
    default:
      return ''
  }
}
