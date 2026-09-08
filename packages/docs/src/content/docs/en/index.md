---
title: Welcome
description: EYAS user handbook — self-hosted personal AI OS, on your machine, under your rules.
---

**EYAS** is a self-hosted personal AI operating system. Named agents, durable memory, a work board, and channels run on **your** machine — not in someone else's cloud as the product.

This book is for the **operator** who installs and keeps the instance healthy, and for the **everyday user** who talks to agents, tracks work, and reads what the system remembers. Deep architecture and contributor specs stay in the repository `docs/` tree (see [Architecture pointer](/docs/en/reference/architecture/)).

## How to read this book

The sidebar follows the product, not a textbook split into tutorials / how-to / reference. You still have four jobs; they just live in order:

| You need to… | Go here |
|--------------|---------|
| **Learn by doing** | Start: [Getting started](/docs/en/getting-started/), [Setup wizard](/docs/en/setup-wizard/), [Your first hour](/docs/en/first-hour/) |
| **Understand why** | [Core concepts](/docs/en/concepts/) and the *What this is for* lead on every chapter |
| **Get a job done** | Daily work, Agents, Skills & automation, Knowledge, Communication, AI, Administration |
| **Look up a fact** | Deploy & CLI, [Glossary](/docs/en/reference/glossary/), [FAQ](/docs/en/reference/faq/), field tables at the bottom of how-to pages |

**Recommended path:** [Getting started](/docs/en/getting-started/) → [Setup wizard](/docs/en/setup-wizard/) → **[Your first hour](/docs/en/first-hour/)** → [Core concepts](/docs/en/concepts/) → then the area you actually need.

In the product, **?** icons open the matching chapter at **`/docs/`** on the same host, in the language you are using.

## Docs map

| Section | Start here |
|---------|------------|
| **Start** | [Getting started](/docs/en/getting-started/) · [Setup wizard](/docs/en/setup-wizard/) · [Your first hour](/docs/en/first-hour/) · [Core concepts](/docs/en/concepts/) |
| **Daily work** | [Home](/docs/en/daily/home/) · [Conversations](/docs/en/daily/conversations/) · [Board](/docs/en/daily/board/) · [Projects](/docs/en/daily/projects/) · [Search](/docs/en/daily/search/) |
| **Agents** | [Overview](/docs/en/agents/overview/) · [Voice](/docs/en/agents/voice/) · [Teams](/docs/en/agents/teams/) · [Runs](/docs/en/agents/runs/) |
| **Skills & automation** | [Skills](/docs/en/automation/skills/) · [Scheduler](/docs/en/automation/scheduler/) · [Pipelines](/docs/en/automation/pipelines/) |
| **Knowledge & memory** | [Memory](/docs/en/knowledge/memory/) · [Knowledge base](/docs/en/knowledge/knowledge-base/) · [Design](/docs/en/knowledge/design/) · [Documents](/docs/en/knowledge/documents/) |
| **Communication** | [Channels](/docs/en/communication/channels/) · [Telegram](/docs/en/communication/telegram/) |
| **AI models & prompts** | [Providers](/docs/en/ai/providers/) · [Routing & budget](/docs/en/ai/routing-budget/) · [Prompts](/docs/en/ai/prompts/) · [MCP](/docs/en/ai/mcp/) |
| **Administration** | [Users](/docs/en/admin/users/) · [Notifications](/docs/en/admin/notifications/) · [Extensions](/docs/en/admin/extensions/) · [Nodes](/docs/en/admin/nodes/) · [Hands](/docs/en/admin/hands/) · [Backup](/docs/en/admin/backup/) · [Security](/docs/en/admin/security-privacy/) |
| **Deploy & CLI** | [Docker](/docs/en/deploy/docker/) · [CLI](/docs/en/deploy/cli/) · [Configuration](/docs/en/deploy/configuration/) |
| **Reference** | [Glossary](/docs/en/reference/glossary/) · [FAQ](/docs/en/reference/faq/) |

Each chapter opens with **what it is for** and **when to use it**, then the workflow, then fields when they help.

## Languages

English, Hungarian, German, Spanish, French, Klingon (tlhIngan Hol) — switch in the header. Missing prose falls back to English.

## In the product

The same site is served by the main EYAS process at **`/docs/`** (no separate docs server).

## Sponsors

EYAS is developed with the same AI models it orchestrates, and that inference is
the project's largest running cost. **[Sponsorship](https://github.com/sponsors/eyssen)**
covers it; the current goal is **$1,000/month** toward the model bill.

Everything EYAS ships stays MIT-licensed and self-hostable, sponsored or not, and
no tier is a support contract. Tiers and the full list:
[SPONSORS.md](https://github.com/eyssen/eyas/blob/main/SPONSORS.md).
