---
title: Providers
description: AI backends — API, host CLI, and local runtimes. The CLIs run isolated from the machine's own setup.
---

**What this is for.** Providers are the LLM backends this instance can call: cloud APIs, host CLIs (Claude Code, Grok, Kimi), and local runtimes (Ollama, LM Studio, vLLM). You enable a provider, store its key, pick models, then routing uses it. This page also explains how EYAS keeps the CLIs away from the machine's own setup: Claude Code always runs isolated, Grok and Kimi run in their own EYAS home and are signed in for EYAS, and a turn stops when EYAS cannot confirm that isolation.

**Route:** `/providers`. Subtitle: *AI routing, provider configuration, and budget controls.* Tabs: **Routing Tiers · Providers · Budget · AI Analysis**.

## When to use it

- First run after setup: turn a provider **On**, paste an API key, enable models.
- You installed `claude` / `grok` / `kimi` on the host and want a keyless CLI provider.
- Grok CLI or Kimi Code CLI shows **Sign-in required** — sign it in for EYAS (see [Sign in Grok and Kimi for EYAS](#sign-in-grok-and-kimi-for-eyas)).
- EYAS should run a specific install of a CLI (`EYAS_CLAUDE_CODE_BIN`, `EYAS_GROK_BIN`, `EYAS_KIMI_BIN`) — see [Claude Code runtime](#claude-code-runtime) and [Grok CLI and Kimi Code CLI](#grok-cli-and-kimi-code-cli).
- A turn stopped with a CLI isolation error and you need to know what to change on the host.
- You updated Claude Code, Grok CLI or Kimi Code CLI and want to know whether EYAS's isolation was proven on that version (see [Proven CLI versions](#proven-cli-versions)).
- A CLI provider's panel says the **Kernel file sandbox** is *Unavailable on this server*, or you want CLI turns to require it (see [Kernel file sandbox](#kernel-file-sandbox)).
- A model row says **Not offered by the last refresh**, or you want to know which concrete model a row runs.
- You want to know which reasoning-effort levels a model offers, what **Auto** means for it, and how each provider applies the level (see [Reasoning effort](#reasoning-effort) and [How each provider applies the effort level](#effort-by-provider)).

## Typical workflow

1. Open **Providers** (`/providers`) → **Providers** tab.
2. Select a card. **On / Off** enables it for routing. **Authentication** takes an API key (encrypted in [Secrets](/docs/en/admin/secrets/)); Claude Code uses the Claude Code login on this machine; Grok CLI and Kimi Code CLI show a **Sign in for EYAS** card.
3. Enable individual models. **Refresh models** reloads the provider's model list — the same button for every provider, API or CLI. Models the provider no longer offers are switched off and marked, never deleted.
4. Set tiers and spend on [Routing & budget](/docs/en/ai/routing-budget/).

## Features

Each card shows identity, health, and enable toggle.

| Element | Meaning |
|---------|---------|
| **On / Off** | Enable provider for routing |
| **N/M models enabled** | How many models are active |
| **CLI not found** | Host binary missing |
| **No API key** | Needs key |
| **Auth error** | Credentials failed — re-enter key/login |
| **Sign-in required** | Red badge on Grok CLI / Kimi Code CLI: the CLI is not signed in for EYAS (tooltip: *&lt;CLI&gt; is not signed in for EYAS. Open the provider to sign in.*) |

### Built-in providers (as listed on cards) {#built-in-providers}

| Provider | Role |
|----------|------|
| Anthropic | Claude — the models your API key can use, read from Anthropic's model list (built-in fallback: Fable 5.1, Fable 5, Opus 5.5, Opus 5, Opus 4.8, Sonnet 5, Sonnet 4.6, Haiku 4.5) |
| OpenAI | GPT-5.6, GPT-5.5, GPT-5.4, GPT-5 mini, o3-mini, GPT-4o, GPT-4o mini built in; **Refresh models** lists the rest |
| OpenRouter | Multi-provider gateway (100+ models) |
| Gemini | Google Gemini 3.x (2.5 after a refresh, where your key still has access) |
| Kimi | Moonshot API (K3, K2.7 Code, K2.6) |
| Claude Code CLI | The Claude Code CLI on this machine (`claude`), always isolated — see [Claude Code isolation](#claude-code-isolation) |
| Grok CLI | ACP (`grok agent --no-leader stdio`) in its own EYAS home — EYAS tools via [CLI MCP bridge](/docs/en/ai/mcp/#cli-mcp-tool-parity-grok--kimi) |
| Kimi Code CLI | ACP (`kimi acp`) in its own EYAS home — same bridge |
| Ollama / LM Studio / vLLM | Local runtimes — see [Local runtimes](#local-runtimes) |
| xAI, Mistral, Groq, Together, DeepSeek, Cerebras, Venice, Hugging Face, NVIDIA, Z.AI, Kilo Gateway, Vercel AI Gateway, Qianfan, MiniMax, Synthetic, Xiaomi MiMo, … | Cloud APIs as listed on cards |

**One name everywhere.** The names in this table are the names EYAS shows on every screen: the provider cards and panel, the routing-tier provider selects, the conversation model picker and top bar, the *Answered by* line under each reply, chat error messages, a colleague's model picker, the **Model Assignments** card in Settings, the setup wizard, and the Grok/Kimi sign-in card and Home banner. Claude Code is always **Claude Code CLI**. Kimi Code CLI, Kimi and the compatible providers (xAI, Mistral, Groq, MiniMax, Xiaomi MiMo, …) show their product names, never an id such as `kimi-cli`. A viewer who may not read the model catalog (the guest role) sees provider ids instead.

**API (integrators).** Every row of `GET /api/v1/model/providers`, and the `GET /api/v1/model/providers/:id` detail, carries the product `name` and a `kind`: `cli` (Claude Code, Grok CLI, Kimi Code CLI), `local` (Ollama, LM Studio, vLLM) or `api` (every hosted API and any unknown id).

### Conversation continuity {#conversation-continuity}

EYAS keeps the conversation, not the provider. On every turn EYAS sends the whole conversation from its own store to the model. No CLI provider keeps or resumes a session of its own: Claude Code, Grok CLI and Kimi Code CLI start fresh each turn and receive the earlier turns as a conversation-history block. Grok and Kimi always open a new ACP session and never load an earlier one.

So a conversation keeps its context when you switch provider or model, and a CLI's own session store is never a source of context or memory. The same continuity applies to every provider.

Images pasted in earlier turns are part of that history on Grok CLI and Kimi Code CLI too, each at the place in the conversation where it was sent. See [What Grok and Kimi receive](#what-grok-and-kimi-receive).

The cost Claude Code reports for a turn is that turn's own spend and is added as it is.

**Raw model API (integrators).** `POST /api/v1/model/complete` and `POST /api/v1/model/stream` (permission `use Model`) validate their body. Accepted fields: `provider`, `model`, `messages` (1–1000 items; role `user` or `assistant`; content is a string or a list of text/image blocks), `system`, `maxTokens` (positive integer), `temperature` (0–2), `stopSequences` (at most 16) and an optional `effort` (a level from `none` to `max`, or `auto`). Any other key is dropped, including `sessionId`, `metadata`, `cwd`, `isolated`, `tools` and `thinking`. These calls are therefore governed as autonomous (the [autonomy](/docs/en/agents/autonomy/) ladder applies), cannot resume a provider session, and `thinking` has no effect there. The response, and the stream's `done` event, carry `effortOutcome`: the requested level, the level actually sent to the model, and its source (`request`). An invalid body returns `400` with `{ error: 'ValidationError', issues }`.

### Models and Refresh models {#models-and-refresh-models}

**Refresh models** asks the provider which models it offers and saves, for each row, the concrete model it runs (for example the Grok model id, or the alias Claude Code uses). A model found by a refresh keeps working after EYAS restarts.

- Each model row shows a small **Runs &lt;model&gt;** line when the concrete model differs from the row's own id.
- A successful refresh does not only add models. A model the provider no longer offers is switched off and marked **Not offered by the last refresh**. It is never deleted. If a later refresh offers it again, it is switched back on automatically — unless you had switched it off yourself. You may switch a marked model on by hand; it then stays under your control.
- If the refresh fails (provider unreachable, not signed in, no key) or the provider lists no models, nothing is changed and the panel says *Refresh failed. The model list was left unchanged.* OpenAI, Gemini, OpenRouter, Kimi (API) and OpenAI-compatible endpoints report such a failure instead of silently showing EYAS's built-in model list.

**Agents that name only a model.** An agent, specialist or routing target that names a model id without a provider reaches the provider that has that model in its enabled model list — for example a Grok model found by Refresh, or a newer OpenAI model. A model that is switched off or unknown, a model whose provider is switched off, and a model id that two providers both offer still fail with *No provider found for model*. EYAS never guesses.

**Which model a CLI runs.**

- **Grok CLI:** the **Grok CLI (&lt;model&gt;)** default row runs whatever model the installed Grok CLI itself defaults to. Every other Grok row runs exactly the model it names, also after a restart. A conversation or agent pinned to a Grok model the CLI no longer offers fails before anything is sent: *Model '&lt;id&gt;' cannot be run by this CLI: Grok CLI does not offer it (the session would run &lt;default&gt;)*. Pick another model or refresh the list.
- **Claude Code:** the model list comes from the Claude Code runtime EYAS runs (see [Claude Code models and effort](#claude-code-models-and-effort)). Each row names the concrete Claude model its alias runs, for example *opus* runs *claude-opus-5-5*. The **Claude Code (Default)** row runs whatever model the runtime uses by default. A full model name also works.
- **Kimi Code CLI:** the model list comes from Kimi itself, and EYAS switches each session to the model you picked (see [Kimi models and thinking](#kimi-models-and-thinking)). The **Kimi Code CLI** default row runs the model Kimi is currently set to.
- A model id that names no model (for example just `grok-cli-`) makes the turn fail with a clear error instead of running something else.

**API model lists.**

- **Anthropic:** when you add an API key, EYAS reads the models that key can use from Anthropic's Models API. It is a free list call, not a model call, and it brings each model's context window, output limit and effort levels. If the Models API cannot be reached, the built-in list is used. Existing installs keep their stored list until you press **Refresh models**; newer models such as Opus 5.5, Opus 5, Sonnet 5 and Fable 5.1 then appear, and older rows (Opus 4.7, Opus 4.6) keep working while they are stored.
- **OpenAI:** before the first refresh the built-in list is GPT-5.6, GPT-5.5, GPT-5.4, GPT-5 mini, o3-mini, GPT-4o and GPT-4o mini. GPT-4 Turbo is no longer built in; **Refresh models** still lists it if OpenAI offers it. A refreshed model EYAS already knows keeps its context window and output limit.
- **OpenRouter:** **Refresh models** also reads which models OpenRouter marks as supporting reasoning. The built-in list is Claude Sonnet 4.6, Claude Opus 4.6, GPT-5.5, Gemini 3.1 Pro preview and GPT-4o.
- **Kimi API:** Kimi K2.5 is no longer built in; it appears only if Moonshot still lists it on **Refresh models**.
- **Gemini:** the built-in list holds the current 3.x models; the retired `gemini-2.0-flash`, `gemini-2.5-pro-preview-05-06` and `gemini-2.5-flash-preview-05-20` are gone. Existing installs keep their old rows until you press **Refresh models**, which switches off and flags what the API no longer offers. The 2.5 family appears after a refresh only if your key still has access (Google limits 2.5 to projects that used it before). A request that names no Gemini model goes to `gemini-3.8-flash`.
- **Ollama:** when the provider is enabled and reachable, EYAS reads each model's capabilities from Ollama on load, in the background, and on **Refresh models**. Models Ollama no longer lists are marked *Not offered by the last refresh* and switched off after a load too. A disabled or unreachable Ollama is never contacted.

**API (integrators).** `GET /api/v1/model/providers/:id` and `GET /api/v1/model/models` return per model `realModelId`, `missing` (true when the last refresh no longer offered it) and the effective reasoning capability. `POST /api/v1/model/providers/:id/models/refresh` returns the `missing` and `restored` lists, or `502` with `ModelDiscoveryFailed` / `ModelDiscoveryEmpty`.

### Reasoning effort {#reasoning-effort}

Reasoning effort is decided per model, at the moment a model actually answers. When the model changes — routing, a retry or a fallback — EYAS works the level out again for the new model.

- A level the model does not support is adjusted to the nearest one it does. *Max* on a model that tops out at *Extra high* runs as *Extra high*; *Extra high* on a model without it runs as *High*.
- A model that cannot switch reasoning off gets its lowest level when *None* is asked for.
- A model EYAS has no verified facts about gets no reasoning parameter at all (**Auto**: the model's own default). EYAS never sends a guessed value.
- Thinking budgets for models that take a token budget (for example Claude Haiku 4.5 or Gemini 2.5) are sized from the model's own output limit and always leave room for the answer, so *Max* cannot exceed the model's limit.

**The ladder.** The full ladder is **None, Minimal, Low, Medium, High, Extra high, Max**, plus **Auto**. Auto stores nothing at that place: the level then comes from further down the order below, and when nothing sets one, nothing is sent and the model's own default applies.

**Where the level comes from** (first match wins):

1. the conversation's own **Effort**;
2. *Max* when the conversation is in **Deep** mode;
3. the effort set on the colleague (agent) the conversation speaks as — in a chat, the conversation's colleague, else the project's default colleague;
4. the level of the nearest conversation that delegated the work (a sub-conversation inherits from its parent, up to five levels up);
5. the routing tier's default, for a message routed through a tier and for EYAS's background calls (see [Routing & budget — Tier default effort](/docs/en/ai/routing-budget/#tier-effort));
6. the model's own default.

The same order applies wherever a colleague or specialist runs: interactive chat, a colleague's home thread, background and scheduled runs, retries and resumes (a resumed run uses exactly the effort its first run used), team members, delegated tasks and specialists, pipeline stages, A2A tasks, replies on messaging channels, and God Mode. So a colleague's own effort applies in its chat and on channels, and a team member or specialist without its own effort inherits the delegating conversation's level — a **Deep** conversation therefore sends its specialists to *Max*, which costs more. A member or specialist with its own effort keeps it. In God Mode, an effort set on the conversation is copied to every racer and Deep mode is passed on; each racer's level is then fitted to its own model, and the cross-review votes use the conversation's effort too.

**One Effort select, per model.** The conversation field bar, the colleague editor, each routing tier and a scheduled agent routine all use the same **Effort** select. It lists only the levels the relevant model accepts — for example *Extra high* on models that offer it (Claude Opus 4.7/4.8/5.x, GPT-5.4/5.5/5.6), *None* and *Minimal* where the model has them. An on/off model shows **Off / On**. A model with no effort control, or one EYAS has no verified facts about, offers only Auto, and a hint says why; a hint also says when a model does not show its reasoning text. In an Auto-routed conversation, or for a colleague without a fixed model, no single model is fixed: the select offers every level that at least one Auto-routing tier model (Quick, Standard, Complex, Code Execution) accepts, and each message's level is adjusted to the model it runs on.

**Auto says what it means.** Auto is the first entry and names what it falls back to there: `Auto · Max (Deep)`, `Auto · High (colleague)`, `Auto · Extra high (delegating conversation)`, or `Auto · model default (Medium)` — the model's own vendor default.

**The list follows the model.** When a conversation's model, Deep mode or colleague changes, the list updates. A new model never rewrites a conversation's stored effort: a level the new model lacks is shown as, for example, *Extra high → High (Opus 4.6 does not offer Extra high)*, and each turn is adjusted and recorded. In the colleague editor and on a routing tier, picking a model that does not offer the saved level changes it before saving and says so: *Effort adjusted from Extra high to High: the selected model does not offer Extra high.* A model without effort control changes it to Auto.

**Saved levels are checked against the model.** When you set an effort on a conversation, a colleague or a routing tier, EYAS checks the level against the model it runs on. A level that model does not support is refused and nothing is saved — the conversation lists the levels it accepts, and a tier row says *The model does not offer this effort level. Nothing was saved.* Auto is always accepted, and so is every level when the model is not known ahead of time (an Auto-routed conversation, a colleague without a model, a model EYAS has no verified data for); those are adjusted on each call. Changing only the model never fails because of a stored effort.

**What each reply ran with.** Under each reply, next to *Provider · model*, a small chip shows the effort the turn actually ran with: *Effort: High*, or *Effort: Extra high → High* when the model did not offer the requested level. Its tooltip names who set it (conversation, Deep, colleague, delegating conversation, routing tier, model default). There is no chip when nothing was asked for or sent. Each stored reply keeps requested vs effective effort, where the level came from and whether it was adjusted — for chat, delegated and specialist runs, pipeline stages and channels. Every AI call's trace records the same — see [Observability](/docs/en/admin/observability/).

**What the Providers page shows.** Every model row has a reasoning line, for example *Reasoning: Low, Medium, High, Extra high, Max · default Medium*, with a badge saying where the facts come from: *reported by the provider* (the provider's or runtime's own model list), or *EYAS catalog, verified YYYY-MM-DD* (EYAS's versioned catalog of verified reasoning facts). A model without effort control shows *Reasoning: no effort control*; one EYAS does not know shows *Reasoning: unknown to EYAS (effort stays Auto)*.

**API (integrators).** `GET /api/v1/model/effort-options?providerId&modelId` (read Model) returns a model's levels; with a bare model id or alias, the levels of its single owning provider's model; with no model, the Auto tier union. `GET /api/v1/conversations/:id/effort-options` (read Conversation, owner only) returns the levels, the stored level (`current`) and what Auto inherits (`inherited`). A refused level returns `400` with code `EFFORT_UNSUPPORTED`, the level and the model's supported `levels`.

#### How each provider applies the effort level {#effort-by-provider}

EYAS works out one level per call, as above, and each provider only translates it. In every case EYAS sends only what the answering model is known to accept; a model without verified facts gets no reasoning parameter.

| Provider | What EYAS sends for a level | Where the levels come from | Auto | Effective level under the reply |
|----------|-----------------------------|----------------------------|------|---------------------------------|
| Anthropic API | The model's effort setting (where it has one) plus thinking — adaptive, or a token budget where the model takes one; *None* switches thinking off where the model allows it | Anthropic's Models API, with facts it does not report (default, always-on, budget range) from the EYAS catalog | Nothing; a model that thinks by default but hides its reasoning is only asked for a summary | The level EYAS sent |
| Anthropic-compatible endpoints (MiniMax, Synthetic, Xiaomi MiMo) | Nothing | — (no verified facts) | Always | — |
| OpenAI | `reasoning_effort`, with the output limit as `max_completion_tokens` and no temperature | EYAS catalog | Nothing | The level EYAS sent |
| OpenRouter | `reasoning: { effort }`; OpenRouter passes it to the upstream model and may adjust it | OpenRouter's model list (reasoning yes/no); known families from the EYAS catalog | Nothing | The level EYAS sent |
| Kimi API (Moonshot) | `reasoning_effort` (K3) or thinking on/off (K2.6); no temperature | EYAS catalog | Nothing | The level EYAS sent |
| OpenAI-compatible gateways (xAI, Mistral, Groq, Together, DeepSeek, Cerebras, Venice, Hugging Face, NVIDIA, Z.AI, Kilo, Vercel AI Gateway, Qianfan, vLLM) | Nothing — except `reasoning_effort` for xAI's Grok 3 Mini | EYAS catalog for Grok 3 Mini on xAI; no other gateway's reasoning control is verified yet | Always, except Grok 3 Mini | The level EYAS sent (Grok 3 Mini); otherwise — |
| Gemini | A thinking level (Gemini 3) or a thinking budget (Gemini 2.5), with thought summaries | EYAS catalog; Google's model list can mark a model as non-thinking | Nothing; models that think by default are only asked for their summaries | The level EYAS sent |
| Ollama | `think`: on/off, or the model's own named level | Ollama's model information (the *thinking* capability and its values); gpt-oss from the EYAS catalog | Nothing | The level EYAS sent |
| LM Studio | Nothing — reasoning is set in LM Studio | — | Always; the panel shows LM Studio's own setting | — |
| Claude Code CLI | The effort the running binary reported for the model; *None* switches thinking off where the model allows it | The Claude Code runtime itself, read without a prompt | Nothing | Read back from the runtime |
| Grok CLI | The session's reasoning-effort option, set before the prompt | The Grok CLI itself, read without a prompt | Nothing; the turn records the level Grok used | Read back from Grok every turn |
| Kimi Code CLI | The model's thinking or plain variant, selected in the session | Kimi's own model list | Keeps the variant Kimi runs now | Read back from Kimi every turn |

*The level EYAS sent* means the chip under the reply shows the level after EYAS fitted it to the model. *Read back* means the CLI reports the level it actually ran, and that is what the chip and the trace record, even when it differs from what EYAS asked for.

**Details per provider.**

- **Anthropic API.** The choices for a Claude model are exactly the levels it supports: *Extra high* exists on Fable, Opus 5.5, Opus 5, Opus 4.7, Opus 4.8 and Sonnet 5, but not on Opus 4.6 or Sonnet 4.6; *Off* is offered only where the model can switch reasoning off (not on Fable or Opus 5.5). Haiku 4.5 and Sonnet 4.5 have no effort setting, so the level becomes a thinking budget sized to the model's output limit, and EYAS raises the response length limit so reasoning never cuts off the answer. Auto sends nothing (Opus 5.5 defaults to Medium; Opus 4.8 does not think unless asked). Models that hide their reasoning unless asked (Fable, Opus 5.5, Opus 5, Opus 4.7, Opus 4.8, Sonnet 5) are asked for a reasoning summary whenever they think — on Auto too, for those that think by default — so it shows in the chat; this changes only what is shown. EYAS does not send temperature, `top_p` or `top_k` to models that reject them (Fable, Opus 5.5, Opus 5, Opus 4.7/4.8, Sonnet 5), and never together with switched-on thinking.
- **Anthropic-compatible endpoints** (MiniMax, Synthetic, Xiaomi MiMo): only Auto. EYAS sends no reasoning control until a model's behaviour is verified; temperature is passed as set.
- **OpenAI.** Every GPT-5-generation model the Chat Completions API serves, and the o-series, get the level, each with its own range: GPT-6 Astra Low–Max (cannot be switched off); GPT-5.6 None–Max, default Medium; GPT-5.5 None–Extra high, default Medium; GPT-5.4 None–Extra high, default None; GPT-5.4 mini / nano and GPT-5.2 None–Extra high, default None; GPT-5.1 None–High, default None; GPT-5 / GPT-5 mini / nano Minimal–High, default Medium; GPT-5 pro High only; o1 / o3 / o3-mini / o4-mini Low–High, default Medium. A missing level moves to the nearest one (*Max* on GPT-5.5 runs as *Extra high*). For these reasoning models EYAS never sends a temperature and uses the reasoning-model output limit (`max_completion_tokens`) — background calls such as memory capture included, which before could be rejected by GPT-5.2 and GPT-5.4 mini / nano. With an explicit level, a small output limit is raised to what the level needs (Low 8k, Medium 16k, High 32k, Extra high/Max 64k tokens, never above the model's own limit). Models without verified facts (GPT-4o, GPT-4o mini and others) get no reasoning parameter and keep `max_tokens` and temperature. Some OpenAI models exist only on OpenAI's Responses API, not on the Chat Completions API EYAS uses: GPT-5.2 pro, GPT-5.4 pro, GPT-5.5 pro, the Codex models (GPT-5 Codex, GPT-5.1 Codex / Codex Max, GPT-5.2 / 5.3 Codex, codex-mini), o1-pro, o3-pro and the deep-research models. On the OpenAI provider they stay Auto-only and cannot answer; use them through OpenRouter. GPT-5.1 mini has no published effort levels, so it stays Auto.
- **OpenRouter.** Models OpenRouter marks as supporting reasoning offer Minimal–Max; models it lists without reasoning get no effort control. Known families show their real levels: Claude Opus/Sonnet 4.6 (Off, Low, Medium, High, Max), OpenAI GPT-5.x / GPT-6 Astra / o-series (as on OpenAI), Gemini 3.x (Gemini's thinking levels, so *Extra high* runs as *High*). Also known: GPT-5.2 None–Extra high (default None); GPT-5.2 pro Medium–Extra high; GPT-5.4 pro Medium–Extra high (default Medium); GPT-5.5 pro Medium–Extra high (default High); GPT-5.4 mini / nano as on OpenAI; GPT-5.2 / 5.3 Codex Low–Extra high. *Off* is offered only where the family can switch reasoning off.
- **Kimi API (Moonshot).** Kimi K3: Low / High / Max (default Max; Medium runs as Low). Kimi K2.6: reasoning on (High) or off (None). Kimi K2.7 Code and K2.7 Code Highspeed always reason and have no effort control.
- **OpenAI-compatible gateways:** only Auto, including vendor-prefixed ids such as `openai/gpt-5.4`. On the xAI API provider, Grok 3 Mini (and Grok 3 Mini Fast) is the one model with an effort control: **Low** or **High** (*Medium* runs as Low; *Extra high* and *Max* run as High). It always reasons, and its reasoning is shown. xAI no longer lists Grok 3 Mini, and Oracle Cloud retired it on 2026-08-15, so it may no longer answer. Other Grok models on the xAI API reason at xAI's default: EYAS talks to xAI over Chat Completions, where xAI documents no effort parameter for them. The Grok CLI provider keeps its effort control.
- **Gemini.** Gemini 3 models (3.8/3.7/3.6/3.5 Flash, 3.5/3.1 Flash-Lite, 3.1 Pro Preview, 3 Flash Preview) take a thinking level — Minimal, Low, Medium or High. A missing level moves to the nearest one (3.8/3.7 Flash and 3.1 Pro have no Minimal, so it becomes Low; *Extra high* and *Max* become High). Gemini 3 models always think, so *None* runs them at their lowest level. Gemini 2.5 models take a thinking budget derived from the level, within the model's range (2.5 Pro 128–32,768 tokens; 2.5 Flash up to 24,576; Flash-Lite 512–24,576); *None* switches thinking off on 2.5 Flash and Flash-Lite, while 2.5 Pro runs at its smallest level. Google bills thinking tokens either way. A small output limit is raised to fit the level, never above the model's own limit. Models Google's list marks as non-thinking (for example TTS variants) get no thinking parameter.
- **Ollama.** Models that report the *thinking* capability get **On / Off**: *None* turns thinking off, any higher level turns it on. gpt-oss takes Low, Medium and High (default Medium) and cannot be switched off (*None* becomes Low). A recent Ollama that reports a model's exact thinking values gets exactly those, with Ollama's default marked. Auto sends nothing (thinking models think by default). A model without the capability, or whose capabilities could not be read, never gets a thinking setting — Ollama would refuse the request. With an explicit level, a small max-tokens setting is raised to leave room for thinking.
- **LM Studio.** EYAS never sends a reasoning or effort parameter to LM Studio, so any level there is effectively Auto. When LM Studio reports a model's reasoning setting, the LM Studio panel shows it per model, for example *qwen/qwen3-8b — Reasoning for this model is set in LM Studio itself (default there: on). EYAS shows it and does not change it.* Older LM Studio versions show no hint.
- **Claude Code CLI, Grok CLI, Kimi Code CLI.** See [Claude Code models and effort](#claude-code-models-and-effort), [Grok models and effort](#grok-models-and-effort) and [Kimi models and thinking](#kimi-models-and-thinking).
- **OpenCode** is a tool sidecar, not a chat provider: its model and reasoning variant are set on the OpenCode page (see [OpenCode — Model and reasoning](/docs/en/automation/opencode/#model-and-reasoning)).

**New versions of a known model.** A date-stamped snapshot, a `-latest` alias or a `[1m]` context variant of a model EYAS knows gets that model's levels — for example `gpt-5.4-mini-2026-03-17` or `kimi-k3-0115`. A different variant (pro, codex, chat, preview, beta, fast, …) or an unknown model family stays Auto-only until EYAS has verified facts for it. Levels never carry over from one provider to another.

### Claude Code runtime {#claude-code-runtime}

EYAS runs the Claude Code CLI you installed, and uses **one binary for everything**: the sign-in check, the provider's availability, first-run auto-setup, model discovery and every conversation turn. What `eyas doctor` reports is what runs. The binary is chosen in this order:

1. `EYAS_CLAUDE_CODE_BIN` — an absolute path to the `claude` executable.
2. The `claude` found on the server's PATH.
3. As a last resort, the older Claude Code copy bundled inside EYAS's Agent SDK dependency (currently 2.1.89). `eyas doctor` warns when this is used.

`EYAS_CLAUDE_CODE_BIN` is an environment variable on purpose, not a UI setting. Use it when the service's PATH lacks `claude` (launchd/systemd services, containers) or to pin a specific install. If it is set but invalid (not absolute, missing or not executable), the Claude Code provider stays off: there is **no** fallback to PATH or the bundled copy, and doctor reports a failure.

**Version skew.** EYAS's SDK client was built for Claude Code 2.1.89. A newer CLI is used as it is, and doctor shows a *version skew* warning. Options that only newer CLIs understand are sent only to runtimes that have them (for example summarized thinking, from 2.1.280). Claude Code does not update itself while EYAS runs it (see [Claude Code isolation](#claude-code-isolation)); update it yourself as usual, and check its doctor line afterwards (see [Proven CLI versions](#proven-cli-versions)).

**Signed in, not just installed.** EYAS checks sign-in with `claude auth status --json`, a local command that starts no session, sends no prompt and costs nothing. The Claude Code provider registers — and a fresh install turns it on automatically — only when that binary is signed in: a claude.ai login, `ANTHROPIC_API_KEY`, or a Bedrock/Vertex setup. `claude` merely being on PATH is not enough. If you sign in later, turn the provider off and on again under Providers, or restart EYAS. The account e-mail and organisation the command prints are never logged or stored.

**No hidden model calls.** EYAS never sends a test prompt to the host CLI to check it or to list its models. The model list is read from the runtime itself, without a prompt — see below.

**Thinking.** EYAS does not switch thinking off on Claude Code turns unless *None* is asked for. When no effort is requested, the model's own default applies. A requested level is sent only as the effort that runtime reported for the model; fixed thinking-token budgets are not sent. For the ladder and where a level comes from, see [Reasoning effort](#reasoning-effort).

#### Claude Code models and effort {#claude-code-models-and-effort}

**The model list comes from the runtime.** EYAS asks the Claude Code runtime it actually runs — the same binary `eyas doctor` reports — which models it offers. This happens every time the provider starts and when you press **Refresh models**. It sends no prompt, costs nothing and runs isolated from your own Claude Code settings; the account details in that answer are never read or stored.

- Every entry names the concrete Claude model its alias runs, for example *opus* runs *claude-opus-5-5*. The **Claude Code (Default)** entry runs whatever model the runtime uses by default.
- Entries the runtime stops offering are switched off and marked, never deleted — for example Fable is switched off on a runtime that does not know it.
- **Effort levels per model are exactly what the runtime reports**, including *Extra high* where it offers it. A model the runtime offers no effort control for, such as Haiku, offers only Auto. Auto sends nothing, so the model's own default applies (for example Medium on Opus 5.5).
- EYAS never sends a level the running binary did not report for that model. If the stored levels came from a different Claude Code version, no level is sent until the next start or refresh.
- Summarized thinking (so the model's reasoning is visible in the chat) is requested from Claude Code 2.1.280 or newer. An older Claude Code — including the 2.1.89 copy bundled with EYAS — offers no way to request it: for the models that hide their thinking unless asked (Fable, Opus 5.5, Opus 5, Opus 4.7/4.8, Sonnet 5) the effort select then says *This model does not show its reasoning text.* The effort levels themselves are unchanged. Update Claude Code to 2.1.280 or newer and refresh the models (or restart EYAS) to see the reasoning.
- **Context window.** The Fable, Opus, Sonnet and Haiku entries list a 200k window — the window the runtime gives these names — also on the first start or while the runtime's model list cannot be read. Only an entry the runtime itself offers as its 1M variant (for example *Opus (1M context)*, alias `opus[1m]`) is listed and sized at 1M. When the runtime reports a larger window for the model that answered, the context bar still uses that. An entry an earlier version stored at 1M, and no model read has confirmed since, is corrected to 200k at the next start, even while the model read keeps failing; entries you switched off stay off.
- **The effective effort is read back** from the runtime on every turn: you ask for *Extra high* and the runtime runs *High*, and the reply says so; with Auto the reply names the level the model actually used.
- **Each answer records the concrete model that answered**, in traces and memory attribution. A turn with no model chosen is attributed to *Claude Code (Default)*.

**Background calls on a CLI.** Background model calls (memory capture, titles, safety checks) use a specific Claude Code, Grok CLI or Kimi Code CLI model from a routing tier only when that CLI's own discovery offered that model; otherwise they run on the CLI's default model. Where EYAS's background work goes right now is shown on [Routing & budget — Background model calls](/docs/en/ai/routing-budget/#background-model-calls-card).

**Background calls keep their output limit on a CLI.** EYAS's own small one-shot calls — conversation titles, message triage, memory capture, the security judge's verdict, consolidation and similar background passes — ask for a maximum answer length. The CLIs take no output limit from EYAS, so on Claude Code, Grok CLI and Kimi Code CLI EYAS counts the answer as it streams: once it passes about four characters per requested token (`maxTokens` × 4 characters), EYAS stops the CLI (Claude Code: the query is closed; Grok and Kimi: the session is cancelled). The call then ends normally with the answer up to that point and the stop reason *max tokens* (*Output limit reached*), never with an error — as on the API providers. Only the answer counts; reasoning does not use up the limit. Chat and agent turns with tools are not affected, because one CLI turn runs many model calls. The release check proves this on Claude Code 2.1.281 and Grok CLI 1.0.41; Kimi Code CLI uses the same code path but has not been live-tested.

### Claude Code isolation {#claude-code-isolation}

EYAS always runs Claude Code isolated. There is no switch: the earlier **Load host Claude config** option is gone. The provider panel says so in one line and points to the data import for bringing host `CLAUDE.md` content in.

Every Claude Code run — chat, agents, background work and isolated one-shot calls alike:

- loads no host `settings.json` (so no hooks or permission rules), no `CLAUDE.md` at any level (user, project or local), no host skills, and no project `.mcp.json`, filesystem or claude.ai MCP servers. Its only tool server is EYAS's own `eyas` server; background one-shot calls get none;
- runs with Claude Code's own auto-memory switched off;
- keeps its temporary files, including the output of shell commands it runs in the background, in a private folder of that run inside EYAS's workspaces folder — not in the host's `/tmp/claude-<uid>`. The folder is removed when the run ends; one a crash left behind is removed at the next start;
- writes no transcript under `~/.claude/projects` and makes no file-checkpoint copies, so EYAS runs do not appear in `claude --resume` (transcripts written by earlier EYAS versions are not deleted automatically);
- keeps the host sign-in: a claude.ai subscription, API key, OAuth token, Bedrock or Vertex keeps working.

Enterprise-managed policy settings, where an organisation deploys them, still apply; EYAS cannot turn that tier off.

Project instruction files inside a conversation's folder (`CLAUDE.md`, `AGENTS.md`) are not loaded automatically either. The model can still open them with its file tools.

**Working folder.** Claude Code works in the conversation's first Folder that still passes validation, else in the conversation's own EYAS workspace. It never runs in the EYAS server's own directory (the EYAS home, where the key file, vault and database live). Background calls without a conversation use a temporary per-run scratch folder, removed after 7 days unused. A saved Folder that no longer passes validation is skipped, with a warning in the server log. See [Conversations — Folders](/docs/en/daily/conversations/#working-folders).

**Environment.** Claude Code receives only an allowlisted environment: `PATH`, locale and time zone, proxies and CA bundles, `HOME`, and the Anthropic / Claude OAuth / Bedrock / Vertex sign-in variables. On top of that EYAS sets its isolation switches — `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` and `DISABLE_AUTOUPDATER=1` — points `CLAUDE_CODE_TMPDIR` at the run's own temporary folder, and identifies itself to Claude Code as `eyas`. Other server variables are not passed on: other providers' API keys, EYAS secrets, `CLAUDE_CONFIG_DIR`, and the `CLAUDE_CODE_*` switches of a Claude Code session EYAS was started from. The sign-in check (`claude auth status`) uses the same environment. Because of `DISABLE_AUTOUPDATER`, Claude Code does not update itself while EYAS runs it.

**Start-up check.** Claude Code reports what it loaded at the start of every run, and EYAS checks that report before using any of the answer. Only EYAS's own tool server may be connected, the permission mode must be `default`, the working folder must be the expected one, and no plugin may be loaded — except the two plugins Claude Code 2.1.281 has built in, `agents-md` and `telemetry`, which are accepted only as `agents-md@builtin` and `telemetry@builtin`. EYAS's release check proved them harmless under its isolation: no `AGENTS.md` from the working folder or a subfolder reaches the model. Any other plugin, including a new built-in plugin a later Claude Code adds, still stops the run. If anything else shows up — for example an MCP server or plugin from the host configuration, or a managed policy that forces another permission mode — EYAS stops the run at once. Nothing from that run is shown, and the turn fails with a CLI isolation error that names the failed checks, in your language — for example *Claude Code CLI was stopped: EYAS could not confirm that it runs isolated (the working folder was not the one EYAS chose). The turn was not handed to another model.* It is not retried and is not moved to another provider. The fix is on the host: remove the offending managed setting or plugin, or check which binary `EYAS_CLAUDE_CODE_BIN` points to.

**Claude Code's own tools pass EYAS's memory policy first.** Before Read, Write, Edit, Glob, Grep, Bash, NotebookEdit, WebFetch or any other Claude Code tool runs, one check compares every path it touches with EYAS's memory policy — including the reads Claude Code would otherwise allow on its own inside its working folder. Other tools' memory (`~/.claude`, `~/.grok`, `~/.codex`, Obsidian vaults, the rest of the list and `security.foreignMemoryPaths`), EYAS's own data folder and another conversation's workspace are refused. A refused call does not run; Claude Code gets the reason — for example *Memory outside EYAS (Obsidian) — use memory_search / memory_expand from EYAS* — and can carry on with EYAS's memory tools. Grep, Glob, LS and recursive Bash searches are judged by everything they can reach: one whose folder contains a protected place — for example a Grep of `~`, or a Grep of the EYAS checkout, which holds `data/` — is refused as *Search too broad …*, and Claude Code can retry on a narrower folder. See [Security & privacy — Memory outside EYAS](/docs/en/admin/security-privacy/#memory-outside-eyas). On top of that check, Claude Code's shell commands run inside the operating system's file sandbox where one is available — see [Kernel file sandbox](#kernel-file-sandbox).

**EYAS tools on Claude Code.** Claude Code reaches EYAS tools through the in-process `eyas` MCP server, named `mcp__eyas__<name>` in its prompt. That server offers exactly the tools EYAS offers the run: the agent's **Tools** list plus `memory_search` and `memory_expand` (an empty list means all tools). In a **Solo** conversation it offers no delegation tools. The EYAS tools for which Claude Code has a granted equivalent of its own are not passed — `read_file`, `grep` and `glob` (its Read, Glob and Grep), `write_file` and `edit_file` while it may write, and `run_command`, `git_status` and `git_diff` while it may use its shell: Claude Code then uses its own tools in the turn's folders, under the sandbox and the memory policy. On a list without `run_command`, `git_status` and `git_diff` are passed as EYAS tools instead. Every other EYAS tool is passed, including the EYAS browser tools (`browser_*`, with saved sessions and `browser_totp`), `agent_browser_*`, `browser_use_*` and `opencode_*`; they run in EYAS under the same security gate, approvals and tool scope as on an API provider. Memory drill-down counts **3 calls per answer**, as on every other provider. See [MCP — CLI MCP tool parity](/docs/en/ai/mcp/#cli-mcp-tool-parity-grok--kimi).

**The agent's Tools list also limits the CLI's own tools.** On Claude Code, Grok CLI and Kimi Code CLI alike, an agent's **Tools** list decides which of the CLI's own built-in tools the model may use, not only which EYAS tools it reaches over the bridge — the same way it limits an API model:

- **Writing files** (Claude Code's Write, Edit and NotebookEdit; Grok's and Kimi's edit and move tools, and file writes EYAS serves to the CLI): only when the list contains `write_file` or `edit_file`.
- **Shell commands** (Claude Code's Bash; Grok's and Kimi's execute tools; a delete counts as a shell command too, as the security gate classifies it): only when the list contains `run_command`. `git_status` and `git_diff` do not grant the shell.
- **Web fetch and web search** (Claude Code's WebFetch and WebSearch; Grok's and Kimi's fetch tools, and Grok's web_fetch and web_search): only when the list contains a web tool — `research`, `browser_navigate`, `agent_browser_run` or `browser_use_exec`.
- **Reading files** (Claude Code's Read, Glob and Grep; Grok's and Kimi's read, search and list tools) is always allowed, whatever the list says. It stays inside the conversation's folders under the memory policy and the kernel file sandbox. Memory search is always available too.
- An empty list still means every tool, the CLI's own tools included.

On Claude Code the withheld tools are not offered to the model at all. On Grok and Kimi, a withheld tool the CLI tries to use is refused by EYAS before the security gate is asked: there is no approval prompt, and the tool row shows **Denied** (Grok shows its own rejection text on the row). Kimi's permission requests do not say what kind of tool is asking (read from the Kimi 1.52.0 source; not yet verified on a host), so EYAS refuses a Kimi request it cannot classify whenever the agent's list lacks either the file-write tools or `run_command` — such an agent cannot use any of Kimi's asking tools (file write or replace, shell, background tasks). Kimi's web search and fetch never ask EYAS, so they cannot be allowed per agent; EYAS's isolation check still stops a turn that uses them. **Migration:** existing agents with a narrow list — for example a Personal Assistant without `run_command` / `write_file` — can no longer write files or run commands on Claude Code, Grok or Kimi. To allow it, add `write_file` / `edit_file` and/or `run_command` to the list, or clear the list. See [Agents — Tools](/docs/en/agents/configure/#tools--constraints).

**Specialists.** Claude Code does not start hidden subagents of its own (its built-in Task/Agent tool is not offered). When a colleague on Claude Code fans work out, it starts specialists through EYAS with `run_specialist`, exactly as on the other providers — see [Teams & delegation](/docs/en/agents/teams/).

**Upgrade.** An install that had **Load host Claude config** on is switched to isolated automatically; the stored setting is removed on the first start, and any leftover value is ignored. Host `CLAUDE.md` instructions and host skills no longer reach conversations. To keep that content, import it once, one-way, with **Settings → System → Data portability → Import data** — see [Data import](/docs/en/admin/data-port/).

### Grok CLI and Kimi Code CLI {#grok-cli-and-kimi-code-cli}

EYAS runs Grok CLI and Kimi Code CLI fully isolated from the machine's own Grok, Kimi and Claude setup.

**Own home.** EYAS starts each CLI with its own home folder inside the EYAS data folder — `<data dir>/cli-homes/grok-cli` and `<data dir>/cli-homes/kimi-cli`. EYAS runs do not read or write the operator's `~/.grok`, `~/.kimi`, `~/.claude`, `~/.cursor` or `~/.agents`: no host config, rules or `AGENTS.md`, memory, skills, hooks, Claude/Cursor imports or MCP servers (for example an Obsidian vault server).

**Environment.** Only a short allowlist reaches the CLI: `PATH`, locale and time zone, `TMPDIR`, `TERM`, `USER`, `LOGNAME`, `SHELL`, proxy variables and CA-bundle variables. EYAS secrets, other providers' keys, an `XAI_API_KEY` in the server environment and any `GROK_*`, `KIMI_*` or `XDG_*` setting of the server are dropped.

**Which binary.** `EYAS_GROK_BIN` / `EYAS_KIMI_BIN` (the absolute path to the executable) take precedence, else `grok` / `kimi` on PATH. If the variable is set but invalid, the provider is not registered — there is no fallback to PATH. Reloading the provider (off and on) finds the binary again.

**Working folder.** A Grok or Kimi turn runs in the conversation's first valid Folder, else the conversation's own EYAS workspace, else a private run scratch folder — never in the EYAS server's own working directory.

**Grok settings EYAS writes.** Before every run EYAS writes `config.toml`, `requirements.toml` and an empty `trusted_folders.toml` in its Grok home; local edits there are replaced. They set:

- **Ask mode.** Every native Grok tool — read file, list folder, search, shell, write/edit, web fetch and search, subagents — asks EYAS first, and EYAS's security gate decides.
- **Always-approve is locked.** `--always-approve`, yolo mode and `/always-approve` do not work.
- Memory, memory v2, session search, telemetry and trace upload, shared leader mode (Grok is started with `--no-leader`) and auto-update are off.
- Only EYAS's own tool server (`eyas`) may connect.
- **Folder trust is never granted.** A conversation folder's `AGENTS.md`, `.grok` config, hooks and MCP servers are not loaded automatically; the model can still open files with its file tools, and each read asks EYAS.

**Kimi settings EYAS writes.** EYAS sets `default_yolo = false`, `telemetry = false` and `merge_all_available_skills = false` in its own Kimi config and keeps everything else in that file (login, default model). Kimi gets no MCP servers of its own, auto-update is off, and it is started as exactly `kimi acp`. Kimi also saves the model EYAS switches it to in that same file — see [Kimi models and thinking](#kimi-models-and-thinking).

**Session files are deleted.** The transcripts, prompt history and tool logs a CLI writes in its EYAS home are deleted when each turn ends. Leftovers older than one hour (after a crash) are removed at startup and hourly. The EYAS conversation itself is unaffected: EYAS replays it from its own store every turn.

**Grok's shell.** Grok's shell commands run with the EYAS Grok home as `HOME`, so the host `~/.gitconfig`, SSH keys and shell configuration are not available — for example, git commits from Grok's shell have no host identity. Where the server offers one, Grok's own tools also run inside the operating system's file sandbox — see [Kernel file sandbox](#kernel-file-sandbox).

**Turn limit.** For Grok and Kimi the turn limit counts tool calls. A chat turn uses the conversation's colleague's **Max Turns** (else the project's default agent's), or 25 by default; agent runs use the agent's **Max Turns**; the provider's `maxTurns` setting (default 25) applies only to calls that set no budget. When the CLI starts one tool call more than the limit, EYAS cancels the CLI session: the turn ends as *max turns* and keeps the partial answer. This is not an error, and the extra tool call does not run. The same budget is Claude Code's internal turn cap for a chat turn.

**No fixed time limit.** A Claude Code, Grok or Kimi turn is not stopped after a fixed time. It stops only when the CLI goes quiet: 10 minutes with no message while no tool is running, or 20 minutes with no message while a tool runs (for example a specialist started with `run_specialist`, which may take up to 15 minutes, or a long build). Any message from the CLI — streamed text, a tool starting or finishing, a permission request — starts the clock again, and there is no limit on the whole turn; **Stop** still ends it at any time. A turn stopped for silence reports a timeout, not a generic *aborted* error; like other timeouts it may be retried once or failed over when nothing was streamed yet, and a background run may be retried by the auto-retry scheduler. The two limits are `model.cli.idleTimeoutMs` and `model.cli.toolTimeoutMs` — see [Configuration — CLI turn timeouts](/docs/en/deploy/configuration/#cli-turn-timeouts). The per-turn key that lets Grok and Kimi call EYAS tools expires 2 hours after its last use, so a long, busy turn keeps its EYAS tools; it is revoked the moment the turn ends.

**Slash commands.** A message that starts with `/` (for example `/always-approve on`) is sent to Grok or Kimi wrapped in `<message>…</message>`, so the CLI never runs it as one of its own commands. The model still sees the text.

**Kimi limits.** Kimi's isolation is derived from its source code and has not been proven on a machine yet (see [Proven CLI versions](#proven-cli-versions)). Kimi has no folder-trust gate: it still reads `AGENTS.md` / `.kimi/AGENTS.md` in the conversation folder, and up to the enclosing git repository root when the folder is inside a repository. Its search and web tools never ask EYAS, so a Kimi turn that uses them is stopped by the isolation check below. For the same reason EYAS cannot refuse a Kimi search as too broad: Kimi's own Grep and Glob never ask, Kimi's Glob stays inside its working folder but its Grep accepts any folder, and Kimi has no kernel sandbox (see [Security & privacy — Memory outside EYAS](/docs/en/admin/security-privacy/#memory-outside-eyas)). The agent's **Tools** list limits Kimi's and Grok's own write, shell and web tools as described under [Claude Code isolation](#claude-code-isolation).

#### Sign in Grok and Kimi for EYAS {#sign-in-grok-and-kimi-for-eyas}

Because Grok and Kimi run in EYAS's own home, the CLI's login on the computer is not used. **An install that relied on the host login has no working Grok or Kimi model until someone signs in once for EYAS.** The operator's own `grok` / `kimi` login on the host is never read, changed or used, and the EYAS sign-in refreshes on its own.

The **Sign in for EYAS** card appears in three places: the Grok CLI / Kimi Code CLI provider panel, the [setup wizard](/docs/en/setup-wizard/)'s AI provider step whenever Grok or Kimi is detected, and a [Home](/docs/en/daily/home/) banner, *&lt;CLI&gt; needs a sign-in for EYAS*, when an enabled, installed CLI is not signed in (**Sign in** opens the card; **Dismiss** hides the banner for the browser session). Only owners and admins can sign in or out, and only they see a pending sign-in's link and code; other roles see the state.

**Device code (Grok and Kimi).** Click **Sign in with a device code**. EYAS runs the CLI's own login in its own folder and shows a link (**Open the sign-in page**) and a code. Open the link on any device, sign in, and check that the page shows the same code. No browser is needed on the server, so this works on headless servers and in Docker. The card shows *Waiting for you to confirm the code…*, then **Signed in**.

- **Cancel** stops a pending sign-in.
- After 15 minutes without confirmation the sign-in expires; start again. Kimi also restarts with a new code on its own.
- If EYAS cannot find a link in the CLI's output, it shows the CLI's text as it is so you can follow it.
- A failure shows the CLI's last message and **Try again**.

**API key instead (Grok only).** Choose **Use an API key instead** and paste an xAI API key. EYAS stores it encrypted in [Secrets](/docs/en/admin/secrets/) as `grok-cli-api-key` (scope System) and passes it only to Grok CLI runs, as `XAI_API_KEY`. Usage is billed to the xAI API account, not to a Grok/SuperGrok subscription. If both a device sign-in and a key exist, Grok uses the device sign-in. You can also add the key on the Secrets page under that name; EYAS picks it up when the provider panel or wizard card is opened, when the provider reloads, or after the first turn that fails with the sign-in error. Kimi has no API-key option in EYAS.

**Sign out** removes EYAS's Grok or Kimi credential from EYAS's folder and deletes the stored API key. For Grok, EYAS runs `grok logout` inside its own folder. For Kimi, EYAS deletes its own credential file and does not run `kimi logout`, because that command would also clear the operator's Kimi token from the OS keychain. The host login is never touched.

**When not signed in,** a conversation or background turn on that provider fails at once, before the CLI starts, with *&lt;provider&gt; is not signed in for EYAS … sign in under Providers* (error code `cliSignIn`). EYAS does not retry it or silently switch to another provider. An authentication failure the CLI reports during a turn gives the same message.

**Where the credentials live:** `<data dir>/cli-homes/grok-cli/.grok/auth.json` and `<data dir>/cli-homes/kimi-cli/.kimi/credentials/kimi-code.json`, in folders only the EYAS user can open. A [backup](/docs/en/admin/backup/) of the data directory contains them.

**API (integrators, owners/admins; read access for GET).** `GET /api/v1/model/providers/{grok-cli|kimi-cli}/sign-in` returns `{signedIn, method: device|apiKey|null, apiKeySupported, apiKeyStored, session{state: pending|succeeded|failed|expired|cancelled, verificationUrl, userCode, rawPrompt, error}}`. `POST {"method":"device"}` returns `202` — poll `GET` while it is pending. `POST {"method":"apiKey","apiKey":"…"}` returns `200` (Grok only; Kimi returns `400`). `DELETE` signs out; `DELETE ?target=session` only cancels a pending device sign-in. Other providers return `404`. A caller without the right to manage models gets `verificationUrl`, `userCode`, `rawPrompt` and `error` as `null`: whoever confirms the code binds their own account to the EYAS home.

Kimi's sign-in follows the Kimi CLI source and is not yet verified on a real host.

#### Isolation check before every turn {#isolation-check-before-every-turn}

Grok CLI and Kimi Code CLI run only after EYAS has checked that they are isolated. A turn that fails a check stops with an isolation error; it is never retried and never quietly moved to another model.

**Grok is checked before every turn**, without a model call: EYAS runs `grok inspect --json` in the conversation folder, using its EYAS Grok home, and reads back the config files it wrote there. A passed check is reused for 10 minutes for the same Grok binary, folder and home; anything planted in the home (a skill, rule or hook) forces a new check. Grok is refused when:

- it could approve tool calls on its own (the always-approve lock is not in force);
- permission rules or a config layer come from anywhere but EYAS's own files — for example a system-wide Grok config file, or Claude Code managed settings that add permission rules;
- it would start an MCP server other than EYAS's own bridge (servers EYAS's allowlist has disabled are fine);
- hooks, plugins or language servers are configured;
- instruction files, skills or agents come from its home or from outside the conversation's folders;
- Claude, Cursor or Codex imports are on;
- a trusted project folder's own config applies.

**Grok's vendor-managed settings file.** grok 1.0.41 writes a cache of vendor-managed settings, `managed_config.toml`, into its EYAS Grok home; for a normal account it is empty. An empty file is accepted. A file that holds any setting refuses the turn with the checks above (for example *tool approval not locked to EYAS*), and any change to it voids a passed check at once, even within the 10 minutes a passed check is normally reused.

Project instruction files (`AGENTS.md`, `CLAUDE.md`, `.grok/rules`) inside the conversation's folders are not a reason to refuse: the folder is never trusted, so Grok does not load them on its own, but the model may read them with its file tools. Project MCP servers or hooks in such a folder are listed by Grok but never started.

**Kimi is checked from its EYAS home**, because it has no inspect command: in `data/cli-homes/kimi-cli/.kimi/config.toml` auto-approve must be off, merging of host skill folders off, with no hooks and no extra skill folders; `mcp.json` must be empty; and the home's skill folders must hold no skills. Kimi must also keep its data in EYAS's Kimi home: if its share folder pointed anywhere else, the check stops the turn and the model refresh (shown as *tool approval not locked to EYAS*), so a model switch can never write outside that home.

**When the session starts,** a session that begins in a mode that approves tool calls on its own is stopped.

**While the turn runs,** EYAS stops the turn if Grok or Kimi starts or finishes a native tool without EYAS having decided on it (file read or write, search, list, shell, web, subagent, tool search, or an MCP tool that is not EYAS's), or calls its own memory tool. EYAS then cancels the session, ends the turn with the isolation error, and uses nothing the CLI says after that. EYAS's own tools (memory, board and so on — reached by Grok through `use_tool` as `eyas__<name>`) are not part of this check, because EYAS decides each of those calls itself — see *EYAS tools get the same decisions* below.

**The chat message** reads, for example: *Grok CLI was stopped: EYAS could not confirm that it runs isolated (MCP servers other than EYAS's, hooks). The turn was not handed to another model.* It is followed by an **Open provider settings** link. The checks it can name are: tool approval not locked to EYAS; MCP servers other than EYAS's; hooks; plugins or extensions; instructions or skills from outside the conversation; the CLI's own memory; imports from other AI tools; a shared leader process; a trusted project folder; a tool that ran without EYAS's approval; the check could not run.

**To re-verify,** remove the cause — for example the extra MCP server, hook, skill or `AGENTS.md` in the EYAS Grok or Kimi home, or a system-wide Grok config — and send the message again. Every turn checks again. Reloading or re-enabling the provider, or restarting EYAS, runs the Grok check at load, and **Verify now** on the provider panel runs the same checks without a model call (see *Runtime and Isolation on the provider panel* below). `eyas doctor` checks the EYAS homes (see [Proven CLI versions](#proven-cli-versions)).

**Runtime and Isolation on the provider panel.** Select the Claude Code CLI, Grok CLI or Kimi Code CLI card under **Providers**:

- **Runtime** — how EYAS found the binary, its version and its path. Sources: *Host CLI on PATH*, *Operator override (environment variable)* (`EYAS_CLAUDE_CODE_BIN` / `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`) or *Bundled runtime (fallback)* (Claude Code only). The version is the CLI's own; a CLI that reports none reads *version unknown*. Extra lines: *Version X differs from the expected Y* (the Claude Code binary differs from the version EYAS's pinned Agent SDK was built for); *A CLI on PATH (version) is not used.* (an override hides another CLI on PATH); *Not signed in* (Claude Code only — Grok and Kimi show their sign-in on the **Sign in for EYAS** card); *No usable runtime found — install the CLI or set the override*; and, for an override that does not name an executable file, *The override variable is set but does not name an executable file, so EYAS runs no binary for this provider (it never falls back to PATH). Fix or unset it.*
- **Isolation** — a status badge (*Verified*, *Check failed*, *Not verified yet*, *Sign-in required*) and one sentence on how EYAS keeps the CLI isolated and when it checks: Claude Code at the start of every turn, from what it reports when it starts (there is no check without a turn); Grok before every turn with `grok inspect`, without a model call; Kimi's EYAS home before every turn, and Kimi counts as verified only after a session has started on this server with every check passed. Then *Last checked: &lt;time&gt;* or *Not checked since EYAS started.* — the status is kept in memory, so it resets when EYAS restarts — and a **Failed checks** list with the same labels as the chat's isolation error, each with its raw detail.
- A line comparing the installed version with the version EYAS's live isolation release check passed on: passed on this version (with version and date); last passed on another version, not on the installed one; *Not yet verified on a host* — the check never ran with this CLI, so its isolation rests on the CLI's source code only (Kimi today); or the CLI reported no version. Each line ends by noting that every turn is still checked.
- *Remaining risk:* one sentence per CLI. Claude Code shares the server's sign-in, and the release check used an API key and no real model call, so what only a claude.ai account sign-in brings (account-synced skills, account memory, remotely managed settings) is not covered. The release check signed Grok in with an API key; whether a grok.com sign-in makes Grok sync sessions to xAI was not observed. Kimi's own search and web tools do not ask EYAS first: EYAS stops the turn when one runs, but by then it has run and its result may already reach Kimi's model.
- **Verify now** (Grok CLI and Kimi Code CLI; owners and admins, who may manage models) — shown only when the provider is enabled and its CLI was found. It re-runs the checks a provider load runs, without a model call: Grok's `grok inspect` check, Kimi's home read-back, and then, when signed in, a session start without a prompt, which also refreshes the model list. Kimi can move from *Not verified yet* to *Verified* this way. Claude Code has no **Verify now**: it is checked at the start of every turn. Errors read *Verify now needs the provider to be enabled and its CLI to be found.* or *Verification failed: &lt;error&gt;*. The block reloads after a sign-in or sign-out and after switching the provider on or off.

The Grok and Kimi panels no longer say that session resume and tool use use the host login or that the CLI loads its own machine-level config and memory: that stopped being true when Grok and Kimi began running in EYAS's own home. Kimi Code CLI stays enabled by default; the panel says plainly that its isolation is not yet verified on a host.

**API (integrators).** `GET /api/v1/model/providers/{claude-code|grok-cli|kimi-cli}/isolation` (read access to models; any other provider is `404`, no session `401`) returns `{providerId, status: verified|violation|unverified|auth-required, checks[{check, detail}], checkedAt, runtime, hostCli{path, version}|null, signedIn: true|false|null, proof{version, verifiedAt, paidCanary, drift: match|drift|never-verified|unknown-version|null}, canVerify}`, where `runtime` is `{available: true, path, version, source: override|host|sdk-bundled, expectedVersion, skew}` or `{available: false, error: override-invalid|not-found|no-policy}`. `POST …/isolation/verify` needs the right to manage models (otherwise `403`), runs the checks and returns the same view; Claude Code, or a provider that is not enabled or not found, returns `409 {code: 'verifyUnavailable'}`.

**Approvals.** EYAS only ever answers a CLI's permission prompt with *allow once*. If the CLI offers only an *always allow* or session-wide option, EYAS answers *cancelled*. A refusal is *reject once*.

**EYAS tools get the same decisions.** EYAS's own tools that Grok and Kimi reach through the tool bridge (memory, board, documents, e-mail, browser, Odoo and so on) are decided exactly as on the API providers and Claude Code:

- In a chat you are attending, or a channel conversation, a call the security gate allows runs. A tool marked as needing approval no longer waits in the Approvals queue just because the model is Grok or Kimi, and the autonomy levels do not apply to attended chats. A call the gate escalates shows an approval card in the conversation and an entry in Approvals; the chat is not paused.
- In background runs (scheduled, team, pipeline, or any run not labelled as attended) the autonomy ladder applies: a call in a category at **Notice** or **Approve** waits for approval, and a call the gate escalates always waits for a person, even when its category is at **Auto** (before, such a call ran unasked on Grok and Kimi). A supervised run pauses as **Waiting approval** once the CLI's turn ends, and approving lets exactly that call run once.
- A resumed or retried run that repeats an EYAS tool call the original run already completed (the same e-mail or invoice, for example) is refused before it runs; the tool row shows **Skipped** with *already executed on the original run — duplicate side effect prevented*. The same tool with other arguments still runs.
- A tool outside the agent's **Tools** list is refused as **Denied** before the security gate is asked, so it never creates an approval entry. Without a running security gate every bridged EYAS tool call is refused.

Proven on the installed Grok CLI by the release check. The same decisions apply to Kimi, because they are made in EYAS; how a real Kimi binary reports these calls in its own stream (which a resume's duplicate check is built from) has not been verified on a host yet. See [MCP — How the bridge is secured](/docs/en/ai/mcp/#how-the-bridge-is-secured).

**A refused call ends a Grok answer.** When EYAS refuses one of Grok's tool calls — for example a read of memory outside EYAS — Grok ends that answer (verified on grok 1.0.41). The chat shows the refused tool row and nothing after it, and Grok's model does not see EYAS's reason, so ask again without that step. Claude Code instead continues and receives the reason.

**File access.** Files that Grok or Kimi read or write through EYAS are limited to the conversation's folders (the Folders that still pass validation, plus the working folder), with symbolic links resolved — also for a new file under a linked folder. `..` escapes, sensitive files and, when there is no folder, every file are refused. After that, the memory policy applies (other tools' memory, Obsidian vaults, EYAS's own data folder and other conversations' workspaces are refused). Each file operation is judged once: a read or write already approved through the tool call's permission prompt is served without asking again. Partial reads (start line and line count) are supported.

**Background work.** Grok and Kimi are used for EYAS background calls (titles, the security judge, and so on) only while their isolation is verified: Grok after its load-time check, **Verify now** or any turn's session start passes; Kimi only after a session has started on this host (a **Verify now** while signed in starts one). Such a call gets no EYAS tools, every permission and file request is refused, and its first tool call ends it. Its answer is held to the output limit EYAS asks for (see [Claude Code models and effort](#claude-code-models-and-effort)).

#### What Grok and Kimi receive {#what-grok-and-kimi-receive}

- **EYAS's system prompt, checked.** Kimi receives the EYAS system prompt at the top of every message, marked as EYAS system instructions. Grok can replace its own default system prompt with EYAS's, but it only records which prompt it used once the model has been asked, so EYAS checks after each turn — in its own Grok home, before that turn's session files are deleted. On the first turns after EYAS starts, or after the `grok` program is replaced, the prompt is sent both ways (as Grok's system prompt and at the top of the message), so no answer depends on an unchecked path. Once the check passes, later turns send it only as Grok's system prompt, and every turn is checked again. If the model answered without EYAS's prompt, EYAS logs a warning and sends the prompt at the top of the message from then on (until restart or a new `grok` program). There is nothing to configure.
- **The whole history, images included.** Every turn replays EYAS's conversation history, including images from earlier turns in their place. Images are passed only when the installed CLI says, at the start of each run, that it accepts image input. When it does not, each image is replaced by a short note to the model, for example *[image omitted (image/png): this model cannot see images]*, so the model knows one was there; the composer warns before sending and the turn shows a notice (see [Images and models that cannot see them](#images-and-models-that-cannot-see-them)). Replaying the full history, images included, costs prompt tokens on every turn, as it already does on the API providers.
- **The Vision badge follows the CLI.** The **Vision** badge of the Grok CLI and Kimi Code CLI models follows what the CLI reports on every turn. Grok CLI 1.0.40 reports no image input, so Grok CLI models show Vision off. Kimi models keep their default until the first turn reports. After a restart, a **Refresh models** before the first turn can show the default again; the next turn corrects it.

#### Grok models and effort {#grok-models-and-effort}

EYAS reads Grok's models, and the reasoning-effort levels each accepts, from the Grok CLI itself: it opens a session in its EYAS Grok home without sending a prompt, so there is no model call and no cost. For example, grok-4.6 and grok-4.7 offer low, medium, high and xhigh; grok-4.5 offers low, medium and high; a model without reasoning control offers none. This happens every time the provider loads (EYAS start, provider reload) and when you press **Refresh models**, and is skipped while Grok is not signed in for EYAS. A model the CLI stops offering is marked and switched off, never deleted, and the effort choices for a Grok model match what it really accepts.

On every turn EYAS sets the chosen effort inside the Grok session before the message is sent, and reads back the level Grok applied. An unsupported level is first moved to the nearest one the model accepts (*max* on grok-4.5 runs as *high*). If Grok still refuses a level, the turn runs at Grok's own level, and that is what the turn records. **Auto** sends nothing: the model runs at its own default (high for current Grok models), and the turn records which level that was. The operator's own `~/.grok` configuration, including its default effort, decides nothing. Every Grok turn also records the model Grok actually ran, as Grok reports it.

#### Kimi models and thinking {#kimi-models-and-thinking}

`kimi acp` ignores the `--model` and `--thinking` options, so on every turn EYAS opens the Kimi session, checks that it is isolated, and then switches it to the chosen model and thinking variant before sending the prompt.

- **Where the models come from.** Kimi's own model list — the models of its own config, for example `kimi-code/kimi-for-coding` after the Kimi Code sign-in. EYAS reads it without a prompt and without a model call, by opening one session in its own Kimi home: in the background each time the provider loads (only while Kimi is signed in for EYAS) and when you click **Refresh models**. Rows are named *Kimi Code CLI (&lt;model name&gt;)*. The **Kimi Code CLI** default row runs whatever model Kimi is currently set to.
- **Thinking per model, from what Kimi lists.** A model with a normal and a thinking variant gets an **On / Off** effort choice (*None* = thinking off, *High* = thinking on). An always-thinking model offers only High (*None* becomes High). A model without thinking offers no effort control. Auto keeps whatever thinking Kimi runs right now, also when the model changes. After each turn EYAS reads back which model and variant actually ran and records it as the effective model and effort.
- **Kimi remembers the last choice.** When EYAS switches the model, Kimi saves it in its own config file (inside EYAS's Kimi home, never `~/.kimi`) and uses it as its default from then on. So the **Kimi Code CLI** default row runs the model EYAS selected most recently in any conversation. For a stable choice, pick a specific Kimi model.
- **Before the list is read** (not signed in yet, or the read failed), the provider panel says: *EYAS has not read Kimi's model list yet, so it cannot pin a model or switch thinking on or off: Kimi runs the model it is set to itself. Sign Kimi in for EYAS, then click “Refresh models”.* In that state EYAS sends no model or thinking choice.
- **A model Kimi does not offer** stops the turn before the prompt with an error saying Kimi does not offer that model. It is never silently replaced by another model.
- **Retired rows.** The fixed rows *Kimi Code CLI (K3)*, *(K2.7 Code)* and *(K2.6)* named Moonshot API models, not Kimi CLI models, and always ran Kimi's default. After the first refresh or discovery they are marked *Not offered by the last refresh* and switched off (never deleted). Routing tiers, tier fallbacks and the Kimi provider default that EYAS itself had set to them are moved automatically, at start, to **Kimi Code CLI** (the default row) — which is what they always ran. A conversation or agent you pinned to one of them stops with the *does not offer it* error; pick one of the discovered Kimi models instead. On a new Kimi-only install every routing tier starts on **Kimi Code CLI**, with no fallback; the agent wizard's Opus/Sonnet/Haiku tiers for Kimi map to it too, and budget downgrades have no Kimi Code CLI step.
- **Cost estimates.** Discovered Kimi Code CLI models are priced at the *Kimi Code CLI* default rate ($0.95 in / $4 out per million tokens).

This is built from the kimi-cli 1.52.0 source code and has not been verified against a real Kimi install yet.

### Kernel file sandbox {#kernel-file-sandbox}

When Claude Code or Grok CLI runs its **own** tools — Claude Code's shell commands; Grok's shell, grep, file listing and subagent reads — the operating system itself blocks those tools from reading or writing:

- other AI tools' memory (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, OpenCode's data), the Obsidian vaults EYAS knows about and the paths in `security.foreignMemoryPaths`;
- EYAS's own private data: the vault, the database, keys and other CLIs' EYAS homes;
- other conversations' workspaces.

The conversation's own folders stay writable. The sandbox is **macOS Seatbelt** (built in) or **Linux bubblewrap**. EYAS keeps checking every tool call it sees; the sandbox also catches what a shell command reaches in ways EYAS cannot read from the command text.

| CLI | What runs in the sandbox |
|-----|--------------------------|
| **Claude Code** | Every turn with tools runs its shell commands in the sandbox. On Linux it needs bubblewrap (`bwrap`) **and** `socat`. Claude Code's own shell state (`~/.claude/shell-snapshots`, `~/.claude/session-env`) and its program folder stay readable; the rest of `~/.claude` is blocked. |
| **Grok CLI** | Every turn with tools starts Grok under an EYAS sandbox profile, written to `sandbox.toml` in its EYAS-owned home (named `eyas-<hash>`). Grok cannot relax it. On Linux it needs bubblewrap. |
| **Kimi Code CLI** | Has no kernel sandbox (*Not supported*). |

Background calls without tools (titles, memory passes, the security judge) need no sandbox and are never refused for lacking one.

**`security.cliSandbox`** (`config/local.yaml`):

- **`auto`** (default) uses the sandbox where it is available. Where it is not, the CLI still runs its tools, and the chat shows a one-time notice per conversation: *&lt;CLI&gt; runs its own tools without a kernel file sandbox on this server. EYAS still checks every tool call it sees; the provider settings show why.* In `auto`, Claude Code may ask to run one command outside the sandbox (for example one that needs `~/.npm`). Such a command **always waits for a person's approval** in the [Approvals](/docs/en/agents/autonomy/) queue — never the AI judge, never the autonomy ladder — explained there as *A shell command asked to run outside the kernel file sandbox…*. Approving lets exactly that command run once; autonomous runs park on it.
- **`required`** refuses a CLI turn with tools before the CLI starts when no sandbox is available: *&lt;CLI&gt; was not started: your settings require a kernel file sandbox for the CLI's own tools (security.cliSandbox: required), and none is available for it on this server.* The turn is not retried and not handed to another model, and Kimi turns with tools are always refused. With `required`, Claude Code can never run a command outside the sandbox (its request is ignored), and it refuses to start if the sandbox cannot start.
- There is no `off`. Any other value is a configuration error: EYAS does not start, and the error names `security.cliSandbox`.

**Where you see it.** A CLI provider's panel has a **Kernel file sandbox** row: *Active*, *Unavailable on this server* with the reason (bubblewrap not installed; socat not installed; bubblewrap cannot create a sandbox here, usually because user namespaces are disabled; unsupported operating system), or *Not supported* (Kimi). It also shows the `required` note and, for Claude Code in `auto`, *A command that asks to run outside the sandbox always waits for your approval.* `eyas doctor` has a **CLI sandbox** line (see [CLI](/docs/en/deploy/cli/#what-doctor-checks)), and **Security events** shows the status of every switched-on CLI (see [Security & privacy](/docs/en/admin/security-privacy/#memory-outside-eyas-card)). `GET /api/v1/model/providers` and `GET /api/v1/model/providers/:id` carry `fileSandbox {status: active|unavailable|unsupported, reason, mode}` for `claude-code`, `grok-cli` and `kimi-cli`.

**Docker and Kubernetes.** The EYAS image does **not** include bubblewrap (it is LGPL, so installing it is the operator's choice). A Linux host or container needs bubblewrap (and `socat` for Claude Code) plus unprivileged user namespaces for the kernel layer. Without them EYAS still refuses every request it sees and shows *Unavailable*; with `required`, CLI turns with tools are refused. See [Docker](/docs/en/deploy/docker/) and [Kubernetes](/docs/en/deploy/kubernetes/).

**Limits.** On Linux, Grok's deny list covers files that exist when the session starts. A vault known only by its `.obsidian` folder is added once EYAS has met a path inside it (a registered vault or a `security.foreignMemoryPaths` entry always counts). Kimi has no kernel layer.

### Proven CLI versions {#proven-cli-versions}

Every CLI version EYAS supports is checked before release: EYAS runs the real Claude Code and Grok CLI (and Kimi Code CLI where it is installed) through its own providers in a throwaway home full of traps (host settings that allow everything, hooks and MCP servers that would leave a mark, `CLAUDE.md`, `AGENTS.md`, skills, an Obsidian-style vault) and proves that none of it is loaded, that EYAS's memory policy and the kernel sandbox keep the vault and EYAS's data folder out, and that a refused read of memory outside EYAS stays refused. The details are on [Security & privacy — How isolation is proven](/docs/en/admin/security-privacy/#how-isolation-is-proven).

| CLI | Last proven version |
|-----|---------------------|
| Claude Code | 2.1.281 |
| Grok CLI | 1.0.41 |
| Kimi Code CLI | Not proven yet |

**Check your install with `eyas doctor`.** It has one **CLI isolation** line per CLI — *CLI isolation (Claude Code)*, *CLI isolation (Grok CLI)*, *CLI isolation (Kimi Code CLI)*. Each shows the binary EYAS runs: how it was found (`EYAS_CLAUDE_CODE_BIN` / `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`, *claude/grok/kimi on PATH*, or *SDK-bundled*), its path and its version, and then:

- *isolation proven on this version (&lt;date&gt;)* — ok;
- a warning when the version differs from the last proven one, when the binary reports no version, or when the CLI was never proven (Kimi today). The warning adds that EYAS still checks every session at start: the checks on this page run whatever version is installed;
- *not installed* — ok. An invalid `EYAS_*_BIN` is a failure, with the remedy.

For Grok and Kimi the line also checks their EYAS home, `<data dir>/cli-homes/<provider>`:

- not created yet — ok, the first run creates it;
- a symbolic link or not a folder — a failure: EYAS refuses to run the CLI; remove it, and the next run recreates it;
- readable by other users — a warning, because it holds the CLI's sign-in; remedy: `chmod 700 <folder>`;
- a file EYAS manages there (Grok's `config.toml`, `requirements.toml`, `trusted_folders.toml`; Kimi's `mcp.json` and EYAS's keys in `config.toml`) changed since EYAS wrote it — a warning. EYAS rewrites those files before the next run, so a change between runs means something else edits that folder.

Doctor is read-only: it only runs `--version`. See [CLI — What doctor checks](/docs/en/deploy/cli/#what-doctor-checks).

### Same chat on every provider {#same-chat-on-every-provider}

A conversation looks the same whichever provider answers it.

- **Live text.** Claude Code types its answer and its thinking out live, as the model writes them, like the API providers.
- **One row per tool call, with the common name.** Tool rows use the names EYAS uses on every provider — `read_file`, `run_command`, `edit_file`, `write_file`, `grep`, `glob`, `web_fetch`, `web_search` — so file edits and writes show as a diff everywhere. EYAS's own tools appear under their plain names (`memory_search`, not `mcp__eyas__memory_search`). On Grok and Kimi the row does not show the CLI's free-text title.
- **Input, output and duration.** A row shows what the tool was asked (the file, the command, the search, an edit's path with the old and new text), what it returned — very long output is cut at 64 KiB and marked as cut — and how long it took.
- **A row settles only when the tool has finished.** It is never marked done in advance: a call that fails, or that is skipped by the tool-call budget, shows as failed, with the error.
- **Refused calls are not shown as succeeded.** A call EYAS refused — by the security gate, by the memory policy, while it waits for an approval, or as a repeat of an action a resumed run already carried out — shows its own status (*Denied*, *Needs approval*, *Skipped*) with EYAS's reason, never a green check. Calls a CLI asks about after the tool-call limit is reached are recorded as skipped. A call that needs approval raises an approval card in the conversation and an entry in the [Approvals](/docs/en/agents/autonomy/) queue. See [Conversations — Tool trace](/docs/en/daily/conversations/#tool-trace).
- **Turn limit keeps the answer.** When a turn reaches its turn limit, the answer written so far is kept and saved as the reply; the turn ends as *Turn limit reached*, not as an error. A real failure still shows as an error, and the partial answer is kept then too.
- **One ending per turn.** A reply is saved and shown exactly once on every provider.
- **The same run tree.** The run tree / workflow panel of a conversation appears for every provider, API and CLI, with the live current tool, the turn count (for a CLI, its own internal steps), tokens and the run's cost. See [Conversations — Run tree](/docs/en/daily/conversations/#run-tree--workflow).
- **Compaction writes no memory.** If a CLI compacts its own context during a long turn, the turn shows a *context compacted* notice and nothing is written into EYAS memory. EYAS memory is fed only by EYAS.
- **Error messages name the right CLI.** A Kimi failure says *Kimi Code CLI*, never *Grok CLI*.

**Why a turn ended.** Every API provider records the same reasons: finished, tool use, output limit reached, stop sequence, or declined. *Declined* covers Anthropic's refusal, OpenAI's content filter and the model's refusal message, Gemini's safety-class stops (safety, prohibited content, blocklist, recitation, personal data, image safety) and a prompt Gemini blocked outright. An OpenAI refusal message is shown as the assistant's answer instead of an empty reply. An answer cut off by the output-token limit is recorded as *max tokens*, and a tool call cut off that way is never run. The chat shows these outcomes as a badge under the reply — see [Conversations — Turn outcome](/docs/en/daily/conversations/#turn-outcome).

**Token counts** mean the same on every provider, CLIs included: input tokens are the prompt tokens that were **not** served from the provider's cache; cached reads (and, on Anthropic, cache writes) are counted separately; reasoning or thinking tokens are part of output tokens. A turn for which the provider reported no usage is marked *Usage not reported* and shows no price; its trace is never priced from placeholder token counts. Observability counts the tools a CLI ran in its own loop too — Claude Code, Grok CLI and Kimi Code CLI turns no longer show 0 tool calls. See [Observability — Usage](/docs/en/admin/observability/#usage-tab).

### Tool calling {#tool-calling}

On API and local providers EYAS runs the tool loop itself: the model asks for a tool, EYAS runs it, sends the result back, and the model continues its answer. Each call shows as one live row in the conversation.

| Provider | What to expect |
|----------|----------------|
| Anthropic, Anthropic-compatible endpoints (MiniMax, Synthetic, Xiaomi MiMo, …) | EYAS tools run, including the memory tools. With reasoning on — any effort level, or a model where it is always on — the model's signed reasoning (redacted reasoning included) goes back unchanged in the next request of the same answer, so tool-using turns with reasoning work reliably. Anthropic-compatible providers also report cached input tokens for streamed answers. |
| OpenAI | EYAS tools run, including the memory tools |
| **Gemini** | EYAS tools run, including memory search. Gemini's reasoning signature is sent back with each tool call, so newer Gemini models keep their reasoning across a tool loop. A tool that reports an error is sent to Gemini as an error. Gemini's thought summaries show as reasoning in the conversation, never in the answer text or the stored reply. |
| OpenAI-compatible endpoints, Kimi API, OpenRouter | EYAS tools run. A backend that reports a normal *stop* while also asking for tools does not end the loop early — the requested tools run. Reasoning text these backends return (for example DeepSeek reasoner's) is shown as thinking, never mixed into the answer. Kimi API and OpenRouter get their own reasoning back on the tool-call turns of the same answer, as they require. |
| **LM Studio** | Uses the same OpenAI-compatible connection as the providers above, so tool calls and their results (memory search included) reach the model through standard function calling. |
| Ollama | EYAS tools run. Each tool result carries the tool's name, so the model can tell which result belongs to which call when it made several. A thinking model's reasoning streams as thinking, separate from the answer. |
| Claude Code CLI, Grok CLI, Kimi Code CLI | The CLI runs the loop; EYAS tools reach it through MCP — see [MCP](/docs/en/ai/mcp/#cli-mcp-tool-parity-grok--kimi) |

**Reasoning stays with its provider.** The reasoning replayed inside a tool loop (Anthropic-family, Kimi API, OpenRouter) applies only within one answer: it is not stored with the conversation and not sent in later turns. If a turn fails over to another provider, the reasoning is dropped for that provider and the answer continues without it. When a stopped or failed background run is resumed from its last checkpoint, the model starts its reasoning over once. Reasoning is never sent to another provider or model, not even as text; the native OpenAI connection never sends reasoning back at all.

**One row per tool call.** Some OpenAI-compatible backends — often local servers — stream a tool call without a call id. Such a call shows as exactly one tool row. This applies to OpenAI, OpenAI-compatible providers, Kimi API, OpenRouter and LM Studio.

**Models without tools.** A model marked as not supporting tools in the model list — for example an Ollama model whose server reports no tool capability, or a model where you turned tool support off — gets no tools and no tool list in its prompt. If it asks for a tool anyway, EYAS does not run it and the turn ends on the model's text. Its prompt also stops telling it to call tools: the memory and grounding rules say that what EYAS recalled arrives in the `<eyas-memory>` block and that it cannot search further, and it gets no skill list or agent roster, which only work through tool calls. See [Prompts — The memory contract](/docs/en/ai/prompts/#the-memory-contract-in-the-master-prompt).

### Images and models that cannot see them {#images-and-models-that-cannot-see-them}

Which models can see images comes from the model catalog: the **Vision** badge in the model list. For Grok CLI and Kimi Code CLI the badge follows what the installed CLI reports.

- When the conversation's model cannot see images, each attached image reaches the model as a short note in its place (*[image omitted (image/png): this model cannot see images]*). The model knows an image was there, but not what it shows. The turn is not refused.
- A notice appears under that turn: *Images not shown to the model (N): &lt;model&gt; cannot see images…* It is stored with the reply, so it is still there after a reload. The count includes images from earlier turns, so on such a model the notice appears on every turn while the conversation contains images.
- The composer warns before sending: with an image attached and a model that cannot see images, a chip above the input says *&lt;model&gt; cannot see images: it will only learn that an image was attached.* The chip does not appear in God Mode; for an Auto-routing conversation it is based on the model shown for the conversation (the Standard tier).
- If EYAS has no catalog information for a model, images are sent as they are and the provider decides. Switch to a model with the **Vision** badge to have images read.
- **Claude Code** sees the images from earlier turns of a conversation, not only those in the latest message: every turn re-sends all earlier images, the same way the API providers do, so image-heavy conversations send larger prompts.

### Prompt caching (Anthropic API) {#prompt-caching-anthropic-api}

On the Anthropic API provider (direct API key), prompt caching is automatic — there is no setting.

- **System prompt.** EYAS's system prompt does not change from turn to turn, because the current time and the recalled memory ride on your current message. EYAS therefore marks the system prompt (together with the tool definitions before it) for caching, and every later turn and tool step reads it back from Anthropic's cache.
- **Earlier conversation.** The conversation up to your current message is marked too, so the next turn reads it back instead of paying full price again.
- **Tool steps.** In a tool-using turn, each tool step reads the previous request back.
- **Lifetime and cost.** The cache lasts 5 minutes and is refreshed by every request that uses it; after a longer pause the first request writes it again. A cache write costs 1.25× the normal input price; a read costs about 0.1× (or the model's own published cache-read rate, lower on some newer models). Prompts shorter than the model's minimum cacheable length (512 to 4096 tokens, depending on the model) are simply not cached.
- **Where to see it.** Token usage and costs show cache read and cache write tokens for Anthropic API calls.
- Anthropic-compatible third-party endpoints are sent no caching parameter, because such an endpoint may reject it. Claude Code manages its own caching.

### Local runtimes {#local-runtimes}

**LM Studio**

- Temperature, maximum output tokens and stop sequences from the conversation or agent are sent as set. When none is set, the model's own default in LM Studio applies.
- A request that names no model asks for the model LM Studio currently has loaded. The model shown on a reply is the id LM Studio reports.
- Calls use the standard client timeout (10 minutes), and a dropped connection is retried.
- `LM_STUDIO_URL` (default `http://localhost:1234`) may end with a slash.
- Reasoning stays LM Studio's own setting: EYAS never sends a reasoning or effort parameter, and the panel shows the setting LM Studio reports per model (see [How each provider applies the effort level](#effort-by-provider)).

**Ollama**

- **Refresh models** reads each model's capabilities from the Ollama server — on load, in the background and on refresh — so models without tool support are marked that way and thinking models get their thinking control (see [How each provider applies the effort level](#effort-by-provider)). An older Ollama that reports no capabilities keeps tools on.
- Ollama's default context is 4096 tokens. When a request plus its reply needs more, EYAS sets `num_ctx` to the next power of two (8192, 16384, …), capped at the model's context window from the model list. Small requests leave Ollama's default untouched. `OLLAMA_CONTEXT_LENGTH` still applies whenever EYAS does not set `num_ctx`. A larger `num_ctx` raises Ollama's memory use only for the requests that need it.

**Stop cancels local generation.** On LM Studio and Ollama, **Stop** ends the running generation at once, so the GPU is free as soon as you stop.

### Context window {#context-window}

EYAS builds each turn's prompt for the model that answers it. The window comes from the model list (the context-size badge on each model), for CLI models too: a Claude Code model listed with a 1M window uses 1M. Claude Code lists 1M only for the runtime's own 1M variants (for example *Opus (1M context)*); its Fable, Opus, Sonnet and Haiku entries list 200k, also before the runtime has reported its models, so the context-size badge, the context bar and prompt sizing agree from the first start. The CLIs' known windows — Claude Code 200k, Grok 500k, Kimi 256k — are only the fallback for a model the list has no window for, and a model nothing is known about uses 200k. Larger windows give the adjustable prompt sections more room; small local models get a prompt that leaves room for the conversation. See [Prompts — sized for the model](/docs/en/ai/prompts/#prompt-size).

The conversation's context bar uses the same window and, where the provider reports it, the real prompt size of the last model call (Anthropic and Anthropic-compatible, the OpenAI family including OpenRouter, Kimi API and LM Studio, Gemini, Claude Code). When the runtime reports the window of the model that answered (Claude Code does), that wins over the model list. Ollama, Grok CLI and Kimi Code CLI do not report a usable per-call prompt size, so their bar is an estimate. See [Conversations — Context composition](/docs/en/daily/conversations/#context-composition).

### Privacy: what each provider receives {#privacy-what-each-provider-receives}

The privacy policy masks personal data on its way to a model, per attempt and per destination. Whether a provider counts as **local** (text sent unmasked) depends on the endpoint host it sends to, never on the provider's name:

- Local: a loopback endpoint (`localhost`, `127.x.x.x`, `::1`) or a host listed as a local host in the privacy policy. A local Ollama or LM Studio is local.
- Remote (masked): everything else — a remote `OLLAMA_HOST`, LAN hosts that are not listed, cloud APIs, and every CLI provider (Claude Code, Grok CLI, Kimi Code CLI), because EYAS cannot see where a CLI sends its traffic.

If a call falls over to another provider, each attempt is masked for its own destination. If you relied on a remote Ollama host being exempt, add that host to the policy's local hosts. Memory tool results that a CLI fetches over the EYAS tool bridge are masked the same way. A **new** message you send that carries a block-class value (for example an IBAN) is refused before it is stored when it would go to a remote model — CLI providers included — with an offer to send it masked. The built-in OpenAI provider also opts every request out of OpenAI's stored completions. See [Security & privacy](/docs/en/admin/security-privacy/#privacy-policy).

## Fields and controls

### Provider panel {#panel}

| Section | Meaning |
|---------|---------|
| **● Active** | Badge next to the panel title: the provider is switched on and running; otherwise it reads **Inactive** |
| **Authentication** | API key, the Claude Code login on this machine, or the **Sign in for EYAS** card (Grok CLI, Kimi Code CLI) |
| CLI auth (Claude Code) | *No API key needed. Claude Code shares only its sign-in with this server: sign in with the `claude` CLI as the user EYAS runs as.* Claude Code is available only once that CLI is signed in. |
| Claude Code isolation line | *EYAS runs Claude Code isolated: no host CLAUDE.md, settings, hooks, skills, MCP servers or auto-memory are loaded, and no transcript is kept under ~/.claude/projects. Only the sign-in is shared with the host.* It points to **Settings → System → Data portability → Import data** for host `CLAUDE.md` content. |
| **Sign in for EYAS** | Grok CLI / Kimi Code CLI only — **Sign in with a device code**, **Use an API key instead** (Grok), **Cancel**, **Sign out** — see [Sign in Grok and Kimi for EYAS](#sign-in-grok-and-kimi-for-eyas) |
| **Kernel file sandbox** | Claude Code / Grok CLI / Kimi Code CLI — *Active*, *Unavailable on this server* (with the reason) or *Not supported*, plus the `required` note and, for Claude Code in `auto`, *A command that asks to run outside the sandbox always waits for your approval.* — see [Kernel file sandbox](#kernel-file-sandbox) |
| Kimi model note | Kimi Code CLI, until EYAS has read Kimi's model list: *EYAS has not read Kimi's model list yet, so it cannot pin a model or switch thinking on or off…* |
| API key fields | Stored encrypted in Secrets; **Key saved / No key / Remove Key** |
| Model list | Enable/disable individual models; **Tools** / **Vision** / context size badges; **Runs &lt;model&gt;** when the concrete model differs from the row id; **Not offered by the last refresh** on rows the last refresh did not return; a **Reasoning** line with the model's effort levels and default, and where the facts come from (*reported by the provider* / *EYAS catalog, verified …*); on LM Studio, the reasoning setting LM Studio reports |
| **Refresh models** | Reloads the provider's model list (every provider). On failure: *Refresh failed. The model list was left unchanged.* |

The Claude Code CLI, Grok CLI and Kimi Code CLI panels also show the **Runtime** line and the **Isolation** block, with **Verify now** for Grok and Kimi — see *Runtime and Isolation on the provider panel* under [Isolation check before every turn](#isolation-check-before-every-turn). Their card subtitles read *Claude Code CLI, run isolated by EYAS*, *Grok CLI in EYAS's own home (ACP)* and *Kimi Code CLI in EYAS's own home (ACP)*.

## Related tabs

- [Routing & budget](/docs/en/ai/routing-budget/) (Routing Tiers + Budget tabs). The **Routing Tiers** tab opens with the **Background model calls** card, which shows where EYAS's background work goes right now — see [Routing & budget — Background model calls](/docs/en/ai/routing-budget/#background-model-calls-card).
- **AI Analysis** — embedded independent benchmarks iframe

## Related

- [Setup wizard — AI Provider](/docs/en/setup-wizard/)
- [Secrets](/docs/en/admin/secrets/)
- [MCP](/docs/en/ai/mcp/)
- [Memory](/docs/en/knowledge/memory/)
- [Security & privacy](/docs/en/admin/security-privacy/)
- [Data import](/docs/en/admin/data-port/)
- [CLI — doctor](/docs/en/deploy/cli/)
