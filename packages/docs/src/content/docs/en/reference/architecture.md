---
title: Architecture (pointer)
description: Where the technical specs live, and the cross-cutting rules the rest of this handbook relies on.
---

User docs stop here. For implementers:

| Path | Content |
|------|---------|
| `docs/eyas-architecture.md` | Full modular architecture |
| `docs/superpowers/specs/` | Design specs |
| `docs/superpowers/plans/` | Implementation plans |
| `CHANGELOG.md` | Releases |

Do not treat those files as end-user manuals. The sections below summarise the rules that hold on every provider — API models, Claude Code CLI, Grok CLI, Kimi Code CLI, local runtimes and OpenCode — and link to the pages that explain them.

## Memory sovereignty layer {#memory-sovereignty-layer}

EYAS is the only memory a model has. A model reads it only through the recall block on its message and the `memory_search` / `memory_expand` tools. It never writes memory — EYAS records it — and it cannot reach memory outside EYAS on any channel:

```text
A model's tool call arrives on one of these channels:
  1. EYAS tools in EYAS's own agent loop (API providers)
  2. EYAS tools that Grok CLI and Kimi Code CLI call through the tool bridge
  3. Claude Code's built-in tools (one check before they run)
     and Claude Code's permission requests
  4. Grok / Kimi permission requests, and the files they read
     or write through EYAS
                         |
                         v
        ONE path policy. It protects:
          - other AI tools' memory
          - Obsidian vaults
          - the paths in security.foreignMemoryPaths
          - EYAS's own data folder (vault, database, keys, CLI sign-ins)
          - other conversations' workspaces
                         |
             +-----------+-----------+
             v                       v
         hard deny                 allow
   (no AI judge, no approval,
    no lockout count,
    one Security Events row)

Under the CLIs' own shell, the operating system's file sandbox blocks
the same places (Claude Code and Grok CLI; Kimi Code CLI has none).

Memory in:   the <eyas-memory> block + memory_search / memory_expand
Memory out:  written only by EYAS
```

Headless OpenCode tasks pass the same check, and OpenCode's model reads memory only through the same two tools.

- Where the policy applies and what a model is told: [Security & privacy — Memory outside EYAS](/docs/en/admin/security-privacy/#memory-outside-eyas).
- How it is proven on the real CLIs before each release: [Security & privacy — How isolation is proven](/docs/en/admin/security-privacy/#how-isolation-is-proven).
- What a model gets instead: [Memory — How recall works](/docs/en/knowledge/memory/#how-recall-works) and [Memory outside EYAS is refused](/docs/en/knowledge/memory/#memory-outside-eyas-is-refused).

## Memory delivery {#memory-delivery}

Recalled memory reaches every model the same way, on every entry path.

- **One producer.** The prompt assembler is the only place recall is produced, through one recall service. Chat, background and scheduled runs, board bot runs, God Mode workers, specialists and delegated agents, team members, channel replies, colleague hand-offs and OpenCode tasks all go through it. The service builds the recall query itself from the conversation, so every path searches the same way.
- **One placement.** The agent runner attaches the turn block — the current date and time, then the recall block — to the current user message when it sends the request. The stored message never changes, and a resumed run gets a fresh block instead of the old one. Nothing that changes from turn to turn sits in the system prompt, so the system prompt stays the same and can be cached (automatic on the Anthropic API).
- **Sized to the model.** Each turn's delivery profile comes from one window resolver: the model's catalog window, else the CLI provider's known window, else 200k tokens. Budgets are set for a 100k-token window — the recall block's share there is `memory.index.budgetChars`, 2,400 characters by default — and scale with the window: up to 2.5× from 250k tokens, while below 100k the prompt budget never takes more than 35% of the window. The master identity and rules are never cut.
- **Named for the host.** Tool names are canonical, and every hint names them the way the model's host lists them: `memory_search` on API providers, `mcp__eyas__memory_search` in Claude Code, `use_tool` with `eyas__memory_search` in Grok CLI, and `memory_search` on the `eyas` MCP server in Kimi Code CLI. A model that cannot call tools is sent no tools and no drill-down hint, and gets up to four notes in full instead of two.
- **Drill-down.** `memory_search` and `memory_expand` together allow 3 calls per turn on every provider. EYAS resolves their project scope on the server from the conversation, never from a tool argument.
- **Audience.** Owner memory is not pushed to outside readers. A2A peer tasks and channel replies in the external voice — or whose voice cannot be determined — get the date and time only, and the turn records that recall was withheld. The memory tools themselves stay under the security gate.
- **Visible.** Each turn records what it received: the **Memory delivered** box of its context composition, and `memoryTiersUsed` on its trace. The **Memory delivery by provider** card on **Observability → Context** compares providers. See [Conversations — Context composition](/docs/en/daily/conversations/#context-composition) and [Observability & ops](/docs/en/admin/observability/#memory-delivery-by-provider).

## One binding, one tool scope, one way to run specialists {#binding-tools-specialists}

- **One model binding per turn.** Each turn runs on the model its conversation is bound to — a fixed model, the colleague default or Auto-routing. The binding is known before the prompt is assembled, so the prompt is sized and its tool names are written for that model. A model you picked is never swapped silently; a model EYAS fixed by itself falls back with a note. See [Conversations — Which model answers](/docs/en/daily/conversations/#which-model-answers).
- **One way to run specialists.** Specialists always run through EYAS with `run_specialist`, on every provider, as sub-conversations with their own supervised run. Claude Code's own subagent tool is not offered. See [Teams & delegation](/docs/en/agents/teams/).
- **One tool scope.** An agent is offered its tool list plus `memory_search` and `memory_expand` (an empty list means every tool), and Solo removes the delegation tools. The same scope holds on every run path and every provider, including the EYAS tools a CLI reaches over the bridge; a call outside it is refused. See [Create & configure — Tools & constraints](/docs/en/agents/configure/#tools--constraints).

## Reasoning effort and proven CLI versions {#effort-and-cli-versions}

- **Effort.** The level is worked out per model, at the moment a model answers — again after routing, a retry or a fallback — and fitted to what that model supports. Each provider only translates it into its own parameter, and a model EYAS has no verified facts about gets none. Claude Code CLI, Grok CLI and Kimi Code CLI report back the level they actually ran. See [Providers — How each provider applies the effort level](/docs/en/ai/providers/#effort-by-provider).
- **Proven CLI versions.** CLI isolation is checked at the start of every session, and each CLI version is proven before release by the release check (`bun run test:live-cli`). `eyas doctor` compares the installed binary with the last proven version. See [Providers — Proven CLI versions](/docs/en/ai/providers/#proven-cli-versions).

## Observability on every provider {#observability-on-every-provider}

- **Tool calls, counted once.** A trace counts the calls the model handed back for EYAS to run and the calls a CLI settled in its own loop — its built-in tools and EYAS tools over the bridge — each once, the same way for every provider.
- **CLI-run tools are logged, not run again.** A tool a CLI ran itself gets a row in the tool execution log under its canonical name, with its run. EYAS does not execute or authorise it a second time, and nothing from the log reaches memory: whether tool output is recorded in memory is decided only by `memory.l0.captureToolResults`. See [Tools — Tool execution log](/docs/en/automation/tools/#tool-execution-log).
- **Memory per turn.** Traces carry `memoryTiersUsed`, the recalled items counted per memory id prefix, and `GET /api/v1/observability/memory-parity` aggregates recall and drill-downs per answering provider. See [Observability & ops](/docs/en/admin/observability/#usage-tab).
- **EYAS's own model calls.** Background work — titles, memory capture, the security judge, … — runs on the background model and is traced and counted against the budget like a conversation turn. See [Routing & budget — The background model](/docs/en/ai/routing-budget/#background-model).

## For contributors {#for-contributors}

- **Model calls.** Backend code calls the model gateway directly only from a short, reviewed list: the agent runner, the chat stream route, the model API routes, tracing, the gateway itself, and a few isolated interactive one-shots (plan first, the God Mode reviewer, Design). Background work goes through the background model service. `tests/modules/model/no-direct-model-calls.test.ts` fails on any other direct call.
- **This handbook.** English is the source, and the five translations keep the same headings in the same order. A translated heading keeps the English anchor with a `## Heading {#english-id}` suffix, so `/docs/<lang>/<page>/#<id>` links and in-app help hashes work in every language and the heading stays in the page's table of contents. An id that contains `--` does not survive the typographic pass, which runs first; such a heading uses a raw `<h3 id="…">` instead. One test, `tests/contracts/handbook-locale-parity.test.ts`, fails when a listed page drifts between languages (headings, anchors, the heading form, table rows) or when any handbook link points at an anchor its page does not have. Page shape and voice: `packages/docs/PAGE_TEMPLATE.md`.
