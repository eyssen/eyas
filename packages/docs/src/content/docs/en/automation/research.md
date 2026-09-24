---
title: Research
description: Start a shallow or deep research job, watch status, and read the report plus sources.
---

**What this is for.** Research runs a web-search job from a question or topic, evaluates sources, and writes a structured report you can open later. Agents can reuse the result. You use this when you want a sourced briefing instead of a single chat turn. Shallow is faster; deep expands more queries and keeps more sources.

## When to use it

- You want a report on a topic with cited URLs, not just a model answer.
- You need a quick pass (**Shallow (faster)**) or a broader one (**Deep (thorough)**).
- You want to watch a job move through **Pending** → **Searching** → **Evaluating** → **Synthesizing** → **Complete**.
- A job failed and you need the error text on the right.

## Typical workflow

1. Open **Research** in the sidebar (`/research`).
2. Under **New Research**, type a topic (placeholder *Enter research topic…*).
3. Choose **Shallow (faster)** or **Deep (thorough)**.
4. Click **Research**. The job appears in the left list and is selected.
5. Wait while the right pane shows **Researching…** and the current status. Active jobs refresh about every two seconds.
6. When **Complete**, read the sections and **Sources**. Click a source title to open the URL.

Empty list: *No research reports yet*. With nothing selected: *Select a report or start a new research*.

## Features

Jobs start **Pending**, then **Searching** (query expansion + web search), **Evaluating** (relevance), **Synthesizing** (sections + cross-reference), then **Complete** or **Error**.

**Which model does the work.** Query expansion, source scoring, section writing and the cross-check run on EYAS's background model: the **Standard** routing tier first, then the default model, then API providers, then CLIs that can run isolated calls — never whichever provider the gateway happens to pick. Every call is an isolated one-shot (no tools, no provider or host memory, one turn), shows up in tracing and counts against the budget. See [Routing & budget — The background model](/docs/en/ai/routing-budget/#background-model).

**Web content is data, not instructions.** Search titles, snippets, URLs, page extracts, and the sections the model wrote from them are passed to the model inside a delimited block with its own random marker for each call. The model is told that content inside it is data, never instructions, so a hostile page cannot close the block or give orders.

**Reports without a model.** A report still completes when no background model can write it: no provider can run isolated background calls (for example a Grok-only or Kimi-only install before their isolation is verified), the budget is stopped, or the model call failed or returned an unusable answer. Then only the original topic is searched; sources are ranked by search order (the top ones are kept); the body has one section per top source with its title, snippet and URL; there is no cross-check; and pages are not downloaded when no model is available. Such a report shows a banner above the sections: *Assembled without a model: no background model could synthesize this report (none can run isolated background calls, the budget is stopped, or the call failed), so the top sources are listed with their snippets.* The agent `research` tool returns `degraded: true` for such reports. Before, a model failure ended the job as **Error**. Existing reports are unchanged.

**Shallow** expands fewer related queries and keeps fewer hits; **Deep** expands more queries, fetches more results per query, and keeps more of the sources that score at least 0.5 relevance.

Search uses Brave when the `brave-search-api-key` secret exists; otherwise a mock provider (fine for UI checks, not live web). Store the key under [Secrets](/docs/en/admin/secrets/).

A completed report shows the query as title, **Complete**, depth (*shallow* / *deep*), source count, and completion time. Body is model-written **sections** (title + prose). **Sources** lists `[n]` title (link) and **N% relevant**.

Failed jobs — for failures other than the model, for example the search itself — show **Research Failed** and the error string. There is no delete or export control on this page.

## Fields and controls

<h2 id="new-job">New research</h2>

| Control | Meaning |
|---------|---------|
| **New Research** | Form heading |
| Topic field | Placeholder *Enter research topic…* |
| Depth | **Shallow (faster)** or **Deep (thorough)** |
| **Research** | Start the job (disabled while empty or submitting) |

<h2 id="statuses">List and statuses</h2>

| Control | Meaning |
|---------|---------|
| Left list | Query, status badge, created date. Click to load the report |
| **Pending** | Queued, not searching yet |
| **Searching** | Query expansion and web search |
| **Evaluating** | Scoring and filtering sources |
| **Synthesizing** | Writing and cross-checking sections |
| **Complete** | Report ready |
| **Error** | Workflow failed (a model failure no longer ends the job this way — the report completes without a model instead) |

<h2 id="report">Report pane</h2>

| Control | Meaning |
|---------|---------|
| **Researching…** | In-progress placeholder with the current status badge |
| **Research Failed** | Error title; body is the error text |
| Depth / source count / completed at | Header meta on a finished report |
| Section title + content | Generated briefing blocks |
| *Assembled without a model: …* banner | The report was built without a background model — one section per top source, no cross-check |
| **Sources** | Numbered links with **N% relevant** |

## Related

- [Memory](/docs/en/knowledge/memory/)
- [Documents](/docs/en/knowledge/documents/)
- [Search](/docs/en/daily/search/)
- [Secrets](/docs/en/admin/secrets/)
- [Settings overview](/docs/en/admin/settings/)
