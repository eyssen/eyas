---
title: Multiple instances
description: Separate EYAS_HOME and ports — never two writers on one SQLite file.
---

**What this is for.** One machine can run more than one EYAS (dev + personal, or two Compose projects). Isolation is **data directory + port**, not “two processes, one DB”. SQLite is not a multi-writer cluster.

## When to use it

- You want a second instance on the same laptop without mixing vaults.
- Docker: a second Compose project name and host port.
- You are debugging leadership on the scheduler health strip (**Leader / Follower**).

## Typical workflow

1. Pick a new `EYAS_HOME` (data, pid, local.yaml) and a free `EYAS_PORT` (e.g. 3200).
2. Native: `EYAS_HOME=/path/to/home EYAS_PORT=3200 eyas start`.
3. Docker: `EYAS_PORT=3200 docker compose -p eyas-dev up -d`.
4. Confirm each UI on its own port. **Never** point two live instances at the same SQLite file.
5. Scheduler health shows **Leader / Follower** when instances form a cluster for jobs — that still does not mean shared SQLite.

## Features

| Lever | Purpose |
|-------|---------|
| `EYAS_HOME` | Separate data, pid, local config |
| `EYAS_DATA_DIR` | Optional: put an instance's data directory somewhere else. The database **and the memory vault** (`<data dir>/vault`) move with it |
| `EYAS_WORKSPACES_DIR` | Optional: where that instance's conversation workspaces live |
| `EYAS_PORT` / `--port` | Non-colliding listen port |
| Compose project name | Multiple stacks on one Docker host |

**Never** point two live instances at the same SQLite file.

**Vaults and workspaces stay apart.** Each instance's vault is `<data dir>/vault`, so separate data directories mean separate vaults. On a source install run from a git clone, conversation workspaces live in a per-instance folder named after the EYAS home folder plus a short hash of the data directory, so a dev and a live instance on one machine never share workspaces. If you set `EYAS_WORKSPACES_DIR`, give each instance its own path. See [Configuration — Conversation workspaces](/docs/en/deploy/configuration/#conversation-workspaces).

## Related

- [Native](/docs/en/deploy/native/)
- [Docker](/docs/en/deploy/docker/)
- [Scheduler](/docs/en/automation/scheduler/)
- [CLI](/docs/en/deploy/cli/)
- [Configuration](/docs/en/deploy/configuration/)
