# EYAS Workflows — P0-frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Render the `/workflows`-style live run tree in the conversation right panel, fed by the `orchestration:<runId>` WS events the P0-backend now broadcasts.

**Architecture:** A Zustand `run-tree-store` reduces `OrchestrationEvent`s into a node map; a recursive `<RunTree>` renders it in the Sequoia glass idiom; `conversation-page` subscribes to `orchestration:<teamSessionId>` and feeds the store.

**Tech Stack:** React 19, Zustand, TanStack Router, Tailwind (CSS-var glass classes), lucide-react. No new deps.

## Global Constraints

- English code + comments; Hungarian UI labels (match `team-dashboard.tsx`).
- CSS variables / existing utility classes only (`glass-card`, `text-muted-foreground`, `text-foreground`, semantic Tailwind palette as used in `team-dashboard.tsx`) — **no hardcoded hex**.
- Follow the repo reality: `src/web` has **no component test harness** (no testing-library/jsdom) and is excluded from the root suite. Verify via web typecheck + `vite build` + browser smoke. The store is pure logic and gets a co-located `.test.ts` (documentation-grade; not auto-run).
- Version frozen. No auto-commit/branch/push.

## File Structure

- `src/web/src/stores/run-tree-store.ts` — **new.** Zustand store: `handleEvent(OrchestrationEvent)` → node map + ordered root ids; `reset()`.
- `src/web/src/stores/run-tree-store.test.ts` — **new.** Pure reducer tests (co-located, mirrors the one existing web `.test.ts`).
- `src/web/src/pages/conversations/components/run-tree.tsx` — **new.** Recursive `<RunTree>` + `<RunNodeRow>`.
- `src/web/src/pages/conversations/conversation-page.tsx` — **modify.** Subscribe to `orchestration:<teamSessionId>`; render `<RunTree>` in the right panel when a run is active.

The `OrchestrationEvent` type is imported from the backend shared module. In `src/web` this is referenced by a relative import that Vite resolves, OR a local mirror type — Task F1 Step 1 resolves which (the web tsconfig may not map `@shared`). Prefer a **local structural type** in the store to avoid a cross-package import.

---

### Task F1: run-tree-store

**Files:** Create `src/web/src/stores/run-tree-store.ts` + `.test.ts`.

**Interfaces:**
- `interface RunNode { nodeId; parentId: string|null; kind: 'root'|'agent'|'subagent'; label; agentId?; conversationId?; status: 'running'|'completed'|'failed'|'cancelled'|'paused'; turn: number; tokens: number; currentTool: string|null; summary: string|null }`
- `interface OrchestrationEventLike { runId; nodeId; parentId: string|null; seq: number; payload: { type: string; [k:string]: any } }` (local structural mirror).
- Store: `{ runId, nodes: Record<string,RunNode>, rootIds: string[], status, handleEvent(e), reset() }`.

- [ ] **Step 1: Write the reducer test** (see repo `agent-config-preview.test.ts` for the co-located style). Assert: node_started upserts a node into `nodes` + `rootIds`; node_progress updates turn/tokens; tool_result sets/clears currentTool; node_completed sets status+summary; run_completed sets store status; out-of-order/duplicate node_started is idempotent.
- [ ] **Step 2: Implement the store** (Zustand `create`, `set(state => ...)` reducer keyed by `e.nodeId`). run_completed/checkpoint set top-level `status`; everything else upserts `nodes[e.nodeId]`.
- [ ] **Step 3: Run** `cd src/web && bunx vitest run src/stores/run-tree-store.test.ts` (uses the web workspace's vitest; if no runner is wired, skip — the store is also covered by the browser smoke).
- [ ] **Step 4: Commit** — STOP, ask user.

### Task F2: RunTree component

**Files:** Create `run-tree.tsx`.

**Interfaces:** `export function RunTree(): JSX.Element` — reads `useRunTreeStore()`. Renders header (run status Badge) + `rootIds.map(<RunNodeRow>)`. `<RunNodeRow node depth />` renders a `glass-card`-style row (status dot, icon, label, turn/tokens, currentTool, View-chat button for subagents with conversationId) and recurses into `node`'s children (P0: none, but the recursion is in place). Match `team-dashboard.tsx` `AgentCard` visuals (status dot colors, `text-[10px]`, lucide `Bot`/`Clock`/`Zap`, `Badge`, `useNavigate`).

- [ ] Step 1: Implement component. Step 2: web typecheck (`cd src/web && bunx tsc --noEmit`). Step 3: Commit — STOP, ask.

### Task F3: Wire into conversation-page

**Files:** Modify `conversation-page.tsx`.

- Subscribe: `useEffect(() => { if (!teamSessionId) return; return subscribe('orchestration:' + teamSessionId, (msg:any) => { if (msg?.event === 'orchestration') useRunTreeStore.getState().handleEvent(msg.data) }) }, [teamSessionId, subscribe])`.
- Reset on conversation change (add `useRunTreeStore.getState().reset()` to the existing cleanup effect).
- Render `<RunTree />` in the right `Panel` (non-expanded branch) above `<SubConversationTree>`, shown when `teamSessionId` is set.

- [ ] Step 1: Implement. Step 2: web typecheck + `vite build`. Step 3: Browser smoke (run server, propose+approve a team, watch the tree populate over `orchestration:<id>`). Step 4: Commit — STOP, ask.

## Self-Review

- Spec §4.6 (recursive tree, unified store, Sequoia glass, right panel) → F1/F2/F3. ✓
- No hardcoded colors (semantic classes only). ✓
- Node keying matches backend: `phase:<phase>` + `conv:<conversationId>` (the adapter refinement makes subagent progress + completion land on one `conv:` node). ✓
- Test-harness reality acknowledged: store gets a pure test; component/wiring verified by typecheck+build+browser. ✓
