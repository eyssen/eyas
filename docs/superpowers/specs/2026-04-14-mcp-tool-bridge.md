# MCP Tool Bridge — Claude Code SDK Integration

**Date:** 2026-04-14  
**Status:** Draft  
**Scope:** Bridge EYAS tools to Claude Code SDK via in-process MCP server

---

## 1. Overview

### Problem

The Claude Code SDK provider (`src/modules/model/submodules/claude-code/provider.ts`) runs its own internal agentic tool-use loop. When EYAS routes a conversation through this provider, the SDK uses its built-in tools (Bash, Read, Write, Glob, Grep, etc.) and never calls EYAS tools (`delegate_to_agent`, `propose_team`, `write_team_memory`, `search`, `memory_store`, etc.).

Consequences:
- **No delegation** — the SDK cannot delegate subtasks to other EYAS agents, so `SubConversationTree` shows nothing.
- **No team sessions** — `propose_team` is never called, so `TeamProposalCard` and `TeamDashboard` remain empty.
- **No memory** — tool calls that write to EYAS's 5-tier memory system are bypassed.
- **No audit trail** — EYAS's `ToolExecutor` logging and `audit` module never see these tool invocations.
- **`supportsTools: false`** — the provider currently declares it cannot use EYAS tools at all.

### Solution

The Claude Code SDK supports `createSdkMcpServer()` — an in-process MCP server that exposes custom tools to the SDK's agentic loop without spawning an external process. We bridge EYAS's `ToolRegistry` to the SDK via MCP:

1. Convert `ToolImplementation[]` to `SdkMcpToolDefinition[]` format
2. Create an MCP server with `createSdkMcpServer({ name: 'eyas', tools: [...] })`
3. Pass it to the SDK query via `mcpServers: { eyas: mcpServer }`
4. Keep a curated subset of SDK built-in tools for file/shell operations
5. SDK's agentic loop calls EYAS tools via MCP, creating real child conversations, team sessions, and memory entries
6. EYAS UI components (`SubConversationTree`, `TeamDashboard`, `TeamProposalCard`, `AgentProgress`) show real-time progress

---

## 2. Architecture

```
User message
  │
  ▼
ConversationService
  │
  ▼
ModelGateway.stream(request)  ← request.tools = EYAS ToolDefinition[]
  │
  ▼
ClaudeCodeProvider.stream(request)
  │
  ├─ buildMcpBridge(request.tools, toolExecutor, ctx)
  │    │
  │    ├─ convertToSdkTools(tools)  → SdkMcpToolDefinition[]
  │    └─ createSdkMcpServer({ name: 'eyas', tools })
  │
  ├─ query({
  │     prompt,
  │     options: {
  │       mcpServers: { eyas: mcpServer },
  │       allowedTools: ['Bash', 'Read', 'Write', ...],  // SDK built-ins
  │     }
  │   })
  │
  ▼
SDK Agentic Loop
  │
  ├─ SDK built-in tool call (Bash, Read, etc.)
  │    → handled internally by SDK
  │    → streamed as tool_use events to EYAS
  │
  └─ MCP tool call (delegate_to_agent, propose_team, etc.)
       → MCP handler invokes toolExecutor.execute()
       → toolExecutor writes to DB (conversations, team_sessions, etc.)
       → bus events fire → WebSocket → frontend updates
       → result returned to SDK as CallToolResult
```

Key principle: the MCP bridge is a **thin adapter layer** between two tool systems. It does not duplicate logic — it converts formats and delegates execution to the existing `ToolExecutor`.

---

## 3. Data Flow

Step-by-step flow for a user message that triggers agent delegation:

1. **User sends message** — frontend `POST /api/v1/conversations/:id/messages`
2. **ConversationService** builds `ModelRequest` with `tools: registry.toToolDefinitions()`
3. **ModelGateway** routes to `claude-code` provider based on conversation's model config
4. **ClaudeCodeProvider.stream()** receives request with `tools[]`
5. **Bridge construction** — `buildMcpBridge()` converts EYAS tools to `SdkMcpToolDefinition[]`, creates in-process MCP server
6. **SDK query starts** — prompt + system prompt + MCP server passed to `query()`
7. **SDK decides to delegate** — generates a `tool_use` block for `mcp__eyas__delegate_to_agent`
8. **MCP handler fires** — SDK calls the bridge handler with `{ agentId, task, context }`
9. **Bridge handler** invokes `toolExecutor.execute('delegate_to_agent', input, ctx)`
10. **DelegationService.delegate()** creates a child conversation, runs the target agent
11. **Bus events fire** — `conversation:created`, `agent:started`, `agent:completed`
12. **WebSocket** pushes events to frontend — `SubConversationTree` updates in real-time
13. **Handler returns** `CallToolResult` with `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`
14. **SDK continues** — processes the tool result, may call more tools or generate final response
15. **Provider streams** text/tool_use events back to EYAS as `StreamEvent`
16. **ConversationService** persists the assistant message with tool call metadata

---

## 4. Tool Bridging

### Schema Conversion: JSON Schema to Zod

EYAS tools define `inputSchema` as JSON Schema objects. The SDK's `tool()` helper expects Zod schemas. Two approaches:

**Option A: Use `zod-to-json-schema` in reverse (json-schema-to-zod)**
- Use a library like `json-schema-to-zod` to dynamically convert at bridge construction time.
- Risk: not all JSON Schema features map cleanly to Zod.

**Option B: Use `z.any()` with JSON Schema validation**
- Pass `z.object({}).passthrough()` as the Zod schema (accepts any object).
- Validate against the real JSON Schema inside the handler using Ajv or manual checks.
- The SDK still passes the JSON Schema as the tool's `inputSchema` in the MCP protocol, so the LLM sees the correct schema.

**Recommendation: Option B.** The MCP protocol transmits JSON Schema natively — the Zod schema in `SdkMcpToolDefinition` is only used for TypeScript type inference, not for LLM prompting. Using a passthrough schema avoids a runtime dependency on schema conversion and keeps the bridge simple.

```typescript
import { tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

function convertTool(
  eyasTool: ToolImplementation,
  executor: ToolExecutor,
  ctx: ToolContext,
): SdkMcpToolDefinition<any> {
  return tool(
    eyasTool.name,
    eyasTool.description,
    z.record(z.unknown()),  // passthrough — real schema in MCP protocol
    async (args) => {
      const result = await executor.execute(eyasTool.name, args, ctx)
      if (!result.success) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${result.error}` }],
          isError: true,
        }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result.output) }],
      }
    },
    { annotations: { riskTier: eyasTool.riskTier } },
  )
}
```

### Handler Wrapping

Each MCP handler wraps `toolExecutor.execute()` with the conversation's `ToolContext`:

```typescript
function buildMcpBridge(
  tools: ToolImplementation[],
  executor: ToolExecutor,
  ctx: ToolContext,
): McpSdkServerConfigWithInstance {
  const sdkTools = tools.map(t => convertTool(t, executor, ctx))
  return createSdkMcpServer({
    name: 'eyas',
    version: '1.0.0',
    tools: sdkTools,
  })
}
```

The `ToolContext` is captured at bridge construction time (once per `stream()` call) and closed over by all handlers. This ensures every tool call in the SDK's loop has the correct `conversationId`, `agentId`, and `teamSessionId`.

### Tool Selection

Not all EYAS tools should be exposed to the SDK. Selection strategy:

| Category | Expose? | Rationale |
|----------|---------|-----------|
| `agent` (delegate, propose_team, team_memory) | Yes | Core value — enables delegation and team sessions |
| `memory` (store, recall, search) | Yes | Agents need persistent memory |
| `search` (full-text, semantic) | Yes | Knowledge retrieval |
| `knowledge` (wiki read/write) | Yes | Knowledge base access |
| `board` (task CRUD) | Yes | Task management |
| `documents` (upload, list) | Yes | Document access |
| `conversation` (read history) | Yes | Context from other conversations |
| `shell` (execute command) | No | SDK has superior Bash tool |
| `browser` (navigate, screenshot) | No | SDK can use Playwright MCP or built-in web tools |
| `research` (deep research) | Yes | Multi-step research orchestration |

The bridge accepts an optional `filter: ToolFilter` to control which tools are exposed:

```typescript
const bridgeTools = registry.list({
  // Exclude shell and browser — SDK handles these natively
  category: undefined,  // all categories
}).filter(t => !['shell', 'browser'].includes(t.category))
```

---

## 5. Built-in Tools Policy

The SDK comes with powerful built-in tools. How they interact with EYAS tools:

### Option A: Disable all SDK tools (`allowedTools: []`)

- All tool calls go through EYAS's MCP bridge.
- Full audit trail and permission control.
- **Downside:** EYAS would need to implement file editing, glob, grep, notebook editing — duplicating what the SDK already does well. Massive effort, inferior quality.

### Option B: Keep both SDK and EYAS tools

- SDK tools handle file/shell/web operations.
- EYAS tools handle agent/memory/team/board operations.
- **Downside:** potential naming conflicts, confusing tool selection for the LLM.

### Option C: Keep SDK tools for file/shell ops, EYAS tools for agent/memory/team ops (Recommended)

- `allowedTools`: curated list of SDK built-in tools for low-level operations.
- `mcpServers: { eyas: bridge }`: EYAS tools for high-level orchestration.
- Clear separation: SDK handles the "hands" (files, shell, web), EYAS handles the "brain" (agents, memory, teams, knowledge).

**Recommendation: Option C.** Rationale:

1. **No duplication** — SDK's Bash, Read, Write, Edit, Glob, Grep are battle-tested and context-aware. Reimplementing them in EYAS would be inferior.
2. **Clear boundaries** — the LLM sees two distinct tool namespaces: SDK tools are bare names (`Bash`, `Read`), EYAS tools are MCP-prefixed (`mcp__eyas__delegate_to_agent`). No ambiguity.
3. **Audit where it matters** — file operations are logged by the SDK internally. Agent delegation, team sessions, and memory writes go through EYAS's `ToolExecutor` with full audit logging.
4. **Incremental adoption** — start with a small set of SDK tools and expand as needed.

### Curated SDK built-in tools

```typescript
const SDK_BUILTIN_TOOLS = [
  'Bash',           // Shell command execution
  'Read',           // File reading
  'Write',          // File writing
  'Edit',           // File editing (search-and-replace)
  'Glob',           // File pattern matching
  'Grep',           // Content search
  'NotebookEdit',   // Jupyter notebook editing
  'WebFetch',       // HTTP requests
  'WebSearch',      // Web search
]
```

Excluded SDK tools:
- `Agent` / `TaskOutput` / `TaskStop` — conflicts with EYAS's agent system
- `TodoWrite` — EYAS has its own board/task system
- `EnterWorktree` / `ExitWorktree` — EYAS manages worktrees at a higher level
- `Config` — internal SDK config, not relevant
- `AskUserQuestion` — EYAS handles user interaction through its own conversation system

---

## 6. Provider Changes

### Modifications to `claude-code/provider.ts`

#### 6.1 Accept tools from ModelRequest

The provider currently ignores `request.tools`. After the bridge:

```typescript
async *stream(request: ModelRequest): AsyncIterable<StreamEvent> {
  // ... existing setup ...

  // NEW: Build MCP bridge from EYAS tools
  let mcpServers: Record<string, any> | undefined
  if (request.tools && request.tools.length > 0) {
    const bridge = buildMcpBridge(
      request.tools,
      this.toolExecutor,  // injected via provider options
      {
        conversationId: request.metadata?.conversationId ?? '',
        userId: request.metadata?.userId ?? '',
        agentId: request.metadata?.agentId,
        teamSessionId: request.metadata?.teamSessionId,
        logger: this.logger,
      },
    )
    mcpServers = { eyas: bridge }
  }

  const queryOptions = {
    // ... existing options ...
    allowedTools: SDK_BUILTIN_TOOLS,
    mcpServers,
  }
  // ...
}
```

#### 6.2 `supportsTools: true`

All `KNOWN_MODELS` entries change from `supportsTools: false` to `supportsTools: true`:

```typescript
const KNOWN_MODELS: ModelInfo[] = [
  { id: 'claude-code-opus', ..., supportsTools: true },
  { id: 'claude-code-sonnet', ..., supportsTools: true },
  { id: 'claude-code-haiku', ..., supportsTools: true },
]
```

This signals to the `ConversationService` and `AgentRunner` that they should include EYAS tools in the `ModelRequest` when using this provider.

#### 6.3 Provider constructor changes

The provider needs access to `ToolExecutor` and a logger:

```typescript
export interface ClaudeCodeProviderOptions {
  loadClaudeMd?: boolean
  toolExecutor?: ToolExecutor      // NEW
  toolRegistry?: ToolRegistry      // NEW — for dynamic tool list
  logger?: Logger                  // NEW
}
```

When `toolExecutor` is not provided, the bridge is not created and the provider behaves exactly as before (backward compatible).

#### 6.4 Handle MCP tool_use events for real-time streaming

The SDK emits `tool_use` blocks for MCP tools with the prefixed name `mcp__eyas__<tool_name>`. The provider should strip the prefix and emit clean `StreamEvent` objects:

```typescript
if (block.type === 'tool_use') {
  toolCount++
  const name = block.name?.replace(/^mcp__eyas__/, '') ?? block.name
  yield { type: 'tool_use_start', id: block.id ?? `tool-${toolCount}`, name }
  yield { type: 'tool_use_end' }
}
```

#### 6.5 ModelRequest metadata

`ModelRequest` needs optional metadata for the bridge to construct `ToolContext`:

```typescript
export interface ModelRequest {
  // ... existing fields ...
  metadata?: {
    conversationId?: string
    userId?: string
    agentId?: string
    teamSessionId?: string
  }
}
```

This is a non-breaking addition — other providers ignore `metadata`.

---

## 7. Conversation Integration

### Parent-child linking

When `delegate_to_agent` runs through the MCP bridge, the `ToolContext.conversationId` links the child conversation to the parent. The `DelegationService.delegate()` method already handles this:

```
Parent conversation (conversationId: "conv-001")
  └─ delegate_to_agent via MCP bridge
       └─ DelegationService.delegate("conv-001", agentId, task)
            └─ Creates child conversation (parentConversationId: "conv-001")
```

No changes needed to `DelegationService` — the bridge simply provides the correct `conversationId` in `ToolContext`.

### Team session creation

When `propose_team` runs through the MCP bridge:

1. `ToolContext.conversationId` becomes the `parentConversationId` of the `team_session`
2. `TeamSessionService.create()` stores the session
3. Bus event `team:proposed:{conversationId}` fires
4. WebSocket pushes the proposal to the frontend
5. Frontend renders `TeamProposalCard` inline in the conversation

When the user approves, `executeTeam()` creates child conversations with `teamSessionId` set — exactly as designed in the Team Sessions spec.

### Bus event propagation

The bridge handlers do not need to emit bus events directly. The underlying services (`DelegationService`, `TeamSessionService`, `MemoryService`) already emit events internally. The bridge is transparent.

---

## 8. Frontend Impact

Once the MCP bridge is in place, these components work automatically with no frontend changes:

### SubConversationTree

- **Before:** Empty when using Claude Code provider (no child conversations created).
- **After:** Shows real child conversations from `delegate_to_agent` calls. The tree updates in real-time via `conversation:created` WebSocket events. Each node shows the agent name, status (running/completed/failed), and turn count.

### TeamProposalCard

- **Before:** Never rendered (propose_team never called by SDK).
- **After:** Renders inline when the SDK calls `mcp__eyas__propose_team`. Shows phases, agent assignments, cost estimate, and agent gaps. Approve/reject buttons work as designed.

### TeamDashboard

- **Before:** No data to display.
- **After:** Shows real-time agent progress during team execution. Agent cards update via `team:agent_progress` WebSocket events. Team memory entries appear in the shared memory panel.

### AgentProgress

- **Before:** Shows only SDK's internal tool calls (Bash, Read, etc.) as opaque `tool_use_start`/`tool_use_end` events.
- **After:** Shows both SDK tool calls and EYAS tool calls. EYAS tool names are cleaned (prefix stripped), so the UI shows `delegate_to_agent` instead of `mcp__eyas__delegate_to_agent`.

### No frontend changes required

The bridge is entirely a backend concern. The frontend already subscribes to the correct WebSocket channels and renders the correct components based on data presence. The only change is that data now actually flows through these channels when using the Claude Code provider.

---

## 9. Constraints

1. **Non-blocking handlers** — MCP handlers run inside the SDK's event loop. All `toolExecutor.execute()` calls are async and must resolve within the SDK's timeout. Long-running tools (e.g., `delegate_to_agent` with a complex subtask) are acceptable because the SDK is designed for multi-turn, long-running agentic loops.

2. **Timeout alignment** — The bridge should respect the same timeout as the SDK query itself (`DEFAULT_TIMEOUT_MS = 10 minutes`). Individual tool timeouts are handled by `ToolExecutor` (default 30s per tool, configurable per tool via `timeoutMs`).

3. **Provider-agnostic design** — The MCP bridge only applies to the `claude-code` provider. Other providers (Anthropic API, OpenAI, Ollama) continue using EYAS's `AgentRunner` directly, which calls `ToolExecutor` natively. No changes to other providers.

4. **Backward compatibility** — When `toolExecutor` is not injected into the provider, the bridge is not created. The provider behaves exactly as before: `supportsTools: false`, no MCP server, SDK uses only built-in tools. This allows gradual rollout.

5. **Session continuity** — The SDK manages its own session (session ID, context window, compaction). EYAS manages conversations in its DB. These are separate concerns connected only by `request.sessionId` ↔ SDK session resume. The bridge does not affect session management.

6. **Single MCP server** — One in-process MCP server named `eyas` per query call. If EYAS later needs to expose external MCP servers (e.g., from the Hand Hub module), they would be additional entries in the `mcpServers` map, not merged into the `eyas` server.

7. **Permission bypass** — The provider already uses `permissionMode: 'bypassPermissions'` for SDK built-in tools. EYAS tools have their own permission checks via CASL in the `ToolExecutor` pipeline. The bridge does not bypass EYAS permissions.

---

## 10. Key Risks

### 10.1 Tool naming conflicts

SDK tools are bare names (`Bash`, `Read`). MCP tools get prefixed (`mcp__eyas__delegate_to_agent`). There is no naming conflict risk. However, if EYAS ever registers a tool named `Bash` or `Read`, the MCP version would coexist with the SDK version — the LLM might get confused. **Mitigation:** the bridge's tool filter (Section 4) explicitly excludes `shell` and `browser` category tools.

### 10.2 Dual session management

The SDK maintains its own session state (messages, context window, compaction). EYAS maintains conversations in SQLite. These are loosely coupled via `sessionId`. Risk: if the SDK compacts context, it may "forget" that it called an EYAS tool earlier in the conversation. **Mitigation:** EYAS tool results are persisted in the conversation DB regardless of SDK compaction. The SDK's `context_compact` event is already handled by the provider to persist summaries.

### 10.3 Token counting accuracy

When MCP tools are involved, the SDK's usage reporting may account for MCP tool schemas in `input_tokens` differently than direct API tool definitions. The reported `inputTokens` / `outputTokens` in `ModelResponse` may not perfectly reflect EYAS-specific tool usage. **Mitigation:** EYAS's `ToolExecutor` logs duration and success/failure independently. For cost tracking, rely on the SDK's aggregate usage numbers (which include MCP overhead).

### 10.4 Error propagation

If an EYAS tool throws an unhandled error, the MCP handler must catch it and return a proper `CallToolResult` with `isError: true`. An uncaught exception in a handler could crash the SDK's event loop. **Mitigation:** the `convertTool()` wrapper (Section 4) wraps `executor.execute()` in a try/catch and always returns a valid `CallToolResult`.

### 10.5 Recursive delegation

An EYAS agent delegated via `delegate_to_agent` might itself use the Claude Code provider, creating another MCP bridge, which could call `delegate_to_agent` again. This is intentional (delegation depth up to 5) but each level adds an MCP server instance. **Mitigation:** the existing `MAX_DELEGATION_DEPTH = 5` limit in `DelegationService` prevents infinite recursion. Each bridge is lightweight (in-process, no external process).

### 10.6 Zod dependency

The SDK's `tool()` helper requires Zod for schema definition. EYAS does not currently bundle Zod in the backend (it uses JSON Schema). **Mitigation:** Zod is already a dependency of the SDK package itself. Import `z` from the SDK's Zod instance or add Zod as a direct dependency (MIT licensed, compatible).
