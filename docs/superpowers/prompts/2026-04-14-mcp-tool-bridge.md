# MCP Tool Bridge — Starter Prompt

> Másold be az új Claude Code session-be ennek a fájlnak a tartalmát.

---

## Feladat

Implementáld az EYAS MCP Tool Bridge-et a design spec alapján:
`docs/superpowers/specs/2026-04-14-mcp-tool-bridge.md`

## Kontextus

Az EYAS-ban a Claude Code SDK provider (`src/modules/model/submodules/claude-code/provider.ts`) jelenleg saját agentic loop-ot futtat, kikerülve az EYAS tool rendszerét. Emiatt az EYAS UI komponensei (SubConversationTree, TeamDashboard, TeamProposalCard) nem működnek ezzel a provider-rel.

A megoldás: az EYAS tool-okat MCP szerveren keresztül injektáljuk az SDK-ba a `createSdkMcpServer()` segítségével. Így az SDK az EYAS tool-okat használja (delegate_to_agent, propose_team, search, memory, stb.), és minden EYAS feature automatikusan működik.

## Fő fájlok

**Módosítandó:**
- `src/modules/model/submodules/claude-code/provider.ts` — MCP bridge beépítése a stream() metódusba
- `src/modules/model/submodules/claude-code/manifest.ts` — tool registry átadása a provider-nek

**Új fájl:**
- `src/modules/model/submodules/claude-code/mcp-bridge.ts` — EYAS tools → SdkMcpToolDefinition konverzió

**Referencia fájlok (olvasd el!):**
- `src/modules/tools/types.ts` — ToolImplementation, ToolContext interfészek
- `src/modules/tools/tool-registry.ts` — registry.list(), registry.toToolDefinitions()
- `src/modules/tools/tool-executor.ts` — executor.execute(name, input, ctx)
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — createSdkMcpServer, SdkMcpToolDefinition, tool()

## SDK API (kulcs részek)

```typescript
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'

// MCP tool definíció
const myTool = tool('tool_name', 'description', zodSchema, async (args) => {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})

// MCP szerver létrehozása
const mcpServer = createSdkMcpServer({ name: 'eyas', tools: [myTool] })

// Átadás az SDK query-nek
const conversation = query({
  prompt: '...',
  options: {
    mcpServers: { 'eyas': mcpServer },
    tools: [],  // SDK built-in tools letiltva
    maxTurns: 10,
  }
})
```

## Architektúra döntések

1. **SDK built-in tools policy**: Option C — SDK tools letiltva (`tools: []`), EYAS tools MCP-n át. Az EYAS-nak már vannak saját shell, browser, search, document, memory tool-jai.

2. **supportsTools: true** — minden Claude Code modellen, hogy az agent-runner tool-use loop-ja is használható legyen (fallback ha MCP bridge nem aktív).

3. **inputSchema konverzió**: EYAS JSON Schema → Zod. Használj `z.object()` konverziót a tool inputSchema alapján, vagy nyers `z.record(z.unknown())` fallback-et.

4. **ToolContext**: a handler-ben a conversationId-t az SDK session-ből vagy a provider context-ből kell kinyerni.

## Tesztelési terv

1. TypeScript check: `bunx tsc --noEmit`
2. Unit test: mcp-bridge.ts konverziós logika
3. Integrációs teszt: Claude Code provider-rel conversation indítás, delegate_to_agent tool hívás, SubConversationTree megjelenés ellenőrzése
4. `bun test` — nincs regresszió

## Szabályok

- NE commitálj automatikusan
- Angol kód és kommentek
- Használd a /brainstorming skill-t ha bizonytalan vagy az architektúrában
- Olvasd el a design spec-et ELŐSZÖR (`docs/superpowers/specs/2026-04-14-mcp-tool-bridge.md`)
