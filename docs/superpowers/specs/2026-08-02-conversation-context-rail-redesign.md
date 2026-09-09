# Conversation Context Rail Redesign

> **Date:** 2026-08-02  
> **Status:** Approved  
> **Supersedes (partially):** `2026-04-02-conversation-panel-redesign.md` §3 Chatter + right panel UX

## Problem

The right-hand Odoo-inspired chatter copied surface UI (Messages / Send message / Log note / tracking) without Odoo’s collaboration semantics. Combined with tracking every `status: idle ↔ working` agent turn, the feed became runtime noise with raw ULIDs, not a useful business history.

## Product role

**Right panel = Record Context Rail** (not a second chat).

| Layer | Location | Content |
|-------|----------|---------|
| Work | Left: Chat | User ↔ agent messages, streaming |
| Runtime | Right top (collapsible) | Run tree, agent progress, sub-conversations |
| Context | Right tabs | History (notes + business changes), Next (activities), Files |

## Decisions

| Decision | Choice |
|----------|--------|
| Composer | **Note only** on conversation panel (no Send message until outbound channel exists) |
| Tracking whitelist | `stage`, `project`, `priority`, `dueDate`; `status` only for business values (`archived`, `deleted`, `waiting_approval`) |
| Tracking blacklist | `idle`/`working` and other runtime status; tokens/cost/sdkSessionId |
| Display values | Resolve stage/project IDs to names before emit |
| Timeline order | Newest first |
| Default tab | History |
| Tabs rename | History · Next · Files (i18n keys updated; `comment` type remains in API for later multi-user) |

## Backend

1. `conversationService.update` — filter changes; resolve labels; emit `record:updated` only for surviving changes.
2. `chatterService.listMessages` — `ORDER BY created_at DESC`; enrich `authorName`; always attach `tracking` for tracking rows.
3. Defense-in-depth: chatter bus handler drops empty / fully-runtime change sets.

## Frontend

1. `ChatterPanel` — tabs History / Next / Files; note-only composer; filters All · Notes · Changes.
2. `ChatterMessageList` — newest-first groups by day; fix `tracking` field name; empty state explains left = AI.
3. `ActivityList` — schedule form (+ type, summary, deadline).
4. `ConversationPage` — runtime strip collapsible above context rail.

## Out of scope

- Followers / email outbound comments  
- Agent-suggested activities  
- Audit tab content (stays separate module)
