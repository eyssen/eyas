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

**Shallow** expands fewer related queries and keeps fewer hits; **Deep** expands more queries, fetches more results per query, and keeps more of the sources that score at least 0.5 relevance.

Search uses Brave when the `brave-search-api-key` secret exists; otherwise a mock provider (fine for UI checks, not live web). Store the key under [Secrets](/docs/en/admin/secrets/).

A completed report shows the query as title, **Complete**, depth (*shallow* / *deep*), source count, and completion time. Body is model-written **sections** (title + prose). **Sources** lists `[n]` title (link) and **N% relevant**.

Failed jobs show **Research Failed** and the error string. There is no delete or export control on this page.

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
| **Error** | Workflow failed |

<h2 id="report">Report pane</h2>

| Control | Meaning |
|---------|---------|
| **Researching…** | In-progress placeholder with the current status badge |
| **Research Failed** | Error title; body is the error text |
| Depth / source count / completed at | Header meta on a finished report |
| Section title + content | Generated briefing blocks |
| **Sources** | Numbered links with **N% relevant** |

## Related

- [Memory](/docs/en/knowledge/memory/)
- [Documents](/docs/en/knowledge/documents/)
- [Search](/docs/en/daily/search/)
- [Secrets](/docs/en/admin/secrets/)
- [Settings overview](/docs/en/admin/settings/)
