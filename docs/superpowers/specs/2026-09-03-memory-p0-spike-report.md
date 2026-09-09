> Companion to `2026-09-03-sovereign-layered-memory-design.md`: the merged Phase 0 spike report (7 spikes). Raw scripts and logs are preserved outside the repository under `.superpowers/spikes/2026-09-03-memory/`.

# EYAS sovereign layered memory — Phase 0 spike report (merged)

Date 2026-09-03. Spec: `docs/superpowers/specs/2026-09-03-sovereign-layered-memory-design.md`, §15 Phase 0 items (a)–(i). Seven spikes under `$SPIKES/` (= `$SPIKES`): `sqlite-ext-docker` (a, b), `fts-knn-shapes` (c + the JS-scan half of a), `embedder` (d), `zstd-worker` (e, f), `provider-matrix` (g), `combined-rss` (h), `migration-dryrun` (i). Every per-spike `REPORT.md`, script and raw log is referenced below; nothing in this document is a new measurement except §4.2 (one reconciliation run, `$SPIKES/report/log/01-*`) and the read-only repo checks in `$SPIKES/report/log/00-*`. The repository `the repository` was not modified by any spike.

**Environment caveats that apply to every number.** Host = macOS ARM64, 14 cores / 24 GB, Bun 1.3.10, local Node **23.7.0** (no zstd), Docker client 28.1.1-rd. Pod stand-in = Docker `--cpus=2 --memory=3g`, **linux/arm64 native**; x86_64 was run once, under emulation (sqlite-ext-docker), and is not representative for latency. `oven/bun:1` / `oven/bun:1-slim` resolve to **Bun 1.4.0** today (bundled SQLite 3.53.2, claims Node 26.3.0 / ABI 147); `oven/bun:1.3` / `1.3-debian` = **1.3.14** (SQLite 3.53.0); only `oven/bun:1.3.10*` is the project's version (SQLite 3.51.2). Spikes ran on 1.3.10 (sqlite-ext, embedder, zstd-worker, all host runs), 1.3.14 (fts-knn pod, migration pod) and 1.4.0 (sqlite-ext, combined-rss). Sibling spikes shared the Docker VM; pod numbers are ±30 % and the *ordering* is the finding.

---

## 1. Executive verdict

| Item (§15 Phase 0) | Spike | Verdict | One-line evidence |
|---|---|---|---|
| **(a)** `sqlite-vec` under `bun:sqlite` on the glibc and musl images "with `libsqlite3` present"; JS-scan fallback at 40 k | sqlite-ext-docker, fts-knn-shapes, combined-rss | **PARTIAL** — glibc PASS, musl FAIL as shipped, JS-scan PASS | `oven/bun:1-slim` arm64 + amd64, Bun 1.3.10 and 1.4.0: `loadExtension(sqlite-vec)` + vec0 `float[384]`/`int8[384]` 1000 rows + KNN k=10 pass on Bun's **bundled** SQLite with no system lib involved; `setCustomSQLite()` is a silent no-op on Linux (returns `true` even for a non-existent path; `sqlite_version()` unchanged — re-verified in §4.2). Alpine: the npm `vec0.so` is glibc-linked (`NEEDED ld-linux-aarch64.so.1`, unresolved `__memcpy_chk`/`__fread_chk`) → `no such module: vec0`; `gcompat` does not help; passes only with a vec0 compiled from the amalgamation. JS int8 dot-product 40 k × 384 top-50: p50/p95 10.5/11.8 ms host, 11.2/12.4 ms pod (4-way unrolled 5.5/5.9 host, 6.1/6.5 pod), one-off blob load 35 ms / 15.4 MB. |
| **(b)** `better-sqlite3` under Bun (recorded alternative) | sqlite-ext-docker | **FAIL** | `require()` of the correct prebuilt `.node` (ABI 137 tarball, any path, renamed package) throws `'better-sqlite3' is not yet supported in Bun` (oven-sh/bun#4290; the string is inside the `bun` binary 1.3.10 and 1.4.0) on glibc arm64/x64 and musl; `bun add better-sqlite3@12.8.0` install script exits 1 on every image. **Bonus FAIL:** the committed `Dockerfile` cannot build — `bun install --frozen-lockfile --production` exits 1 after 4 s in `oven/bun:1` and `oven/bun:1.3.10` (better-sqlite3 is default-trusted → prebuild-install fails → node-gyp → "Could not find any Python installation"). |
| **(c)** contentless-FTS5 + filtered-KNN shapes as tests, < 50 ms p95 at 200 k | fts-knn-shapes | **PASS with the mandated shapes; FAIL for the naive ones** | 200 k int8, filtered top-50: `rowid IN (subquery)` p95 16–29 ms pod (15–22 host); vec0 `PARTITION KEY` equality p95 0.3–1.3 ms pod (0.1–0.4 host); **float** p95 49–62 ms pod (FAIL, 47–50 host). D1 set (global ∪ project, global = 54 % of rows): `rowid IN` 118/126 ms pod (FAIL); partition `IN (0,?)` + `MATERIALIZED` CTE 44.9/47.2 ms pod (worst case). FTS5 bm25 top-50 at 300 k: 0.6–25 ms pod; naive `rowid IN (…)` inside MATCH **540/587 ms** pod (FAIL); `+rowid IN (…)` 4.8/5.2 ms. Over-fetch-500-then-filter: 4–8× slower **and recall 2–30 %** (FAIL). RRF in one statement 26–40 ms p50 pod. Temp table == subquery == partition == metadata rows for every cell. |
| **(d)** transformers.js multilingual embedder: cold start, throughput, RSS, hu/de recall vs FTS | embedder | **PASS on model choice and recall; PARTIAL on throughput/RSS; FAIL for naive RRF** | `multilingual-e5-small` q8: R@1/R@5 **58.8 % / 85.0 %** (hu 62.5/90.0, de 60.0/95.0, en 50/65) vs `paraphrase-multilingual-MiniLM-L12-v2` 35.0/60.0, `all-MiniLM-L6-v2` 33.8/56.3, FTS5 bm25 12.5/22.5 (hu 7.5/17.5). Bun loads `onnxruntime-node` **natively** (no WASM, no Node worker). Pod: cold start 0.67–1.3 s; **33 sent/s** with ORT default threads → **64–66 sent/s** with `intraOpNumThreads: 2`; RSS after warm-up 519–526 MB (Node) / 722–744 MB (Bun), cgroup peak 517–828 MB. Naive RRF(FTS5 + e5) drops R@5 **85 → 65 %**. `Xenova/*` multilingual mirrors carry **no license field**; upstream `intfloat/multilingual-e5-small` is MIT and ships its own ONNX. |
| **(e)** zstd shim round-trip on both runtimes | zstd-worker | **PASS** | 1000/1000 messages decompress Bun 1.3.10 → Node 22.23.2 and back, both corpora; frames **byte-identical** (libzstd 1.5.7 in both). Ratio **2.663 @L3** on real repo text (5.475 on the synthetic corpus — not representative). Compress 135 MB/s (Bun) / 136 MB/s (Node) at 2 vCPU ≈ 32 µs/msg. `fzstd` 0.1.1 is **decompress-only**; `@bokuweb/zstd-wasm` 0.0.27 (MIT) compresses and interchanges 1000/1000. Node native tier exists only from **22.15.0** (23.0–23.7 lack it; the host's 23.7.0 has none). `zstd-shim.test.ts`: 5/5 `bun test`, 4 pass + 1 skip `node --test`. |
| **(f)** worker thread with its own WAL connection under Bun | zstd-worker | **PASS, with a max-stall caveat (PARTIAL on mitigation)** | Bun `Worker` + second `bun:sqlite` WAL connection sweeping 1 000 000 rows: 0 × `SQLITE_BUSY` in 14 cells, 1 000 000 rows touched every time, worker start lag 2–28 ms; main-thread read p50/p95/p99 **unchanged** (2–8 µs). But reader **max** stall 0.6–2.6 s in 2-vCPU cells = WAL auto-checkpoint starvation (same work: 104.8 s vs 27.2 s sweep). Chunk 10 000 = **18–21 s** per 1 M rows on pod; 500–2 000 = 100–121 s. `wal_autocheckpoint=0` + end checkpoint: 32.7 → 20.6 s but WAL grew to 1 473 328 frames (~5.6 GB); periodic checkpoint **UNTESTED**. Node 22 `worker_threads` + better-sqlite3 12.11.1: identical picture. |
| **(g)** provider matrix `supportsHeadlessInvocation × supportsIsolatedCompletion` | provider-matrix | **PASS claude-code · FAIL grok-cli (isolation) · UNTESTED kimi-cli · PASS API providers (by code)** | claude-code SDK `query()` with the provider's isolated options: 3/3 strict JSON, **1 048** input tokens (prompt-only), `init.tools: []`, `mcp_servers: []`, host context seen `[]`, canary `false`, ~8.3 s wall, **$0.015/call** on the CLI default `claude-opus-4-6[1m]`, SDK-bundled CLI **2.1.89** (not the installed 2.1.259). grok-cli 1.0.13 `-p` is headless (`--output-format json`, `--json-schema` work) but **not isolatable**: default 33–36 k input tokens; the model ran `memory_search` and `grep`'d `~/.grok/memory` **and** `~/Documents/Obsidian Vault/99_Meta/ai-memory`; with every kill-switch (`GROK_MEMORY=0`, `GROK_CLAUDE_*_ENABLED=0`, `--disallowed-tools <all 26>`, `--system-prompt-override`) still **15 052** tokens, `MEMORY.md` + `run_terminal_command` + guardian/context7 MCP tools present; `--tools ""` is a no-op; `--max-turns 1` exits 1. kimi-cli not installed. `embed()` real only on `openai` and `ollama`; openai-compat/xai/openrouter/kimi-API inherit an unverified `/embeddings`. `supportsHeadlessInvocation`: **0 hits in `src/`**. |
| **(h)** combined RSS under `--memory=3g` | combined-rss | **PASS for the 2–4 GB budget · FAIL for the shipped k8s limits · 1 run UNRESOLVED** | 4 × 3-min runs of one Bun process (1 M-row WAL loop ≈100 commits/s + 40 k int8 KNN every 200 ms + 16 sent/s embedding + 20 rps HTTP): `OOMKilled=false` all; process RSS **442 MB** (sqlite-vec) / **469 MB** (JS scan); cgroup peak 718–873 MB; `docker stats` max **551–558 MiB** — above the raw manifest's 512Mi limit (`deploy/k8s/deployment.yaml:37-40`) and leaving < 300 MiB under Helm's 1Gi (`deploy/k8s/helm/eyas/values.yaml:152-155`). HTTP p50/p95/p99 0.47/15/29–52 ms in clean runs; run 2 degraded to p95 2.06 s with CPU 0 % — UNRESOLVED host-side I/O stall. Embedder = +397–412 MB, of which **tokenizer ≈ 249 MB**, model 86 MB, runtime 64 MB. JS scan p95 **11.8 ms beat sqlite-vec 21.9 ms** at 40 k unfiltered on the main thread. arm64 only. |
| **(i)** migration dry-run on a copy of `data/sqlite/eyas.db` with counts and hash spot-checks | migration-dryrun | **PASS with 4 spec corrections · `episodic`/`archive` path UNTESTED (0 rows)** | 61/61 messages, 9/9 `LlmResponse`, 266/266 vault notes, 15/15 capture runs, 2/2 note links → 336 raw / 336 blob / 266 gist / 1 324 tag / 338 link / 16 run rows; run twice → identical data counts (only the migration's own `memory_run` row is added); 20/20 hash spot-checks (zstd-decompress → SHA-256 = `content_hash` = SHA-256 of source); `occurred_at` fidelity 336/336, ULID timestamp = `occurred_at` 336/336; 66 ms host, 472 ms pod, +1.65 MB. Spec assumptions broken: `vault_index.file_hash` = `${size}-${mtimeMs}` (0/266 are hashes); 3/9 `LlmResponse` are byte-duplicates of parent-conversation assistant messages; `(content_hash, shred_partition_id)` key vs the "one blob" acceptance (336 blobs for 321 distinct hashes); `datetime('now')` timestamps parse **7 200 000 ms** off with naive `Date.parse`. |

**Owner decisions the spec asked Phase 0 to inform (§16-1, §16-2)** — evidence, not yet the owner's decision:
- §16-1 keep `bun:sqlite`: **confirmed, and the alternative is closed** — `better-sqlite3` cannot load under Bun at all (hard block, not a packaging gap). Bun's Linux builds load `sqlite-vec` natively; the "ship `libsqlite3`" half of the recommendation is void.
- §16-2 bundle a multilingual embedder: **confirmed; the model is `multilingual-e5-small`**, at a cost the spec under-stated by ~4×: ~136 MB on disk, ~0.5 GB RSS (the XLM-R tokenizer alone ≈ 250 MB).

---

## 2. Production defaults now fixed by evidence

| # | Default | Fixed value | The number that decided it | Source |
|---|---|---|---|---|
| 1 | Storage engine | **`bun:sqlite` + `sqlite-vec` loaded into Bun's bundled SQLite**; `better-sqlite3` is Node-only | vec0 float/int8 1000-row insert + KNN pass on `oven/bun:1-slim` arm64 + amd64 (Bun 1.3.10 and 1.4.0) with no system lib; `require('better_sqlite3.node')` → `not yet supported in Bun` on every image | sqlite-ext-docker §1, §2 |
| 2 | `setCustomSQLite` / `libsqlite3` probe | **macOS-only workaround**; on Linux skip the probe; module-level once-per-process guard (second call throws `SQLite already loaded`); replace `isSqliteExtensionLoadingAvailable()` (0 callers outside `connection.ts`) with a live self-test (`vec_version()` + 1-row `int8` insert + KNN) reported by `eyas doctor` | Linux: `setCustomSQLite()` returns `true` for a non-existent path, `sqlite_version()` stays bundled (3.51.2 / 3.53.0 / 3.53.2 by Bun version, Debian's lib is 3.46.1); macOS: Apple SQLite 3.51.0 refuses `loadExtension`, Homebrew 3.51.2 works | sqlite-ext-docker §3, §5.1; `$SPIKES/report/log/01-*` |
| 3 | Runtime image | **`oven/bun:<pinned>-slim` (glibc, Debian 13), tag or digest pinned to the project's Bun** (1.3.10 today); **no Alpine/musl** unless the build stage compiles `vec0.so` from the amalgamation (`gcc -O2 -fPIC -shared -D_GNU_SOURCE -include sys/types.h -Wno-incompatible-pointer-types … -lm`); `libsqlite3-0` may be listed explicitly (harmless) but does nothing for Bun | `oven/bun:1` = Bun 1.4.0 (SQLite 3.53.2, Node ABI 147) vs project 1.3.10; musl npm `vec0.so` unresolvable glibc symbols; `+1 234 B` for explicit `libsqlite3-0` on slim (package already present via `liblastlog2-2`), `+872 699 B` on alpine; `onnxruntime-node` is glibc-only too | sqlite-ext-docker §2, §6; embedder §Surprises 1 |
| 4 | Docker build | `bun install --frozen-lockfile --production --ignore-scripts` in the `deps`/`build-deps` stages, **or** `better-sqlite3` → `optionalDependencies` with a documented `npm rebuild better-sqlite3` for Node | Committed `Dockerfile` (`FROM oven/bun:1` ×5, `oven/bun:1-slim` runtime) exits 1 after 4 s on `bun install`; no `trustedDependencies`/`.npmrc` override exists in `package.json` | sqlite-ext-docker §1 bonus row, §5.3; `$SPIKES/report/log/00-*` |
| 5 | sqlite-vec role | **Load-bearing for filtered KNN and persistence, not for raw speed.** vec0 table `(project_id INTEGER PARTITION KEY, embedding int8[384])`, global = partition 0; `vec_int8(?)` on **INSERT and MATCH**; **JS int8 scan is the fallback** (macOS without Homebrew, musl) and is *faster* for an unfiltered ≤ 40 k scan; both run in the worker | Partition-key filtered top-50 at 200 k: p95 0.3–1.3 ms pod vs `rowid IN` 16–29 ms vs float 49–62 ms; JS scan p95 11.8 ms vs sqlite-vec 21.9 ms at 40 k unfiltered on the main thread; raw KNN int8 at 200 k on pod = 76.5/80.0 ms, **no faster than float** (77.1/80.0); a raw 384-byte blob into `int8[384]` is rejected as "float32 vector" | fts-knn-shapes §Numbers (2), combined-rss §Numbers, §Surprises 2–3 |
| 6 | Vector storage format | **int8 only**; float banned from the design vocabulary | float p95 misses 50 ms at 200 k on host and pod; 309.9 MB vs 89.1 MB on disk (3.5×); today's `vec-store.ts` uses `float[dim]` + a JSON-text `vec_f32` literal → rewrite | fts-knn-shapes §Numbers (1), (6); `$SPIKES/report/log/00-*` |
| 7 | Key discipline | **Integer surrogate rowid shared by vec0, FTS5 and `memory_tag.memory_id`**; ULID stays the sync identity, never the filter path; D1 set = `MATERIALIZED` CTE over `project_id IN (0, project, project_type)` + outer `ORDER BY distance LIMIT k` (vec0 returns k rows **per partition**, and a bare outer LIMIT is rejected: `Only LIMIT or 'k =?' can be provided, not both`) | CTE 10.2/10.7 host, 44.9/47.2 pod, 50 rows; without CTE = error on SQLite 3.51 and 3.53 | fts-knn-shapes `log/11-cte-check-*` |
| 8 | FTS filter shape | **`+rowid IN (SELECT memory_id FROM memory_tag …)`** (unary plus) — the naive form is a regression test with a latency assertion | naive `rowid IN` inside MATCH 540/587 ms pod (MATCH re-run ~2 200×); `+rowid` 4.8/5.2 ms; "subselect + JOIN" is planner-dependent (504 ms on 3.51.2, 9.5 ms on 3.53.0) | fts-knn-shapes §Numbers (3) |
| 9 | Embedder model | **`multilingual-e5-small`**, q8 ONNX, 384-d, **`query: ` / `passage: ` prefixes mandatory**, `model_id = multilingual-e5-small@q8/e5-prefix`; weights from **`intfloat/multilingual-e5-small` (MIT)** (`onnx/model_qint8_*.onnx` + `tokenizer.json`), not from an unlabelled `Xenova/*` mirror; `all-MiniLM-L6-v2` (23.7 MB, 150–240 MB RSS) = documented English-only downgrade, not default; `paraphrase-multilingual-MiniLM-L12-v2` dropped | R@1/R@5 58.8/85.0 vs 35.0/60.0 vs 33.8/56.3 at identical size and speed; hu 62.5/90.0 vs FTS5 7.5/17.5 | embedder §Verdict, §Numbers |
| 10 | Embedder size on disk | **~136 MB** (118 308 185 B ONNX + 17 082 730 B `tokenizer.json`), downloaded once into `data/models/`, presence/hash reported by `eyas doctor`; q4 is *larger* (399 MB) for this vocab | `log/20-hf-licenses-and-files.txt`, `log/61-model-cache-files.txt` | embedder §Numbers |
| 11 | Embedder host runtime | **Bun in-process via `onnxruntime-node` (native addon, glibc)** inside the light-pass worker thread; no Node sidecar; `session_options: { intraOpNumThreads: min(2, quota), interOpNumThreads: 1 }`; lazy load, `dispose()` after idle | `process.release.name === 'node'` under Bun → `OnnxruntimeSessionHandler`; pod throughput 33 → 64–66 sent/s when pinned to 2 threads (ORT sizes its pool from visible CPUs, not the cgroup quota); cold start 0.67–1.3 s pod; 16-sentence batch 242–252 ms | embedder §Numbers, §Surprises 1–2 |
| 12 | Embedder memory budget | **0.6 GB process RSS for the embedder; ≤ 1.2 GB cgroup for the whole memory subsystem** (tokenizer ≈ 250 MB of it, shared by every XLM-R model) | Linux/Node 421/519 MB after load/warm, Bun 562–580/722–744, cgroup peak 517–828 MB (embedder alone); whole combined process 442–469 MB RSS, cgroup 718–873 MB | embedder §Numbers; combined-rss §Numbers |
| 13 | zstd shim | **3 tiers:** `Bun.zstdCompressSync` → `node:zlib` zstd (**Node ≥ 22.15.0**; 23.0–23.7 lack it — fail loudly) → **`@bokuweb/zstd-wasm`** (MIT, 1.1 MB, `await init()` once); `fzstd` **out** (decompress-only); **level 3**; blob identity = SHA-256 of the *uncompressed* bytes | L3 ratio 2.663; L6/L9 +4 % ratio for 2–4× CPU; L1 −2.6 % ratio for +13 % speed; 32 µs/msg at 2 vCPU; frames byte-identical today but not a contract | zstd-worker §2.1–2.3, §5 |
| 14 | L0 sizing | Plan on **~2.7× compression**, not 5× | realistic corpus 2.663 vs synthetic 5.475 | zstd-worker §2.2 |
| 15 | Light-pass worker | **Bun `Worker` + own `bun:sqlite` WAL connection** (Node `worker_threads` + better-sqlite3 as fallback, one TS worker module); **chunk 5 000–10 000 rows**; yield = `setImmediate`/`sleep(0)`; `busy_timeout 5000`; **`synchronous=NORMAL`**; **worker owns checkpointing** (`wal_autocheckpoint=0`, `wal_checkpoint(PASSIVE)` every ~50 chunks ≈ 100 MB WAL, `TRUNCATE` at end); Phase 4 test asserts WAL < 256 MB during a sweep and max reader stall, not only p99 | chunk 10 000: 18.2–21.2 s per 1 M rows on pod vs 100–121 s at 500–2 000; 1 ms yield changes p50/p95/p99 by < 1 µs; auto-checkpoint on = 0.6–2.6 s max stalls; fsync-per-commit (`synchronous=FULL`) is the suspected cause of the combined-rss run-2 stall | zstd-worker §2.4, §4.5–6, §5; combined-rss §Surprises 6 |
| 16 | Provider eligibility for background extraction/consolidation | **`eligible(p) := p.supportsHeadlessInvocation === true && (p.supportsIsolatedCompletion === true \|\| !isCliProviderId(p.id))`**; add `supportsHeadlessInvocation` to `AIProvider` in **Phase 1**; `true` on every API provider and claude-code, **absent on grok-cli and kimi-cli** even though `grok -p` exists; **drop the `gateway-fallback` rung (d)** for background work (background = eligible provider or degraded, never "let the gateway choose") | claude 1 048 vs grok 15 052 (floor) – 36 088 injected tokens; grok grep'd the Obsidian ai-memory vault to answer the canary; `--tools ""` removed 0 of 31 tools | provider-matrix §2.1–2.4, §5 |
| 17 | Background-call cost accounting | Record `result.total_cost_usd`, `modelUsage`, `duration_api_ms`, SDK-bundled CLI version in `memory_run`; plan CLI-only installs at **~$0.015 and ~8 s per 20-line batch** on the CLI default `claude-opus-4-6[1m]`; consider an owner-set alias for the isolated path only | 3 runs: $0.014915 / 0.015715 / 0.015840, 8 232–8 536 ms | provider-matrix §2.1, §4.2 |
| 18 | `gateway.embed()` selection | Select only providers that **declare** an embedding model (`openai`, `ollama`); gate the inherited compat `embed` behind a catalog flag | compat spread of `createOpenAIProvider()` gives xai/openrouter/kimi an `embed` that hits `${baseURL}/embeddings` unverified; "first provider with `embed`" can pick a host with no endpoint | provider-matrix §2.3, §4.6 |
| 19 | Hybrid retrieval fusion | **Not naive RRF.** Lexical channel gated: query tokens prefix-stemmed to 5 chars + `*`, stop-words / tokens < 3 chars dropped, weight ≤ 0.3 or admitted only when a bm25 hit contains ≥ 2 distinct stems; dense list is the primary ordering | naive RRF k=60 36.3/65.0 vs e5 alone 58.8/85.0; best weighted fusion 46.3/75.0; prefix-5 FTS lifts hu R@5 17.5 → 60 % at zero cost; `trigram` worse and larger | embedder §Numbers recall, §Surprises 5–6 |
| 20 | Main-thread hygiene | **KNN (both engines) and tokenization run in the worker**, never on the request thread | HTTP p99 29 ms (sqlite-vec, KNN p95 22 ms) vs 52 ms (JS scan + GC) at only 20 rps | combined-rss §Surprises 7 |
| 21 | Migration corrections (§14) | (i) vault hash = **SHA-256 of file bytes computed at migration** (`vault_index.file_hash` is a `${size}-${mtimeMs}` change detector); (ii) `LlmResponse` join = **`agent_events.session_id = agent_sessions.id → agent_sessions.conversation_id`** (managed child; parent via `conversations.parent_conversation_id`), **skip an `LlmResponse` whose hash already exists as an `assistant_message` in the parent**, `actor` from `agent_sessions.agent_id`; (iii) timestamp rule: ISO `Z` text, integer ms (`agent_events.ts`), `datetime('now')` `YYYY-MM-DD HH:MM:SS` **as UTC**, vault `created` date → midnight UTC; new tables store INTEGER epoch ms; (iv) blob identity: **keep `(content_hash, shred_partition_id)` and rewrite the Phase 1 acceptance to "two raw rows, two blobs, one hash"** (consistent with per-conversation DEKs, §11); (v) a `migrated_from` link **per raw row**; (vi) `skipped_reason='error'` → `failed`, `unparsable`/`too-short` → `skipped`; run↔link match = same conversation + same second, ±60 s fallback; (vii) `attachments` → `meta_json`/`attachments_json` on `memory_raw` or `part_of` links (5 live rows); (viii) `CriticVerdict` explicitly **not migrated** (or a new `source_type`); (ix) the migration writes its own `memory_run(run_type='migration')` and is idempotent rather than flag-guarded; (x) imported `reference` gist text: strip leading `# heading`, prefer first body paragraph over the ~160-char truncated `summary`; `imported`/`import-job:*` tags are provenance, not `topic` | 0/266 `file_hash` are hashes; 266/266 fresh vs filesystem; 3/9 duplicates; `actor` NULL 18/18; `local_parse_trap_ms: 7200000`; 336 blobs / 321 hashes; re-run 78 ms under pod limits; gist `token_count` 28–40 on all 266 | migration-dryrun §Verdict, §Surprises, §Recommendation |
| 22 | K8s memory request / limit | **requests `memory: 1Gi`, limits `memory: 2Gi`** in both `deploy/k8s/deployment.yaml` and `deploy/k8s/helm/eyas/values.yaml`; **CPU requests 500m / limits 2**; keep `512Mi/1Gi` only as a documented "bridge-embeddings-only" profile; add `EYAS_MEMORY_EMBEDDER=local\|bridge\|off` so `doctor` prints the expected footprint; size on **cgroup** numbers, not `process.memoryUsage().rss` | `docker stats` peak 551–558 MiB > 512Mi; cgroup peak 718–873 MB; RSS moved +9 MB while cgroup moved +175 MB on DB open (page cache); CPU 15–30 % of one core in steady state | combined-rss §Verdict, §Numbers, §Recommendation |

---

## 3. Numbers (consolidated)

Full tables live in each spike's `REPORT.md`; the rows below are the ones the decisions rest on. p50 / p95 in ms unless stated; "pod" = `--cpus=2 --memory=3g` linux/arm64.

### 3.1 Runtimes, SQLite versions, images (sqlite-ext-docker; `$SPIKES/report/log/01-*`)

| Where | Bun | `sqlite_version()` via `bun:sqlite` | System `libsqlite3` | Extension loading |
|---|---|---|---|---|
| `oven/bun:1.3.10` / `1.3.10-slim` (Debian 13, glibc 2.41) | 1.3.10 | 3.51.2 (bundled) | 3.46.1-7+deb13u1 (ignored) | vec0 PASS |
| `oven/bun:1.3` / `1.3-debian` | 1.3.14 | 3.53.0 (bundled; `setCustomSQLite` → `true`, no effect) | 3.46.1 (ignored) | vec0 PASS |
| `oven/bun:1` / `1-slim` (arm64 and amd64) | 1.4.0 | 3.53.2 (bundled) | 3.46.1 (ignored) | vec0 PASS |
| `oven/bun:1-alpine` / `1.3.10-alpine` (musl) | 1.4.0 / 1.3.10 | bundled | `sqlite-libs` 3.49.2 optional | npm vec0 FAIL (glibc-linked); amalgamation build PASS |
| macOS dev box | 1.3.10 | Apple 3.51.0 → Homebrew 3.51.2 via `setCustomSQLite` | Homebrew | only with Homebrew lib |

Image sizes (arm64 bytes): slim base 69 446 510; + `libsqlite3-0` 69 447 744 (+1 234); alpine base 42 991 398; + `sqlite-libs` 43 864 097 (+872 699). Committed `Dockerfile` build (`bun install --frozen-lockfile --production` in `oven/bun:1`): **exit 1, 4 s**.

`better-sqlite3` 12.8.0 under Bun: 1.3.10 reports Node 24.3.0 (ABI 137 prebuilt exists, load refused); 1.4.0 reports Node 26.3.0 (ABI 147, no prebuilt, HTTP 404); refusal string present in both binaries.

### 3.2 KNN latency, sqlite-vec 0.1.9, top-50, 50 runs warm (fts-knn-shapes)

Raw (unfiltered):

| n | variant | host | pod |
|---|---|---|---|
| 50 k | f32 / i8 | 12.8/14.2 · 5.6/7.5 | 24.4/25.5 · 19.9/21.4 |
| 100 k | f32 / i8 | 29.5/34.1 · 9.6/10.3 | 38.4/41.3 · 37.6/40.2 |
| 200 k | f32 / i8 | 51.0/53.3 · 18.2/19.3 | 77.1/80.0 · 76.5/80.0 |

Filtered at 200 k (project selectivity p1 0.30 % · p20 1.09 % · p40 2.01 %):

| shape | variant | host p1 · p20 · p40 | pod p1 · p20 · p40 | rows |
|---|---|---|---|---|
| `rowid IN (subquery)` | f32 | 44.4/47.9 · 44.4/47.4 · 46.9/49.8 | 46.2/49.0 · 51.7/54.3 · 58.8/62.2 | 50 |
| `rowid IN (subquery)` | i8 | 14.0/15.0 · 18.0/22.2 · 19.6/22.4 | 13.6/16.1 · 21.1/22.7 · 27.8/29.4 | 50 |
| temp table (identical rows) | i8 | 14.0/15.0 · 18.0/20.8 · 20.8/22.9 | 15.5/16.4 · 22.2/23.1 · 28.8/30.3 | 50 |
| over-fetch 500 then filter | i8 | 85.2/115.4 · 81.8/85.1 · 79.9/88.6 | 168.7/184.5 · 178.3/185.6 · 178.4/187.5 | **3 · 6 · 7** (recall 6/12/14 %) |
| `PARTITION KEY =` | i8part | 0.1/0.1 · 0.3/0.3 · 0.3/0.4 | 0.3/0.3 · 0.9/1.1 · 1.3/1.3 | 50 |
| metadata `=` | i8meta | 10.2/11.5 · 11.6/12.7 · 13.2/14.3 | 10.4/11.7 · 17.5/18.9 · 21.0/25.2 | 50 |
| D1 `rowid IN` (global ∪ p20) | i8 | 84.8/93.2 | 118.0/126.0 | 50 |
| D1 partition `IN (0,?)` | i8part | 10.0/10.9 | 41.1/43.5 | **100** (k per partition) |
| D1 partition `IN` + `MATERIALIZED` CTE + LIMIT 50 | i8part | 10.2/10.7 | 44.9/47.2 | 50 |
| D1 metadata `IN` | i8meta | 24.3/26.3 | 67.2/69.9 | 50 |

At 50 k / 100 k: int8 `rowid IN` p95 4.2–7.7 / 6.4–14.2 pod; partition key 0.3 / 0.3–0.9 pod; float `rowid IN` 15.6–20.7 / 23.7–31.1 pod. Over-fetch recall 2–30 % at every size. File size at 200 k: f32 309.9 MB · int8 89.1 MB · int8+partition 96.8 MB · int8+metadata 90.8 MB; build 38.6–39.7 k rows/s (float), 52.6–54.8 k (int8).

### 3.3 FTS5, RRF, JS scan (fts-knn-shapes; combined-rss)

| shape | host | pod |
|---|---|---|
| FTS5 contentless 300 k insert | 707–863 ms (348–424 k rows/s), `optimize` 99–103 ms; file 18 MB | — |
| bm25 top-50: 2-term AND · OR · 1 term · rare∧common · rare∨common | 7.8/11.5 · 30.1/31.5 · 16.4/17.4 · 0.6/0.8 · 17.0/18.5 | 6.4/7.8 · 23.0/25.0 · 10.9/12.1 · 0.6/0.8 · 13.4/15.5 |
| filtered A: `rowid IN (…)` inside MATCH | **508.5/543.6** | **540.0/587.1** |
| filtered B: `+rowid IN (…)` | 4.3/4.9 | 4.8/5.2 |
| filtered C: subselect + JOIN | 504.5/544.2 (SQLite 3.51.2) | 9.5/9.9 (3.53.0) |
| filtered D: over-fetch 500 + JOIN | 32.3/34.4 (6 rows) | 26.6/28.5 (6 rows) |
| filtered E: CROSS JOIN tag | 9.8/10.3 | 10.7/11.7 |
| RRF one statement, FTS-B + KNN `rowid IN`, 200 k i8, p1 · p20 · p40 | 17.4/18.3 · 19.8/21.6 · 23.7/25.1 | 25.9/27.9 · 32.5/34.0 · 39.7/42.3 |
| RRF with FTS-A | 521.6/555.4 | 571.0/624.2 |
| JS int8 dot-product 40 k × 384 top-50 (plain · unrolled-4 top-1) | 10.5/11.8 · 5.5/5.9 | 11.2/12.4 · 6.1/6.5 |
| JS blob load 40 k rows / 15 360 000 B | 27.7 ms | 34.7 ms |
| combined-rss, main thread, 40 k unfiltered every 200 ms: sqlite-vec · JS scan | — | 17.9/21.9 (max 28.5) · 10.6/11.8 (max 18.9) |

### 3.4 Embedder (embedder; combined-rss)

| Model | Upstream license | Xenova card | q8 ONNX + tokenizer | dim / max seq | all R@1 / R@5 / MRR | hu R@1/R@5 | de | en |
|---|---|---|---|---|---|---|---|---|
| FTS5 bm25 exact tokens (`unicode61 remove_diacritics 2`) | — | — | — | — | 12.5 / 22.5 / 0.174 | 7.5/17.5 | 15.0/20.0 | 20.0/35.0 |
| FTS5 bm25 prefix-5 `tok*` | — | — | — | — | 30.0 / 48.8 / 0.382 | 35.0/60.0 | 25.0/35.0 | 25.0/40.0 |
| `all-MiniLM-L6-v2` | Apache-2.0 | apache-2.0 | 22 972 370 + 711 661 = 23.7 MB | 384 / 512 | 33.8 / 56.3 / 0.435 | 22.5/47.5 | 25.0/40.0 | **65.0/90.0** |
| `paraphrase-multilingual-MiniLM-L12-v2` | Apache-2.0 | **none** | 118 308 126 + 17 082 913 = 135.4 MB | 384 / 128 | 35.0 / 60.0 / 0.471 | 45.0/67.5 | 35.0/50.0 | 15.0/55.0 |
| **`multilingual-e5-small`** | **MIT** | **none** | 118 308 185 + 17 082 730 = 135.4 MB | 384 / 512 | **58.8 / 85.0 / 0.697** | **62.5/90.0** | **60.0/95.0** | 50.0/65.0 |
| RRF k=60 FTS5-exact + e5 (naive) | | | | | 36.3 / 65.0 / 0.498 | 32.5/67.5 | 45.0/70.0 | 35.0/55.0 |
| RRF k=60 FTS5-prefix5 + e5 (naive) | | | | | 37.5 / 70.0 / 0.517 | 42.5/77.5 | 30.0/65.0 | 35.0/60.0 |
| RRF 0.3×FTS5-prefix5 + 1.0×e5 | | | | | 46.3 / 75.0 / 0.597 | 57.5/82.5 | 30.0/75.0 | 40.0/60.0 |

Set: 80 labelled query→doc pairs (40 hu / 20 de / 20 en) vs 80 gold + 300 distractors, strict R@k; `dataset.mjs`.

Pod performance, batch 16 × 128 tokens, 2 warm-up + 10 timed (cold start = process start → first embedding, warm disk cache):

| runtime | model | threads | cold ms | sent/s | 1-query p50 ms | RSS load / warm MB | cgroup peak MB |
|---|---|---|---|---|---|---|---|
| Node 22.23.2 | e5-small | default (4 visible) | 1 311 / 1 024 | 32.6 / 32.9 | 13 / 10 | 421/519 · 418/526 | 517 / 603 |
| Node 22.23.2 | e5-small | **2** | 959 | **63.5** | 5 | 422/521 | 622 |
| Bun 1.3.10 | e5-small | default | 673 | 34.2 | 8 | 562/722 | 797 |
| Bun 1.3.10 | e5-small | **2** | 788 | **66.1** | 5 | 580/744 | 828 |
| Node 22.23.2 | L6-v2 | 2 | 204 | 134.0 | 3 | 147/242 | 225 |
| Bun 1.3.10 | L6-v2 | 2 | 235 | 119.9 | 4 | 186/266 | 240 |
| mac Bun | e5-small | default (14) | 444 | 132.9 | 3 | 747/852 | — |

Embedder RSS breakdown (combined-rss, `paraphrase-L12`, same XLM-R tokenizer as e5): `import '@huggingface/transformers'` +64 MB → `AutoTokenizer` (17 MB json) **+248.6 MB** (≈160 MB JS heap) → `AutoModel` q8 +86.0 MB → inference +0; total 423 MB. `node_modules` 401 MB of which `onnxruntime-node` 211 MB.

### 3.5 zstd (zstd-worker)

| Backend @L3, realistic corpus (1000 msgs, 200/1 965/20 429 B, 4.38 MB) | ratio | compress MB/s | decompress MB/s | per msg |
|---|---|---|---|---|
| Bun 1.3.10 native, macOS host | 2.663 | 266 | 761 | 16.5 µs |
| Bun 1.3.10 native, pod | 2.663 | 135 | 630 | 32.5 µs |
| Node 22.23.2 `node:zlib`, pod | 2.663 | 136 | 268 | 32.1 µs |
| `@bokuweb/zstd-wasm` 0.0.27 MIT (Bun pod / Node pod) | 2.663 | 65 / 65 | 125 / 277 | — |
| `fzstd` 0.1.1 MIT (decompress only) | — | **none** | 92 / 100 | — |

Levels (ratio): L1 2.595 · L3 2.663 · L6 2.771 · L9 2.778; L6 costs 107 vs 266 MB/s, L9 54 MB/s on the host. Cross-runtime: 1000/1000 decompress OK each direction on both corpora, 1000/1000 byte-identical frames. Node docs: every `zlib.zstd*` "Added in: v22.15.0" (v23.8.0 on the 23 line).

### 3.6 Worker sweep, 1 000 000 rows, WAL, index on `(presence_tier, decay_score)` (zstd-worker)

| runtime / env | chunk / yield | reads during p50/p95/p99 µs | **max stall ms** | sweep s | max txn ms | BUSY |
|---|---|---|---|---|---|---|
| Bun, host | 500 / 1 ms | 3.7/6.5/10.5 | 45.4 | 51.6 | 373 | 0 |
| Bun, host | 2000 / 1 ms | 4.1/7.5/11.1 | 2.5 | 32.7 | 103 | 0 |
| Bun, host | 10000 / 1 ms | 4.2/7.9/11.7 | 83.8 | 19.7 | 2 149 | 0 |
| Bun, host | 10000 / none | 4.1/7.1/10.4 | 1 286.7 | 27.1 | 2 974 | 0 |
| Bun, pod | 500 / none | 2.3/5/8.7 | 1 654.6 | 120.9 | 4 376 | 0 |
| Bun, pod | 2000 / 1 ms | 2.2/5/12.4 | **2 588.9** | 104.8 | 5 223 | 0 |
| Bun, pod | 2000 / none | 2.1/4.4/6.9 | 10.9 | 27.2 | 1 096 | 0 |
| Bun, pod | 10000 / 1 ms | 2.2/4.8/7 | 14.0 | **21.2** | 2 310 | 0 |
| Node 22, pod | 500 / none | 2.4/6.2/8.9 | 31.2 | 109.4 | 4 405 | 0 |
| Node 22, pod | 2000 / 1 ms | 2.1/5.5/11.5 | 620.5 | 100.3 | 6 428 | 0 |
| Node 22, pod | 10000 / 1 ms | 2.2/5.5/7.4 | 9.0 | **18.2** | 2 248 | 0 |
| Bun, host, `wal_autocheckpoint=0` + end ckpt | 2000 / 1 ms | 4.2/8.7/25.6 | 199.4 | 20.6 (+0.19 ckpt) | 250 | 0 |

Worker start lag: Bun 2–28 ms, Node 46–317 ms. macOS bind mount: Node made no progress in 7 min (abandoned); container-local disk used for all pod cells.

### 3.7 Provider matrix (provider-matrix)

| provider | isolated | headless | `embed()` | measured |
|---|---|---|---|---|
| claude-code (SDK `query()`, provider's isolated options) | **yes** | **yes** | no | 3/3 strict JSON; 1 048 in / 387–424 out tokens; cache 0/0; `duration_api_ms` 7 392–7 570; wall 8 232–8 536 ms; $0.014915–0.015840; `num_turns` 1; CLI 2.1.89 bundled |
| grok-cli 1.0.13 (`-p`) | **no** | yes (`-p`); provider uses ACP stdio | no | run 1 (`--max-turns 1`, `--disallowed-tools "*"`): exit 1 "max turns reached", 33 250 in; run 2: 35 177 in, tool calls `memory_search` ×2, `grep ~/.grok/memory`, `grep …/Obsidian Vault/99_Meta/ai-memory`; run 3 (+env kill-switches, `--tools ""`): 36 088 in, 31 tools still advertised; run 4 (+`--disallowed-tools` ×26, `--system-prompt-override`): **15 052 in**, strict JSON, `run_terminal_command` + 6 guardian + 2 context7 tools still present |
| kimi-cli | unknown → treat no | ACP only | no | not installed; `kimi-cli/provider.ts:182` disclaims isolation |
| anthropic · gemini · anthropic-compat · lmstudio | yes (HTTP) | yes | **no** | code |
| openai | yes | yes | **yes** (`client.embeddings.create`) | code |
| ollama | yes | yes | **yes** (`POST /api/embed`) | code |
| openai-compat/xai · openrouter · kimi-API | yes | yes | inherited, **unverified** | code |

### 3.8 Combined footprint (combined-rss, `oven/bun:1-slim` = Bun 1.4.0, arm64)

Phase increments (RSS after `Bun.gc(true)`; cgroup incl. page cache): baseline 24.9 MB / 7 → + 1 M-row WAL DB loop 33.5–34.0 / 180–182 → + vectors (vec0 int8 40 k 40.4 / 201 · Int8Array 56.0 / 198) → + embedder running **437.7 / 726** (vec) · **468.2 / 584** (js) → + `Bun.serve` 439.6 / 728 · 469.2 / 584.

| run | vec | RSS MB | cgroup peak | `docker stats` max MiB | HTTP p50/p95/p99/max | KNN p50/p95/max | embed p50/p95/max | DB loop p50/p95/max | DB ops |
|---|---|---|---|---|---|---|---|---|---|
| 1 | js-scan | 452–467 | 796 | 558 | 0.50/23.5/78.8/525 | 11.0/19.0/58 | 44.5/106/182 | 1.71/8.0/521 | 431 452 |
| 2 | sqlite-vec | 391–442 | 719 | 426 | **28.7/2 061/3 814/4 591** | 28.6/65.8/104 | 145/339/4 288 | 7.8/53/4 407 | 177 940 |
| 3 | sqlite-vec | 434–439 | 873 | 552 | 0.47/15.1/29.3/99 | 17.9/21.9/28.5 | 29/55.8/70.7 | 0.84/2.8/85 | 428 596 |
| 4 | js-scan | 463–469 | 750 | 555 | 0.48/15.0/52.3/94 | 10.6/11.8/18.9 | 52.5/80.3/104 | 0.60/2.4/23 | 436 548 |

All `OOMKilled=false ExitCode=0`; CPU 15–30 % of one core; shipped limits: raw `256Mi/512Mi` (`deployment.yaml:37,40`), Helm `512Mi/1Gi` (`values.yaml:152,155`).

### 3.9 Migration (migration-dryrun)

| source → target | rows | notes |
|---|---|---|
| `conversation_messages` → `memory_raw` + `memory_blob` | 61/61 | 34 user / 27 assistant; 49 distinct contents; 0 rows `general-general`; 9 → `eyas-system`/`eyas` |
| `agent_events.LlmResponse` → `memory_raw assistant_message` | 9/9 | join via `agent_sessions`; 3/9 byte-duplicates of parent-conversation messages; `CriticVerdict` 9 rows not migrated |
| `episodic_memories` / `archive_memories` | 0 / 0 | path implemented, **unexercised** |
| vault `*.md` → `memory_raw document` + gist + tags + gist_source | 266/266 · 266 · 1 324 · 266 | 264 `reference`, 1 `user`, 1 `feedback`; 0 without frontmatter; `project`/`projectType` on 0/266 |
| `memory_note_links` → `memory_link(derived_from)` | 2/2 | matched to a capture run in the same second |
| `memory_capture_runs` → `memory_run(extraction)` | 15/15 | ok 12 · skipped 2 · failed 1 |
| totals | raw 336 · blob 336 (321 distinct hashes) · gist 266 · tag 1 324 · link 338 · run 16 | ≈ 1.42 MB new pages; DB 335 695 872 → 337 346 560 B |
| wall-clock | host 66 ms run 1 / 37 ms run 2 · pod 472 ms / 78 ms | blobs 935 066 B → 503 604 B (0.539) |

Timestamp zoo: ISO `Z` with ms (`conversation_messages`), INTEGER ms (`agent_events.ts`), `datetime('now')` 19-char UTC (`memory_capture_runs`, `memory_note_links`; naive parse +7 200 000 ms on this host), quoted date only (vault `created`), `${size}-${mtimeMs}` (`vault_index.file_hash`).

---

## 4. Surprises and open items

### 4.1 Surprises (cross-cutting, ranked by consequence)

1. **The spec's storage-engine premise is wrong on Linux.** "Bun's bundled SQLite cannot load `sqlite-vec`" is true only for Apple's SQLite on a dev Mac. On every Linux image Bun loads extensions natively; `setCustomSQLite()` returns `true` and changes nothing; `connection.ts`'s probe is dead code whose flag (`extensionLoadingEnabled`) reflects `existsSync` of a library that is never used (and exists on slim only as an incidental dependency of `liblastlog2-2`). (sqlite-ext-docker)
2. **`better-sqlite3` under Bun is impossible, not merely unpackaged** — Bun refuses the addon at `require()` time. And its presence in `dependencies` breaks the Docker build today (`bun install` exit 1). (sqlite-ext-docker)
3. **`oven/bun:1` drifted to Bun 1.4.0** with a different bundled SQLite (3.53.2) and a different claimed Node ABI (147); spikes unknowingly ran on 1.3.10, 1.3.14 and 1.4.0. The FTS5 planner behaviour for shape C flips between SQLite 3.51 and 3.53, i.e. **between Bun versions**, not between distros. (sqlite-ext-docker, fts-knn-shapes; §4.2)
4. **Float vectors miss the 50 ms budget at 200 k on the host as well as the pod**; on the pod int8 raw KNN is no faster than float (76.5/80.0 vs 77.1/80.0) — sqlite-vec 0.1.9's int8 path shows no SIMD gain there. Filtering, not quantisation, is what keeps the budget. (fts-knn-shapes)
5. **vec0 `PARTITION KEY` is a 50–100× win** (0.3–1.3 ms p95 at 200 k on the pod) at +8 % file size, but `IN (…)` over partitions returns k rows *per partition* and a bare outer `LIMIT` is rejected — a `MATERIALIZED` CTE is required. (fts-knn-shapes)
6. **The natural FTS5 filter is pathological**: `rowid IN (subquery)` inside MATCH re-runs the MATCH per candidate (~2 200×, 0.5 s); only `+rowid IN (…)` is safe on both SQLite versions we ship. (fts-knn-shapes)
7. **Over-fetch-then-filter is wrong on both axes** (4–8× slower, recall 2–30 %) at the spec's 0.3–2 % selectivities. (fts-knn-shapes)
8. **The JS int8 scan beats sqlite-vec for an unfiltered 40 k scan on the main thread** (p95 11.8 vs 21.9 ms) — sqlite-vec 0.1.x KNN is itself a full scan over chunked shadow blobs plus marshalling. Its value is filtered KNN and persistence, not raw latency. (combined-rss, fts-knn-shapes)
9. **sqlite-vec int8 binding trap**: a 384-byte blob is a valid `float32[96]`, so both INSERT and MATCH must wrap the parameter in `vec_int8(?)`; the current `vec-store.ts` (`float[dim]`, JSON-literal `vec_f32`) has neither the type nor the binding the design needs. (combined-rss, fts-knn-shapes, repo check)
10. **The multilingual tokenizer, not the model, is the memory cost**: ~250 MB RSS from a 17 MB `tokenizer.json` (XLM-R 250 k vocab, dequantised/parsed into JS heap), shared by every multilingual candidate including e5-small; q4 variants are *larger* than q8. Spec's "~25–120 MB model" is off by ~4× in RSS. (combined-rss, embedder)
11. **ORT oversubscribes the CPU quota**: default thread pool = visible CPUs (4 in the Docker VM; a whole node on K8s) → throughput halves in a 2-vCPU cgroup unless `intraOpNumThreads` is pinned. (embedder)
12. **Bun hosts `onnxruntime-node` natively** — no Node sidecar/worker is needed for the embedder; the cost is that the image must be glibc (same constraint as sqlite-vec). Bun's RSS is ~140 MB higher than Node's for the same model. (embedder)
13. **Naive RRF hurts** by 20 R@5 points on the paraphrase-heavy hu/de set; prefix-5 stemming triples FTS5's Hungarian recall for free. (embedder)
14. **Chunk transactions do not stall readers — WAL auto-checkpoint does.** With the 1000-page default on a bulk-writing connection while the main thread reads continuously, every commit re-runs a PASSIVE checkpoint that cannot reset the WAL; sweeps take 5× longer and readers see multi-second max stalls. Chunk 10 000 is the fastest and the 1 ms yield is irrelevant. (zstd-worker)
15. **Local Node 23.7.0 has no zstd** — the WASM tier of the shim is a real path, not theory; `fzstd` cannot compress. Bun and Node produce byte-identical zstd frames today (libzstd 1.5.7) — convenient, not a contract. (zstd-worker)
16. **grok headless reads the Claude/Obsidian memory vault** (it learned the path from the globally-loaded `~/.claude/Claude.md`) and its kill-switches leave a 15 k-token floor plus live shell and plugin-MCP tools; `--max-turns 1` is not "one answer". (provider-matrix)
17. **The claude-code provider runs the SDK-bundled CLI (2.1.89), not the installed `claude` (2.1.259)**, and the CLI default model for an isolated call is `claude-opus-4-6[1m]` — the most expensive rung, silently, on CLI-only installs. (provider-matrix)
18. **`vault_index.file_hash` is not a hash** (`${size}-${mtimeMs}`); background `LlmResponse` outputs are double-stored (3/9 identical to a parent-conversation message); `agent_events.actor` is NULL on every row; `memory_capture_runs` timestamps are zone-less UTC; the imported `reference` summaries are ~160-char truncated strings, some starting with `# title`. (migration-dryrun)
19. **Spec-internal contradiction**: §5 keys `memory_blob` on `(content_hash, shred_partition_id)` while Phase 1 acceptance says "two conversations → one blob". The dry-run produced 336 blobs for 321 hashes. (migration-dryrun)
20. **`process.memoryUsage().rss` under-reports what the pod is charged**: DB open moved RSS +9 MB and cgroup +175 MB; kubelet enforces the cgroup. The shipped 512Mi limit is below the measured 551–558 MiB. (combined-rss)
21. **macOS Docker bind mounts are unusable for SQLite benchmarks** (virtiofs fsync); an fsync-per-commit loop (`synchronous=FULL`) is the likely cause of the one anomalous combined-rss run. (zstd-worker, combined-rss)

### 4.2 Cross-report reconciliations (done during the merge)

- **Which SQLite the "pod" ran.** fts-knn-shapes labelled its pod SQLite "Debian libsqlite3 3.53.0" and combined-rss "libsqlite3-0 (SQLite 3.53.2)". Debian 13's `libsqlite3-0` is **3.46.1-7+deb13u1**; re-run in `oven/bun:1.3` (`$SPIKES/report/log/01-bun-1.3-image-sqlite-version.txt`): Bun 1.3.14 bundled `sqlite_version()` = **3.53.0**, `setCustomSQLite(/usr/lib/aarch64-linux-gnu/libsqlite3.so.0)` → `true`, version **unchanged**. So both pod runs used Bun's bundled SQLite (3.53.0 / 3.53.2), consistent with sqlite-ext-docker's no-op finding. Consequence: production SQLite version = Bun version; the planner-dependent FTS shape C changes with a Bun upgrade; the Bun tag pin (§2 #3) is load-bearing for query-plan stability, not just for reproducibility.
- **sqlite-vec vs JS scan.** fts-knn-shapes ("partition key is the real answer") and combined-rss ("make the JS scan the default") do not conflict once split by shape: unfiltered ≤ 40 k → JS faster (11.8 vs 21.9 ms p95); filtered at 200 k → vec0 partition key 0.3–1.3 ms, and the JS scan was **not** measured above 40 k. Fixed as §2 #5: vec0 primary where it loads, JS fallback, both in the worker.
- **Embedder RSS spread.** embedder measured e5-small alone at 421/519 MB (Node) and 562–580/722–744 MB (Bun 1.3.10, no forced GC); combined-rss measured the *whole* process (DB + vectors + paraphrase-L12 + HTTP) at 437–469 MB after `Bun.gc(true)` on Bun 1.4.0. Same tokenizer, same order of magnitude; the spread is GC state + Bun version. Budget 0.6 GB RSS / 1.2 GB cgroup covers both.
- **Docker version.** Two reports say Docker 29.2.1, one 28.1.1; the host client is `28.1.1-rd` (`log/00-*`); the engine version was not re-checked. Immaterial to any number.
- **Container-hygiene incident.** combined-rss's cleanup (`docker rm -f $(docker ps -aq --filter name=eyas-spike)`) killed the running `eyas-spike-fts-knn-shapes` container at ~16:57; fts-knn-shapes' first full pod run (`log/08-bench-docker.txt`) ended silently and it re-ran the sections (`log/09`, `log/10`, EXIT=0). All fts-knn pod numbers above are from the complete re-runs; the "silent exit" UNRESOLVED note in that report is most likely this incident, not a Bun/SQLite fault.

### 4.3 Open / UNRESOLVED items

| # | Item | Status | What closes it |
|---|---|---|---|
| 1 | Periodic worker-owned checkpoint (`wal_autocheckpoint=0` + PASSIVE every ~50 chunks) | **untested** (only "off + end" measured: 20.6 s, WAL 5.6 GB) | first measurement of Phase 4; assert WAL < 256 MB and max reader stall |
| 2 | combined-rss run 2 stall (HTTP p95 2.06 s, CPU 0 %, all subsystems frozen together) | **UNRESOLVED**, not reproduced in runs 3–4 | re-run with PSI sampling and `synchronous=NORMAL`; suspected Docker Desktop disk I/O after an image rebuild |
| 3 | x86_64 numbers | **not measured** natively (amd64 only under emulation: 68.5 ms float insert, 6.13 ms KNN — inflated) | one run of combined-rss + fts-knn on a native amd64 box before freezing limits; `onnxruntime-node` amd64 is a different binary (`avx512_vnni` ONNX variant exists) |
| 4 | kimi-cli isolation | **UNTESTED** (binary not installed) | spike on a machine with `kimi`; until then classed with grok-cli |
| 5 | Compat providers' inherited `embed()` (xai, openrouter, kimi-API) | **unverified** (no paid call) | one probe call per host, or gate behind a catalog `embeddings: true` |
| 6 | `episodic_memories` / `archive_memories` migration path | **unexercised** (0 rows on this instance) | seed fixture rows in the Phase 1 migration test |
| 7 | Alpine on amd64; `better-sqlite3` under real Node 22 on the images | not tested | out of scope unless Alpine is reconsidered |
| 8 | sqlite-vec int8 raw KNN = float on the pod (no SIMD benefit) | observed, cause not investigated | irrelevant with partition filtering; revisit if sqlite-vec ≥ 0.2 changes the int8 path |
| 9 | grok `-p` isolation switches | **exhausted** — no "load nothing" mode found among 26 disallowed tools, 7 env vars, system-prompt override | treat as a vendor limitation; do not spend more time |
| 10 | Stop-word removal for the FTS channel | not tried | Phase 2 lexical-gate fixture (`dataset.mjs`) |
| 11 | `synchronous=NORMAL` on the memory DB connection | recommended, **not measured** in the combined run (used `synchronous=2`=FULL) | include in the Phase 1 connection PRAGMAs; re-run combined-rss once |
| 12 | Spike Docker images left on the machine (~7.5 GB: `eyas-spike-*`, `oven/bun:1`, `oven/bun:1.3`, `oven/bun:1.3.10`, `node:22-bookworm-slim`) and `fts-knn-shapes/data` (~2.2 GB) | present, no containers running | `docker rmi $(docker images -q 'eyas-spike-*')`; delete `data/` (regenerable with `build.ts`) — owner's call |

---

## 5. Spike scripts that become Phase 1 (and later) repo tests

All source paths are under `$SPIKES`; target paths are proposals in the repo's `tests/` layout (Vitest) — nothing has been copied into the repo.

| Spike file(s) | Proposed repo path | What it asserts | Phase |
|---|---|---|---|
| `sqlite-ext-docker/ctx/probe-bun.ts` | `tests/core/db/sqlite-capabilities.test.ts` | `sqlite_version()`, `ENABLE_FTS5` compile option, `bm25()` works; `loadExtension(sqlite-vec)` → `vec_version() = v0.1.9`; vec0 `float[384]` and `int8[384]` 1000-row insert + KNN k=10 (nearest = self, distance 0); FTS5 still works after vec load. Runs on macOS only with Homebrew SQLite (skip otherwise); becomes the `eyas doctor` self-test | 1 |
| `sqlite-ext-docker/ctx/Dockerfile.slim` (`test` target) + `ctx/run-all.sh` | `.github/workflows/image-capabilities.yml` (CI job) | builds the runtime image and runs the probe inside it on arm64 + amd64; fails on `no such module: vec0` | 1 |
| `sqlite-ext-docker/ctx/repo-install/` + `log/repo-bun-install-ovenbun1.log` | CI job "Dockerfile builds" | `docker build` of the committed `Dockerfile` succeeds (today exit 1) | 1 (prerequisite) |
| `fts-knn-shapes/shapes.sql`, `bench.ts`, `common.ts`, `build.ts` | `tests/modules/memory/query-shapes.test.ts` (50 k fixture, seed 1234) | row identity: temp-table == `rowid IN` == partition-key == metadata for every (project); D1 `MATERIALIZED` CTE returns 50 rows; FTS shapes A/B/C/E return identical rowids; **latency guards**: `+rowid` FTS filter < 50 ms, partition-key KNN < 10 ms, and the naive `rowid IN`-inside-MATCH shape is asserted *slow* (> 100 ms) so a planner change that makes it fast is noticed rather than silently relied on; over-fetch recall < 50 % documented as the reason it is banned | 1 (shapes), 2 (wired to `memory_embedding_vec`) |
| `fts-knn-shapes/cte-check.ts` | same file | `IN (0,?)` on a partition key + outer `LIMIT` errors without `MATERIALIZED`, works with it | 1 |
| `fts-knn-shapes/bench.ts` at 200 k | `scripts/bench/memory-knn-200k.ts` (nightly, not in the unit suite) | p95 < 50 ms at 200 k int8 filtered on the reference pod | 2 |
| `fts-knn-shapes/bench.ts` section (5) | `tests/modules/memory/js-int8-scan.test.ts` | contiguous `Int8Array` top-50 over 40 k rows; result identical to vec0 KNN on the same fixture; p95 < 25 ms | 2 |
| `embedder/dataset.mjs` | `tests/modules/memory/fixtures/recall-hu-de-en.ts` | 80 labelled pairs + 300 distractors — the Phase 2 "Hungarian fixtures for the lexical-upweight rule" | 2 |
| `embedder/recall.mjs`, `fts-variants.mjs` | `tests/modules/memory/embedder-recall.test.ts` (model cached; skipped if `data/models/` empty) | e5-small R@5 ≥ 0.80 overall and ≥ 0.85 hu; prefix-5 FTS hu R@5 ≥ 0.55; **regression guard: fused retrieval R@5 ≥ dense-alone R@5 − 0.02** (naive RRF would fail at 0.65) | 2 |
| `embedder/bench.mjs` | `scripts/bench/embedder.ts` + `eyas doctor` output | cold start, sent/s with pinned threads, RSS; backend must be `OnnxruntimeSessionHandler` (native), never WASM | 2 |
| `zstd-worker/zstd-shim.ts` | `src/shared/zstd.ts` (runtime-detected 3-tier shim; erasable TS, runs under `node --experimental-strip-types`) | — | 1 |
| `zstd-worker/zstd-shim.test.ts` | `tests/shared/zstd-shim.test.ts` (both `bun test` and `node --test`) | round-trip on every available tier; WASM ↔ native interchange; forced-tier selection; loud failure on a Node without zstd and without the WASM package | 1 |
| `zstd-worker/bench-zstd.ts` + `corpus2/` | `scripts/bench/zstd-ratio.ts` | ratio ≥ 2.5 at L3 on repo-text corpus | 1 (informational) |
| `zstd-worker/sweep-main.ts`, `sweep-worker.ts`, `run-matrix2.sh` | `tests/modules/memory/light-pass-worker.test.ts` (100 k rows in unit suite) + `scripts/bench/light-pass-1m.sh` (nightly, 1 M rows) | worker opens its own WAL connection; 0 `SQLITE_BUSY`; rows touched == N; reader p99 during sweep ≤ 2× idle; **max reader stall < 100 ms with worker-owned checkpointing**; WAL frames < 256 MB during the sweep | 4 |
| `provider-matrix/run-claude-isolated.ts`, `fixture-conversation.txt`, `prompt.txt` | `tests/modules/model/providers/claude-code-isolated.test.ts` (skipped without CLI auth; run in a nightly lane) | `init.tools == []`, `mcp_servers == []`, `host_context_seen == []`, canary `false`, input tokens ≤ prompt tokens + 10 %, strict JSON | 1 |
| `provider-matrix/parse-grok-ndjson.ts` + `log/grok-run-4.ndjson` | `tests/modules/memory/capture/provider-eligibility.test.ts` | `eligible()` predicate: claude-code/API → true; grok-cli/kimi-cli → false even with `supportsHeadlessInvocation` hypothetically set; rung (d) never selected for `run_type != 'interactive'` | 1 |
| `migration-dryrun/migrate-dryrun.ts` | seed for `src/modules/memory/migration/legacy-migrate.ts` | — | 1 |
| `migration-dryrun/verify.ts`, `fm-profile.ts` | `tests/modules/memory/migration.test.ts` (on a fixture DB built from the counts in §3.9 + seeded `episodic`/`archive` rows) | counts per source; 20 hash spot-checks; `occurred_at` fidelity; ULID timestamp == `occurred_at`; **run twice → identical data counts, +1 migration run row**; `local_parse_trap`: `datetime('now')` text parses to UTC (delta 0, not 7 200 000 ms); `LlmResponse` duplicate of parent message skipped; vault hash == SHA-256 of file bytes | 1 |
| `combined-rss/app/spike.ts`, `run.sh`, `loadgen.ts` | `scripts/bench/combined-rss.sh` (nightly on the pod-representative image) | `OOMKilled=false`; process RSS ≤ 600 MB; cgroup peak ≤ 1.2 GB; HTTP p95 ≤ 50 ms at 20 rps with KNN + embedding in the worker | 2/4 |
| `combined-rss/app/model-breakdown.ts` | `eyas doctor` footprint estimate | prints expected RSS per `EYAS_MEMORY_EMBEDDER` mode | 2 |

---

## 6. Changes the spec needs (exact section, old → new)

| § | Old (as written) | New (evidence-backed) |
|---|---|---|
| §4 layer table, L0 "Expected size" | "~0.1–2 GB" | Size on **~2.7× compression** of message text (measured 2.663 @L3 on repo text; the 5× figure is a synthetic-corpus artefact). |
| §4 last paragraph | "Every vault file is ingested into L0 as a `document` occurrence (partition `vault:<path>`, hash = `vault_index.file_hash`)" | "…hash = **SHA-256 of the file bytes computed at ingestion**; `vault_index.file_hash` is a `${size}-${mtimeMs}` change detector (`vault-service.ts:70`), not a hash, and is not reused (its blindness to same-size/same-mtime edits is recorded as debt)." |
| §5 `memory_blob` + §15 Phase 1 acceptance | `memory_blob (content_hash, shred_partition_id) PK` **vs** "two identical messages in two conversations → two raw rows, one blob" | Keep the composite key (consistent with per-conversation DEKs, §11) and rewrite the acceptance: "two identical messages in two conversations → **two raw rows, two blobs, one `content_hash`**; within one conversation → two raw rows, one blob, `ref_count = 2`." |
| §5 `memory_embedding` | "id, owner_type, owner_id, model_id, vector (int8 blob), live_in_index" | Add: "`memory_embedding_vec` = `CREATE VIRTUAL TABLE … USING vec0(project_id INTEGER PARTITION KEY, embedding int8[384])` (global = 0), rebuildable from `memory_embedding.vector`; **all three of vec0 rowid, `memory_raw_fts` rowid and `memory_tag.memory_id` share one INTEGER surrogate key**; ULIDs are the sync identity only. Parameters bound with `vec_int8(?)` on INSERT and MATCH. Float vectors are not stored anywhere." |
| §5 `memory_raw` | (no attachments column) | Add `meta_json` (attachments ULIDs, agent session id/seq/usage for background outputs) or `memory_link(raw → document, 'part_of')` rows; 5 live messages carry attachments today. Add `source_type` note: `CriticVerdict` is **not** captured/migrated (or gains its own `source_type`). |
| §5 `memory_run` | "…model_calls_used, tokens_in, tokens_out, stats_json" | Add `cost_usd`, `duration_api_ms`, `provider_version` (SDK-bundled CLI version for claude-code, 2.1.89 today). |
| §5 timestamps (new sentence) | — | "`occurred_at`, `created_at`, `hlc_physical_ms` are INTEGER epoch ms. Legacy sources are normalised at the boundary: ISO `Z` text; INTEGER ms (`agent_events.ts`); `datetime('now')` `YYYY-MM-DD HH:MM:SS` **as UTC** (`memory_capture_runs`, `memory_note_links`); vault `created` date → midnight UTC." |
| §6 Flush contract | "Compression shim: `Bun.zstdCompressSync` → `node:zlib` zstd (Node ≥ 22.15) → a WASM/JS fallback; byte-compatible round-trip on both runtimes is a Phase 0 deliverable (both native paths verified present on Bun 1.3.10 and Node zlib)." | "Compression shim (verified): `Bun.zstdCompressSync` → `node:zlib` zstd (**Node ≥ 22.15.0; Node 23.0–23.7 have none — the shim fails loudly, never silently**) → **`@bokuweb/zstd-wasm`** (MIT, compress + decompress; `fzstd` is decompress-only and excluded). **Level 3.** Frames are byte-identical across Bun 1.3.10 and Node 22.23 today (both libzstd 1.5.7); identity is the SHA-256 of the *uncompressed* bytes, never of the frame." |
| §6 Model pass | "A background call requires a provider that is **both** `supportsIsolatedCompletion` **and** `supportsHeadlessInvocation` (new flag): claude-code's SDK path and API providers qualify; grok-cli/kimi-cli (ACP) do not" | "`eligible(p) := p.supportsHeadlessInvocation === true && (p.supportsIsolatedCompletion === true \|\| !isCliProviderId(p.id))`. `supportsHeadlessInvocation` is added in **Phase 1** (absent from `src/` today), `true` on every API provider and claude-code, absent on grok-cli and kimi-cli: `grok -p` is headless but injects ≥ 15 k tokens of host context and keeps `run_terminal_command` + plugin MCP tools under every documented switch, and it read the Obsidian ai-memory vault in the Phase 0 canary. The ladder's `gateway-fallback` rung (d) is **not used for background work**. Cost is recorded per run (`total_cost_usd`, `duration_api_ms`); on a CLI-only install the isolated path runs on the CLI default (`claude-opus-4-6[1m]`, ≈ $0.015 / 8 s per 20-line batch); the SDK-bundled CLI version, not the system `claude`, is what runs." |
| §7 Candidate generation | "FTS5 `bm25()` top-50 ∪ filtered KNN top-50 (candidate ids restricted by `memory_tag` to the D1 set …), fused by Reciprocal Rank Fusion (`k=60` …). For `language=tlh` the lexical channel is up-weighted" | "FTS5 `bm25()` top-50 with the D1/task filter written as **`+rowid IN (SELECT memory_id FROM memory_tag …)`** (the unary plus is mandatory: the plain form re-runs the MATCH per candidate, 0.5 s at 300 k) ∪ KNN top-50 over `memory_embedding_vec` as a **`MATERIALIZED` CTE with `project_id IN (0, <project>, <project_type>) AND k = 50`, outer `ORDER BY distance LIMIT 50`** (vec0 returns k per partition), with `rowid IN (…)` from `memory_tag` as the secondary filter inside the same query; both in one statement (26–40 ms p50 on the pod at 200 k/300 k with the `rowid IN` KNN; ≈ FTS cost with the partition CTE). **Over-fetch-then-filter is banned** (recall 2–30 %). Fusion is **gated, not naive RRF**: query tokens prefix-stemmed to 5 chars + `*`, stop-words and tokens < 3 chars dropped, lexical weight ≤ 0.3 or a bm25 hit admitted only with ≥ 2 distinct query stems, dense list primary — naive RRF costs 20 R@5 points on the hu/de fixture. `tlh` keeps the lexical up-weight." |
| §8 Light pass | "chunked into ~1 500–2 000-row transactions so no write lock is held more than a few ms" | "chunked into **5 000–10 000-row** transactions (reader p50/p95/p99 are unaffected by chunk size; 10 000 finishes 10⁶ rows in ~20 s on 2 vCPU vs > 100 s at 500–2 000); yield `setImmediate` per chunk; `busy_timeout 5000`; `synchronous=NORMAL`; **the worker owns WAL checkpointing during a sweep**: `PRAGMA wal_autocheckpoint=0` on its connection, `wal_checkpoint(PASSIVE)` every ~50 chunks (~100 MB WAL), `TRUNCATE` at the end — the default auto-checkpoint on a bulk writer with a continuously reading main thread is the sole source of the 0.6–2.6 s reader stalls measured." |
| §13 bullet 1 (storage engine) | "The real gap is extension loading: Bun's bundled SQLite cannot load `sqlite-vec`; `connection.ts` probes system `libsqlite3` and calls `setCustomSQLite()`, otherwise `vec-store.ts` silently no-ops. Resolution: (a) the Docker/K8s images ship `libsqlite3` and `eyas doctor` reports FTS5/vec0 availability instead of silently degrading; (b) **sqlite-vec is an optimisation, not load-bearing**: at the enforced 40 000-row live set a pure-JS int8 dot-product scan … low tens of ms — the documented fallback when no extension can load. `better-sqlite3` stays the Node fallback only." | "**Bun's Linux builds load extensions natively**; `setCustomSQLite()` is a **macOS-only** workaround (Apple's SQLite refuses `loadExtension`; Homebrew's works) and is a silent no-op on Linux — `connection.ts` restricts the probe to `darwin`, guards it once per process, and replaces `isSqliteExtensionLoadingAvailable()` (no callers) with a live self-test (`vec_version()`, 1-row `int8` insert, KNN) surfaced by `eyas doctor`. (a) The runtime image stays **`oven/bun:<pinned 1.3.10>-slim` (glibc)**; `libsqlite3` in the image is irrelevant to Bun; **musl is unsupported** unless `vec0.so` is compiled from the amalgamation at build time; the `Dockerfile` installs with `--ignore-scripts` (or `better-sqlite3` moves to `optionalDependencies`) because its install script fails under Bun and breaks the build today. (b) **sqlite-vec is load-bearing for filtered KNN and vector persistence** (vec0 `PARTITION KEY` = 0.3–1.3 ms p95 at 200 k on the pod; `rowid IN` = 16–29 ms; float = over budget), **not for raw speed**: the pure-JS int8 scan is the fallback for macOS-without-Homebrew and musl and is measured at 11–12 ms p95 for 40 k rows (faster than sqlite-vec for an unfiltered scan). Both engines run in the light-pass worker, never on the request thread. `better-sqlite3` is **Node-only and cannot load under Bun at all** (hard-blocked at `require()`, oven-sh/bun#4290)." |
| §13 bullet 2 (embeddings) | "bundle `@huggingface/transformers` + a quantised sentence-transformer model (Apache-2.0) … a ~25–120 MB embedding model on CPU … the candidates are multilingual (`paraphrase-multilingual-MiniLM-L12-v2`, `multilingual-e5-small`), sized and licensed in the spike." | "bundle `@huggingface/transformers` 4.2 (Apache-2.0; pulls `onnxruntime-node` MIT) + **`multilingual-e5-small`** from **`intfloat/multilingual-e5-small` (MIT)** as q8 ONNX, 384-d, with mandatory `query: `/`passage: ` prefixes (`model_id = multilingual-e5-small@q8/e5-prefix`) — R@5 85 % vs 60 % for paraphrase-MiniLM-L12 and 22.5 % for FTS5 on the hu/de/en fixture. **~136 MB on disk, ~0.5 GB RSS** (the XLM-R tokenizer alone ≈ 250 MB), cold start 0.7–1.3 s on 2 vCPU, ~65 sentences/s at 128 tokens with `intraOpNumThreads` pinned to the CPU quota (the ORT default halves throughput in a cgroup). **Bun hosts it natively** (`onnxruntime-node` loads under Bun 1.3.10 on glibc; no Node sidecar); it lives in the light-pass worker, lazy-loaded, disposed after idle. `all-MiniLM-L6-v2` (24 MB, 150–240 MB RSS) is the documented English-only downgrade. Do not ship weights from an unlabelled `Xenova/*` mirror." |
| §13 bullet 3 (compression) | "runtime-detected zstd shim (both native paths exist on Bun 1.3.10 / Node ≥ 22.15)" | as §6 above (three tiers, `@bokuweb/zstd-wasm`, Node 23.0–23.7 caveat, level 3, ~30 µs/msg at 2 vCPU). |
| §13 bullet 5 (worker) | "Bun `Worker` / Node `worker_threads`, own WAL connection — Phase 0 spike." | "…**verified** (0 `SQLITE_BUSY` over 10⁶ rows, reader p99 unchanged); the worker also hosts the embedder and both KNN engines and owns WAL checkpointing (§8)." |
| §13 bullet 6 (raw SQL) | "the contentless-FTS and filtered-KNN shapes are written as tests in Phase 0" | "…written and validated: `$SPIKES/fts-knn-shapes/shapes.sql` (USE / DO NOT USE annotated) becomes `tests/modules/memory/query-shapes.test.ts` (§5 of the spike report)." |
| §14 table, `agent_events` row | "`memory_raw` `assistant_message` for background runs (join to the conversation [unverified column]); `CriticVerdict` → `derived`" | "join **`agent_events.session_id = agent_sessions.id → agent_sessions.conversation_id`** (the managed child conversation; the user-visible parent is `conversations.parent_conversation_id`); **skip an `LlmResponse` whose content hash already exists as an `assistant_message` in the parent conversation** (3/9 today) — and at capture time hook only one of the two writers; `actor` = `agent_sessions.agent_id` (`agent_events.actor` is NULL on every row); `CriticVerdict` **not migrated**." |
| §14 table, vault row | "hash = `file_hash`" | "hash = SHA-256 of the file bytes at migration; gist text = `summary` with a leading `# heading` stripped, or the first body paragraph (imported `reference` summaries are ~160-char truncations); `source:x` → `source_type` tag, `import-job:x` → `changelog_json`, `imported` → dropped (not `topic`)." |
| §14 table, `memory_note_links` / `memory_capture_runs` rows | "matched to capture runs by conversation + time" / "status mapping (skips → `skipped`)" | "matched by same `conversation_id` **and same second** (observed delta 0 s), ±60 s fallback, after UTC normalisation" / "`skipped_reason='error'` → **`failed`**; `unparsable`/`too-short` → `skipped`". |
| §14 Principles | "`eyas memory migrate --undo` drops only the new tables and `migrated_from` links" | Add: "every raw row gets a `memory_link(raw → <legacy table>, <pk>, 'migrated_from')`; the migration writes its own `memory_run(run_type='migration')` with counts in `stats_json` and is **idempotent by construction** (`INSERT OR IGNORE` on deterministic ids, blob `ref_count` bumped only on `changes()==1`; 78 ms to re-run under pod limits) — no 'already migrated' flag." |
| §15 Phase 0 | "(a) … with `libsqlite3` present …; Deliverable: spike report; owner decisions §16-1 and §16-2 taken." | "Done 2026-09-03 — see `$SPIKES/SPIKE-REPORT.md`: (a) PARTIAL (glibc PASS, musl FAIL, JS-scan PASS), (b) FAIL (Bun hard-blocks better-sqlite3; Dockerfile build broken), (c) PASS with mandated shapes, (d) PASS/PARTIAL (e5-small; 0.5 GB RSS), (e) PASS, (f) PASS with max-stall caveat, (g) claude-code PASS / grok FAIL / kimi UNTESTED, (h) PASS budget / FAIL shipped k8s limits, (i) PASS with corrections." |
| §15 Phase 1 | "All `memory_*` tables incl. empty R6 tables; …" | Add: "`supportsHeadlessInvocation` on `AIProvider` + `eligible()` predicate; `Dockerfile` install fix and Bun tag pin; `connection.ts` probe restricted to darwin + capability self-test in `eyas doctor`; `src/shared/zstd.ts` shim with its dual-runtime test; k8s memory `1Gi/2Gi` in raw and Helm manifests." Acceptance: fix the blob sentence (see §5 row above); add "migration re-run is a no-op; `datetime('now')` timestamps land at UTC". |
| §15 Phase 2 acceptance | "Hungarian and Klingon fixtures for the lexical-upweight rule" | "…using the 80-pair / 300-distractor hu/de/en fixture (`dataset.mjs`): e5-small R@5 ≥ 0.80 (hu ≥ 0.85); fused R@5 ≥ dense-alone − 0.02; JS-scan and vec0 results identical on the same fixture; KNN and tokenization execute in the worker (HTTP p99 ≤ 50 ms at 20 rps)." |
| §15 Phase 4 acceptance | "light pass never blocks requests more than a few ms at 10⁶ rows" | "light pass: reader p99 unchanged **and max reader stall < 100 ms** at 10⁶ rows on the reference pod, WAL < 256 MB throughout, with worker-owned periodic checkpointing (the untested variant from Phase 0 is Phase 4's first measurement)." |
| §16-1 | "Keep `bun:sqlite` — the stack rule stands, FTS5 is proven, sqlite-vec is not load-bearing" / consequence "`better-sqlite3` would touch `connection.ts` for every module …" | "Keep `bun:sqlite` — **the alternative does not exist under Bun** (hard block); sqlite-vec loads natively on the glibc image and is load-bearing for filtered KNN; JS scan is the fallback." / consequence: "`better-sqlite3` is Node-only; its install script must not run in the Bun image." |
| §16-2 | "Bundle, model chosen by the Phase 0 Hungarian/German recall spike" / consequence "…confirm this reading" | "Bundle **`multilingual-e5-small`** (MIT), ~136 MB disk / ~0.5 GB RSS; the memory limit rises to 2Gi to hold it (§16-15)." |
| §16 new rows | — | **§16-15** K8s `requests 1Gi / limits 2Gi`, CPU `500m / 2`, `512Mi/1Gi` only as the bridge-embeddings profile (`docker stats` peak 551–558 MiB > today's 512Mi limit). **§16-16** Pin the Bun image tag/digest (`oven/bun:1` = 1.4.0 today; SQLite version and the FTS planner follow the Bun version). **§16-17** Background model cost on CLI-only installs: accept the CLI default model (~$0.015/batch) or allow an owner-set alias for the isolated path. |
| §17 risk "Extension loading varies by image" | "`eyas doctor` reports FTS5/vec0; JS-scan fallback; images ship `libsqlite3`" | "`eyas doctor` runs the vec0 self-test (not just `vec_version()`); JS-scan fallback; **glibc image pinned to the project's Bun**; musl unsupported; `libsqlite3` irrelevant on Linux." |
| §17 new rows | — | "**Bun tag drift** (1.4.0: SQLite 3.53.2, Node ABI 147) — pin + CI capability job." · "**WAL checkpoint starvation** under a bulk writer — worker-owned checkpointing + WAL-size assertion." · "**K8s memory limit below the embedder's footprint** — 1Gi/2Gi defaults; bridge profile documented." · "**grok-cli reaches host memory (incl. the Obsidian vault) in headless mode** — never eligible for background work; UI disclosure." · "**ORT thread oversubscription in cgroups** — pin `intraOpNumThreads`." · "**sqlite-vec int8 binding trap** — `vec_int8(?)` everywhere; self-test covers insert + KNN." |
| `deploy/k8s/deployment.yaml:36-40` | `cpu: 200m / memory: 256Mi` requests, `cpu: 500m / memory: 512Mi` limits | `cpu: 500m / memory: 1Gi` requests, `cpu: "2" / memory: 2Gi` limits |
| `deploy/k8s/helm/eyas/values.yaml:150-155` | `500m / 512Mi` requests, `"1" / 1Gi` limits | `500m / 1Gi` requests, `"2" / 2Gi` limits |

---

## 7. Method and artifacts of this merge

**Method.** Read spec §1–§17 (`sed -n` over the spec file); read all seven `REPORT.md` files as delivered; verified the repo facts the spikes cite with read-only `grep`/`sed` (`Dockerfile` `FROM` lines, k8s/Helm resource blocks, `package.json` sqlite deps and the absence of `trustedDependencies`, `connection.ts` probe, `isSqliteExtensionLoadingAvailable` callers = 0, `supportsHeadlessInvocation` = 0 hits, `vec-store.ts` `float[dim]` + JSON literal) → `$SPIKES/report/log/00-repo-verification.txt`; ran one reconciliation container (`docker run --rm --cpus=2 --memory=3g oven/bun:1.3 …`) to settle the SQLite-version attribution → `$SPIKES/report/log/01-bun-1.3-image-sqlite-version.txt`. No file under `the repository` was created, edited or deleted; no container was left running.

**Artifacts.**
- This report: `$SPIKES/SPIKE-REPORT.md` (copy at `$SPIKES/report/REPORT.md`); merge logs `$SPIKES/report/log/00-repo-verification.txt`, `$SPIKES/report/log/01-bun-1.3-image-sqlite-version.txt`.
- Per-spike reports and raw logs: `$SPIKES/sqlite-ext-docker/{REPORT.md,ctx/,log/}`, `$SPIKES/fts-knn-shapes/{REPORT.md,shapes.sql,bench.ts,common.ts,build.ts,cte-check.ts,log/,data/}`, `$SPIKES/embedder/{REPORT.md,bench.mjs,recall.mjs,fts-variants.mjs,dataset.mjs,docker/,models/,log/}`, `$SPIKES/zstd-worker/{REPORT.md,zstd-shim.ts,zstd-shim.test.ts,bench-zstd.ts,sweep-main.ts,sweep-worker.ts,run-matrix*.sh,corpus2/,log/}`, `$SPIKES/provider-matrix/{REPORT.md,run-claude-isolated.ts,parse-grok-ndjson.ts,fixture-conversation.txt,prompt.txt,log/}`, `$SPIKES/combined-rss/{REPORT.md,app/,run.sh,loadgen.ts,log/}`, `$SPIKES/migration-dryrun/{REPORT.md,migrate-dryrun.ts,verify.ts,fm-profile.ts,orig/,work/,docker-work/,log/}`.
- Docker images left on the machine (no containers running): `eyas-spike-combined-rss` 1.22 GB, `eyas-spike-fts-knn-shapes` 376 MB, `eyas-spike-embedder-{bun,node}` 846 MB / 1.17 GB, 13 × `eyas-spike-sqlite-ext-docker:*` 131–378 MB, plus pulled `oven/bun:{1,1.3,1.3.10}`, `node:22-bookworm-slim`.
