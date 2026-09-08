---
title: Meetings
description: Ingest meeting recordings (Fireflies and the like) into transcripts, summaries, and action items.
---

**What this is for.** Meetings is the ingest surface for recordings: list meetings, pull transcripts and summaries from a provider, and keep action items next to the rest of your work. The product UI is still marked **Coming Soon**; the backend provider (Fireflies) is already wired and fails closed with no API key.

## When to use it

- You want Fireflies (or a future provider) meetings listed in EYAS instead of only in that vendor's app.
- You need a transcript, summary, or action-item list next to Board follow-ups — once ingest is complete.
- You are checking why the list is empty: no `fireflies-api-key` secret, or the UI is still the planned banner.

## Typical workflow

1. Open **Settings → Meetings** (sidebar **Settings**, **Infrastructure** group) — route `/meetings`.
2. Read the **Coming Soon** / **Planned** banner: *Meeting integration is under development. Connect your meeting provider in a future update.*
3. If a Fireflies key is stored as secret `fireflies-api-key` (system scope), the API can list meetings; the page then shows a table. Without a key the provider stays unconfigured and returns an empty list — it never fabricates transcripts.
4. You should see either the empty state (*No meetings recorded yet*) or rows with title, date, duration, participants, and status.

## Features

Subtitle in the app: *Meeting recordings, transcripts, and action items.*

| Control / column | Meaning |
|------------------|---------|
| **Coming Soon** + **Planned** | UI still in development |
| **Title** | Meeting title |
| **Date** | When |
| **Duration** | Minutes |
| **Participants** | Count |
| Status | Provider status badge |

The Fireflies adapter talks to a fixed GraphQL host and still goes through SSRF-safe fetch. Unconfigured: list is empty; detail calls error with "not configured". No mock data.

## Related

- [Board](/docs/en/daily/board/)
- [Secrets](/docs/en/admin/secrets/)
- [Memory](/docs/en/knowledge/memory/)
