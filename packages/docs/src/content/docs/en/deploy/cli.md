---
title: CLI reference
description: eyas serve/start/stop/doctor/config/module — operate whichever install path you chose.
---

**What this is for.** The `eyas` binary is how you start, stop, diagnose, and toggle modules on a native or container install. It is not a second product — same process, same `EYAS_HOME`. After `bin/` is on `PATH` (native installer) or inside the image (`docker compose exec`), these commands apply.

## When to use it

- Start in the foreground (`serve`) to watch logs, or in the background (`start` + pidfile).
- Run `doctor` before filing a bug: a missing CLI, which Claude Code binary runs and whether it is signed in, whether each installed AI CLI is a version EYAS's isolation check has proven, whether its EYAS home is intact, whether the CLIs' kernel file sandbox is available, where the vault is, which memory embedder recall uses, skipped import roots, port in use, docs/web dist.
- Toggle a module without editing YAML by hand.
- Check GitHub for a newer version (`eyas update` family, same service as Settings → Updates).

## Typical workflow

1. Install via [native](/docs/en/deploy/native/) or [Docker](/docs/en/deploy/docker/).
2. `eyas doctor` — fix what it flags.
3. `eyas serve` (foreground) or `eyas start` (background). `eyas status` to confirm.
4. `eyas config validate` after editing YAML, then `eyas restart`: `default.yaml` and `local.yaml` are read once at startup.
5. `eyas stop` / `eyas restart` as needed.

## Features

| Command | Description |
|---------|-------------|
| `eyas serve` | Foreground HTTP server |
| `eyas start` | Background (pidfile + log) |
| `eyas stop` | Stop background |
| `eyas restart` | Restart |
| `eyas status` | Health + PID |
| `eyas doctor` | Diagnostics |
| `eyas version` | Version |
| `eyas config validate` | Validate YAML |
| `eyas config reload` | Does **not** reload `default.yaml` / `local.yaml` — restart instead |
| `eyas module list` | List modules |
| `eyas module enable/disable <id>` | Toggle module |
| `eyas update check` | Check GitHub (`eyssen/eyas`) for a newer version; requires Backup ready to apply |
| `eyas migrate …` | One-shot v1→v2 prompt/workspace migration (`run` / `rollback` / `drop-cols`) — not daily ops |

<h3 id="what-doctor-checks">What <code>doctor</code> checks</h3>

Every line is *ok* (✓), a *warning* (⚠) or a *failure* (✗). Doctor ends with the number of issues or warnings, and exits with status 1 when any line failed; warnings alone do not change the exit status. It is read-only: it repairs, copies and creates nothing, and it starts the installed CLIs only to read their version (`--version`) and, for Claude Code, whether it is signed in (`claude auth status`).

A selection of its lines:

| Line | Meaning |
|------|---------|
| **Claude Code runtime** | Which Claude Code binary EYAS runs: the source (`EYAS_CLAUDE_CODE_BIN` / `claude on PATH` / `SDK-bundled`), its path and version, whether its version differs from the one EYAS's SDK client was built for (*version skew*), and **signed in** yes/no. An invalid `EYAS_CLAUDE_CODE_BIN` is a failure. The SDK-bundled last resort, version skew and a signed-out runtime are warnings. A `claude` on PATH that the override shadows is shown as information (*not used by EYAS*). See [Providers — Claude Code runtime](/docs/en/ai/providers/#claude-code-runtime). |
| **CLI isolation (Claude Code)**, **CLI isolation (Grok CLI)**, **CLI isolation (Kimi Code CLI)** | One line per CLI provider. It shows the binary EYAS runs — how it was found (`EYAS_CLAUDE_CODE_BIN` / `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`, `claude on PATH` / `grok on PATH` / `kimi on PATH`, or `SDK-bundled`), its path and its version — and whether EYAS's isolation release check has proven that version: ok *isolation proven on this version (&lt;date&gt;)*. It warns when the version differs from the last proven one, when the binary reports no version, and when the CLI was never proven on a host (Kimi Code CLI for now); the warning adds that EYAS still checks every session at start. A CLI that is not installed shows *not installed* (ok). An invalid `EYAS_*_BIN` is a failure, with the remedy. For Grok CLI and Kimi Code CLI the line also checks their EYAS home, `<data dir>/cli-homes/<provider>` — see the next table. The versions last proven, and how: [Security & privacy — How isolation is proven](/docs/en/admin/security-privacy/#how-isolation-is-proven). |
| **CLI sandbox** | The `security.cliSandbox` mode and, for each installed CLI (Claude Code, Grok CLI, Kimi Code CLI), whether its own tools run in the kernel file sandbox: *active*, *unavailable* with the reason and the remedy (install bubblewrap; install socat — Claude Code needs it next to bubblewrap; allow unprivileged user namespaces, in a container too), or *none* for Kimi, which has no kernel sandbox. A missing sandbox is a warning, not a failure: with `auto` the CLI runs without it, with `required` its turns with tools are refused. See [Providers — Kernel file sandbox](/docs/en/ai/providers/#kernel-file-sandbox). |
| **Vault** | The memory vault path, `<data dir>/vault` (ok). Warns when notes in an old `<EYAS home>/data/vault` will be copied at the next start, and — with a remedy — when that old folder is no longer used because the vault in the data directory already has notes. Doctor never copies anything itself. See [Configuration — Data directory and vault](/docs/en/deploy/configuration/#data-directory-and-vault). |
| **SQLite** | A live self-test on a scratch in-memory database — your data file is never opened. Reports the SQLite version, whether **FTS5** is present (a failure without it: memory, conversation and vault search all need it), and whether the `sqlite-vec` extension loads, by actually inserting a row and running a nearest-neighbour query rather than just asking the version. A missing extension is a warning with the remedy for your platform, not a failure. |
| **Import roots** | Whether `skills.importRoots` / `agent.importRoots` are usable: ok when nothing is configured or every root is an ordinary folder; a warning that names the setting and the folder when a root lies inside, or contains, another assistant's or note app's own folders (`~/.claude`, `~/.grok`, an Obsidian vault, …) and is therefore not scanned. See [Configuration — Extra skill and persona roots](/docs/en/deploy/configuration/#extra-skill-and-persona-roots). |
| **Memory embedder** | Which embedder memory recall uses. Ok: *multilingual-e5-small, local (weights in &lt;folder&gt;)* when `@huggingface/transformers` is installed and the weights are in `data/models`. Warning: the hashed stem embedder (`stem5-fnv-384`) because `@huggingface/transformers` is not installed — remedy: run `bun add @huggingface/transformers` (or `bun install`) in the EYAS folder, then restart. Warning: the package is installed but the weights are not downloaded yet — the next start downloads them (about 130 MB) from Hugging Face into `data/models`, and until then recall uses the fallback. See [Memory — Vector search always runs locally](/docs/en/knowledge/memory/#vector-search-always-runs-locally). |
| **zstd** | Which compression implementation the raw record will use: Bun's native one, Node's (22.15 or newer), or the bundled WASM fallback. The fallback is a warning — it works and is about twice as slow. No implementation at all is a failure, and EYAS then records nothing rather than filling a buffer it can never write. |

The EYAS home check on the **CLI isolation (Grok CLI)** and **CLI isolation (Kimi Code CLI)** lines:

| What doctor finds in `<data dir>/cli-homes/<provider>` | Result |
|--------------------------------------------------------|--------|
| Not created yet | ok — the first run creates it |
| A symbolic link, or not a folder | failure — EYAS refuses to run the CLI from it. Remedy: remove it; the next run recreates it |
| A folder other users can read | warning — it holds the CLI's sign-in. Remedy: `chmod 700 <folder>` |
| A file EYAS manages there is missing or changed since EYAS wrote it (Grok: `config.toml`, `requirements.toml`, `trusted_folders.toml`; Kimi: `mcp.json` and EYAS's settings in `config.toml`) | warning — EYAS rewrites these files before the next run, so a change between runs means something else edits that folder |
| Everything as EYAS wrote it | ok — *EYAS home and managed files intact* |

<h3 id="environment">Environment</h3>

`EYAS_PORT`, `EYAS_HOST`, `EYAS_HOME`, `EYAS_DATA_DIR`, `EYAS_WORKSPACES_DIR`, `EYAS_CLAUDE_CODE_BIN`, `EYAS_GROK_BIN`, `EYAS_KIMI_BIN`, `EYAS_INSTALL_ROOT`, `EYAS_SKIP_WEB_BUILD`, `EYAS_SKIP_DOCS_BUILD`, `EYAS_FORCE_WEB_BUILD`, `EYAS_FORCE_DOCS_BUILD`. See [Configuration](/docs/en/deploy/configuration/) for what the path and runtime variables do.

Default port is **3100**. `EYAS_SKIP_DOCS_BUILD=1` is why `/docs` 404s — see [FAQ](/docs/en/reference/faq/).

## Related

- [Configuration](/docs/en/deploy/configuration/)
- [Native](/docs/en/deploy/native/)
- [Providers](/docs/en/ai/providers/)
- [Security & privacy](/docs/en/admin/security-privacy/)
- [FAQ](/docs/en/reference/faq/)
- [Settings — Updates](/docs/en/admin/settings/)
