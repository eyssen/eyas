# Conversation working directories

**Date:** 2026-08-14  
**Status:** approved for implementation  
**Approach:** A — ordered path list; first is primary cwd

## Problem

Conversations can pin indexed **search sources** (read/cite). They cannot say
**where work happens**. File tools then jail to `process.cwd()` (the EYAS
checkout). Search sources stay read-only and must not become write roots.

## Model

Two JSON `string[]` columns (absolute paths, order matters):

| Table | Column | Rule |
|---|---|---|
| `projects` | `working_directories` | Required on user save (≥1). Seed rows may start empty. |
| `conversations` | `working_directories` | Copy of the project list; editable. |

Inheritance (same pattern as `searchContext`):

1. New conversation copies `project.workingDirectories`.
2. Project change **always** replaces the conversation list with the new
   project's (unless the same PATCH sends an explicit list).
3. Manual conversation edits persist until the project changes.
4. Child conversations inherit the parent's list.

First path = primary cwd (relative paths, Claude Code `cwd`, worktree base,
verify). Every path is a writable jail root. Indexed search sources are **not**
jail roots.

## Fail-closed

No `process.cwd()` fallback. Empty list → file/shell tools return an error.
`run_command.workingDir` must sit under one of the listed roots.

## Validation

Absolute path, existing directory, `realpath`, existing sensitive-path deny
list. Empty array allowed on conversations; rejected on project save.

## UI

- Projects form: required ordered list (primary badge, up/down).
- Conversation chatter tab **Folders** + fields-bar chip (basename, `+N`).

## Out of scope

File-glob allowlists. Making search sources writable.
