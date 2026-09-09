# Ops Remediation Execution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the EYAS `ops` module's proposal-apply path real and honest — execute read-only kubectl directly, open real PRs for GitOps mutations behind human approval, mount the routes — replacing every fake-success stub.

**Architecture:** A `PrProvider` abstraction (Gitea + GitHub, native fetch) opens real PRs; a gated `kubectl-executor` (Bun.spawn, no shell, allow-listed) runs read-only diagnostics; `reconcile-loop.apply()` is rewired to both and to the security-gate autonomy approval queue; `createOpsRoutes` is mounted in `onStart`.

**Tech Stack:** Bun, Hono, Drizzle over bun:sqlite, CASL, Zod, Vitest, jsdiff (`diff`, patch application).

## Global Constraints

- Runtime Bun; TypeScript strict, ESM. English code/comments.
- New deps MUST be MIT-compatible (MIT/BSD/ISC/Apache-2.0). `diff` (jsdiff) is BSD-3 — OK.
- Secrets NEVER hardcoded/logged; read via `ctx.secrets.get(key, 'system')`.
- Read named DB columns via `db.all(sql\`…\`)[0]`, never `db.get` with a raw SELECT.
- No fake success: an `apply()` branch returns `ok:true` ONLY if it performed the action.
- No real cluster call or real PR in any test (mock spawn / mock fetch).
- Do NOT change version numbers. **No git commit/push without an explicit user request** — each
  "Checkpoint" step means *stage and stop for review*; commit only when the user asks.
- Full suite (`bun vitest run`) + typecheck (`bun run lint`) must be green at each phase end.

---

## Phase 1 — PrProvider (shared building block)

### Task 1: `diff` dependency
**Files:** Modify: `package.json` (dependencies)

- [ ] **Step 1: Add dep**
```bash
bun add diff@^8.0.2 && bun add -d @types/diff@^8.0.0
```
- [ ] **Step 2: Verify license is MIT-compatible**
Run: `node -e "console.log(require('./node_modules/diff/package.json').license)"`
Expected: `BSD-3-Clause`
- [ ] **Step 3: Checkpoint** — `git add package.json bun.lock` (stage only).

### Task 2: PrProvider interface + Gitea + GitHub
**Files:**
- Create: `src/modules/ops/actions/pr-provider.ts`
- Test: `tests/modules/ops/pr-provider.test.ts`

**Interfaces — Produces:**
```ts
export interface OpenPrInput { filePath: string; content: string; title: string; body: string; branch: string }
export interface PrProvider {
  getFileContent(filePath: string): Promise<string | null>
  openPullRequest(input: OpenPrInput): Promise<{ prUrl: string; number: number }>
}
export function createGiteaPrProvider(cfg: { baseUrl: string; owner: string; repo: string; baseBranch: string; token: string }): PrProvider
export function createGitHubPrProvider(cfg: { baseUrl?: string; owner: string; repo: string; baseBranch: string; token: string }): PrProvider
```

- [ ] **Step 1: Write failing tests** (`tests/modules/ops/pr-provider.test.ts`)
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createGiteaPrProvider, createGitHubPrProvider } from '@modules/ops/actions/pr-provider'

function mockFetchSequence(responses: Array<{ status?: number; json?: any; text?: string }>) {
  const calls: Array<{ url: string; init?: any }> = []
  let i = 0
  vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
    calls.push({ url: String(url), init })
    const r = responses[Math.min(i++, responses.length - 1)]
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200,
      json: async () => r.json ?? {}, text: async () => r.text ?? '' } as any
  }))
  return calls
}
afterEach(() => vi.unstubAllGlobals())

describe('Gitea PrProvider', () => {
  const cfg = { baseUrl: 'https://gitea.internal', owner: 'infra', repo: 'gitops', baseBranch: 'main', token: 't0k' }

  it('getFileContent returns decoded content or null on 404', async () => {
    mockFetchSequence([{ status: 200, json: { content: Buffer.from('hello').toString('base64') } }])
    const p = createGiteaPrProvider(cfg)
    expect(await p.getFileContent('app.yaml')).toBe('hello')
    mockFetchSequence([{ status: 404 }])
    expect(await createGiteaPrProvider(cfg).getFileContent('missing.yaml')).toBeNull()
  })

  it('openPullRequest creates branch + file + PR and returns the url/number', async () => {
    const calls = mockFetchSequence([
      { status: 200, json: { commit: { sha: 'base-sha' } } }, // resolve base branch
      { status: 201, json: {} },                               // create branch
      { status: 200, json: { content: { sha: 'file-sha' } } }, // get existing file sha (may 404 → create)
      { status: 200, json: {} },                               // put file
      { status: 201, json: { html_url: 'https://gitea.internal/infra/gitops/pulls/7', number: 7 } }, // PR
    ])
    const res = await createGiteaPrProvider(cfg).openPullRequest({
      filePath: 'app.yaml', content: 'new: value', title: 'fix', body: 'why', branch: 'ops/fix-1',
    })
    expect(res).toEqual({ prUrl: 'https://gitea.internal/infra/gitops/pulls/7', number: 7 })
    expect(calls.some(c => c.init?.headers?.Authorization === 'token t0k')).toBe(true)
  })
})

describe('GitHub PrProvider', () => {
  it('uses Bearer auth and returns html_url/number', async () => {
    const calls = mockFetchSequence([
      { status: 200, json: { object: { sha: 'base-sha' } } }, // GET ref
      { status: 201, json: {} },                               // create ref
      { status: 404 },                                         // GET contents (new file)
      { status: 201, json: {} },                               // PUT contents
      { status: 201, json: { html_url: 'https://github.com/o/r/pull/9', number: 9 } },
    ])
    const res = await createGitHubPrProvider({ owner: 'o', repo: 'r', baseBranch: 'main', token: 'gh' })
      .openPullRequest({ filePath: 'k.yaml', content: 'x: 1', title: 't', body: 'b', branch: 'ops/x' })
    expect(res).toEqual({ prUrl: 'https://github.com/o/r/pull/9', number: 9 })
    expect(calls.some(c => c.init?.headers?.Authorization === 'Bearer gh')).toBe(true)
  })
})
```
- [ ] **Step 2: Run — expect FAIL** (`bun vitest run tests/modules/ops/pr-provider.test.ts` → module not found).
- [ ] **Step 3: Implement** (`src/modules/ops/actions/pr-provider.ts`)
```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface OpenPrInput { filePath: string; content: string; title: string; body: string; branch: string }
export interface PrProvider {
  getFileContent(filePath: string): Promise<string | null>
  openPullRequest(input: OpenPrInput): Promise<{ prUrl: string; number: number }>
}

async function jsonOrThrow(res: any, ctx: string): Promise<any> {
  if (!res.ok) throw new Error(`${ctx}: ${res.status} ${await res.text().catch(() => '')}`.trim())
  return res.json()
}

// ── Gitea (token <t>, header "Authorization: token <t>") ──
export function createGiteaPrProvider(cfg: { baseUrl: string; owner: string; repo: string; baseBranch: string; token: string }): PrProvider {
  const base = cfg.baseUrl.replace(/\/$/, '')
  const api = `${base}/api/v1/repos/${cfg.owner}/${cfg.repo}`
  const h = { Authorization: `token ${cfg.token}`, 'Content-Type': 'application/json' }
  return {
    async getFileContent(filePath) {
      const res = await fetch(`${api}/contents/${encodeURIComponent(filePath)}?ref=${cfg.baseBranch}`, { headers: h })
      if (res.status === 404) return null
      const data = await jsonOrThrow(res, 'gitea getFileContent')
      return data.content ? Buffer.from(data.content, 'base64').toString('utf8') : null
    },
    async openPullRequest(input) {
      const br = await jsonOrThrow(await fetch(`${api}/branches/${cfg.baseBranch}`, { headers: h }), 'gitea baseBranch')
      const baseSha = br.commit?.id ?? br.commit?.sha
      await jsonOrThrow(await fetch(`${api}/branches`, { method: 'POST', headers: h,
        body: JSON.stringify({ new_branch_name: input.branch, old_branch_name: cfg.baseBranch }) }), 'gitea createBranch')
      // existing sha (needed for update; 404 → create)
      let sha: string | undefined
      const cur = await fetch(`${api}/contents/${encodeURIComponent(input.filePath)}?ref=${input.branch}`, { headers: h })
      if (cur.ok) sha = (await cur.json()).sha
      await jsonOrThrow(await fetch(`${api}/contents/${encodeURIComponent(input.filePath)}`, { method: 'PUT', headers: h,
        body: JSON.stringify({ branch: input.branch, message: input.title, content: Buffer.from(input.content).toString('base64'), sha }) }), 'gitea putFile')
      const pr = await jsonOrThrow(await fetch(`${api}/pulls`, { method: 'POST', headers: h,
        body: JSON.stringify({ head: input.branch, base: cfg.baseBranch, title: input.title, body: input.body }) }), 'gitea createPr')
      return { prUrl: pr.html_url, number: pr.number }
    },
  }
}

// ── GitHub (header "Authorization: Bearer <t>") ──
export function createGitHubPrProvider(cfg: { baseUrl?: string; owner: string; repo: string; baseBranch: string; token: string }): PrProvider {
  const base = (cfg.baseUrl ?? 'https://api.github.com').replace(/\/$/, '')
  const api = `${base}/repos/${cfg.owner}/${cfg.repo}`
  const h = { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }
  return {
    async getFileContent(filePath) {
      const res = await fetch(`${api}/contents/${encodeURIComponent(filePath)}?ref=${cfg.baseBranch}`, { headers: h })
      if (res.status === 404) return null
      const data = await jsonOrThrow(res, 'github getFileContent')
      return data.content ? Buffer.from(data.content, 'base64').toString('utf8') : null
    },
    async openPullRequest(input) {
      const ref = await jsonOrThrow(await fetch(`${api}/git/ref/heads/${cfg.baseBranch}`, { headers: h }), 'github baseRef')
      const baseSha = ref.object?.sha
      await jsonOrThrow(await fetch(`${api}/git/refs`, { method: 'POST', headers: h,
        body: JSON.stringify({ ref: `refs/heads/${input.branch}`, sha: baseSha }) }), 'github createRef')
      let sha: string | undefined
      const cur = await fetch(`${api}/contents/${encodeURIComponent(input.filePath)}?ref=${input.branch}`, { headers: h })
      if (cur.ok) sha = (await cur.json()).sha
      await jsonOrThrow(await fetch(`${api}/contents/${encodeURIComponent(input.filePath)}`, { method: 'PUT', headers: h,
        body: JSON.stringify({ branch: input.branch, message: input.title, content: Buffer.from(input.content).toString('base64'), sha }) }), 'github putFile')
      const pr = await jsonOrThrow(await fetch(`${api}/pulls`, { method: 'POST', headers: h,
        body: JSON.stringify({ head: input.branch, base: cfg.baseBranch, title: input.title, body: input.body }) }), 'github createPr')
      return { prUrl: pr.html_url, number: pr.number }
    },
  }
}
```
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Checkpoint** — stage `pr-provider.ts` + test.

### Task 3: PrProvider factory from config/secrets
**Files:**
- Modify: `src/modules/ops/actions/pr-provider.ts` (append)
- Test: extend `tests/modules/ops/pr-provider.test.ts`

**Interfaces — Produces:**
```ts
export interface OpsPrConfig { provider: 'gitea' | 'github' | null; baseUrl?: string | null; owner?: string | null; repo?: string | null; baseBranch?: string }
export async function createPrProviderFromConfig(cfg: OpsPrConfig, getToken: () => Promise<string | null>): Promise<PrProvider | null>
```
- [ ] **Step 1: Write failing test**
```ts
import { createPrProviderFromConfig } from '@modules/ops/actions/pr-provider'
it('returns null when provider is unset or token missing', async () => {
  expect(await createPrProviderFromConfig({ provider: null }, async () => 'x')).toBeNull()
  expect(await createPrProviderFromConfig({ provider: 'gitea', baseUrl: 'https://g', owner: 'o', repo: 'r' }, async () => null)).toBeNull()
})
it('builds a gitea provider when configured + token present', async () => {
  const p = await createPrProviderFromConfig({ provider: 'gitea', baseUrl: 'https://g', owner: 'o', repo: 'r', baseBranch: 'main' }, async () => 'tok')
  expect(p).not.toBeNull()
})
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement (append to pr-provider.ts)**
```ts
export interface OpsPrConfig { provider: 'gitea' | 'github' | null; baseUrl?: string | null; owner?: string | null; repo?: string | null; baseBranch?: string }
export async function createPrProviderFromConfig(cfg: OpsPrConfig, getToken: () => Promise<string | null>): Promise<PrProvider | null> {
  if (!cfg.provider || !cfg.owner || !cfg.repo) return null
  const token = await getToken()
  if (!token) return null
  const baseBranch = cfg.baseBranch ?? 'main'
  if (cfg.provider === 'gitea') {
    if (!cfg.baseUrl) return null
    return createGiteaPrProvider({ baseUrl: cfg.baseUrl, owner: cfg.owner, repo: cfg.repo, baseBranch, token })
  }
  return createGitHubPrProvider({ baseUrl: cfg.baseUrl ?? undefined, owner: cfg.owner, repo: cfg.repo, baseBranch, token })
}
```
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Full suite + typecheck; Checkpoint.** `bun vitest run && bun run lint`.

---

## Phase 2 — kubectl-executor

### Task 4: kubectl-executor (gated, no-shell, allow-listed)
**Files:**
- Create: `src/modules/ops/actions/kubectl-executor.ts`
- Modify: `src/modules/ops/actions/kubectl-generator.ts:96` — also `export { sanitizeArg }`
- Test: `tests/modules/ops/kubectl-executor.test.ts`

**Interfaces — Consumes:** `ALLOWED_KUBECTL_COMMANDS`, `sanitizeArg` from `./kubectl-generator.js`.
**Produces:**
```ts
export interface KubectlExecResult { ok: boolean; output?: string; error?: string; durationMs: number }
export interface KubectlExecutor { exec(command: string, args: string[]): Promise<KubectlExecResult> }
export function createKubectlExecutor(cfg: { enabled: boolean; kubeconfigPath?: string | null; binary?: string; spawn?: SpawnFn; timeoutMs?: number }): KubectlExecutor
```
- [ ] **Step 1: Export sanitizeArg** — change `kubectl-generator.ts:96` from
`export { ALLOWED_KUBECTL_COMMANDS }` to `export { ALLOWED_KUBECTL_COMMANDS, sanitizeArg }`.
- [ ] **Step 2: Write failing tests**
```ts
import { describe, it, expect } from 'vitest'
import { createKubectlExecutor } from '@modules/ops/actions/kubectl-executor'

// Fake spawn: returns a process-like object with exitCode + piped streams.
function fakeSpawn(out: string, code = 0, err = '') {
  return (_argv: string[]) => ({
    exited: Promise.resolve(code),
    get exitCode() { return code },
    stdout: new Response(out).body, stderr: new Response(err).body,
    kill() {},
  }) as any
}

it('returns honest error when disabled', async () => {
  const ex = createKubectlExecutor({ enabled: false, spawn: fakeSpawn('') })
  const r = await ex.exec('get', ['pods'])
  expect(r.ok).toBe(false); expect(r.error).toMatch(/disabled/i)
})
it('rejects a command not on the read-only allow-list', async () => {
  const ex = createKubectlExecutor({ enabled: true, spawn: fakeSpawn('') })
  const r = await ex.exec('delete', ['pod', 'x'])
  expect(r.ok).toBe(false); expect(r.error).toMatch(/not allowed/i)
})
it('rejects an unsafe argument', async () => {
  const ex = createKubectlExecutor({ enabled: true, spawn: fakeSpawn('') })
  const r = await ex.exec('get', ['pods;rm -rf /'])
  expect(r.ok).toBe(false); expect(r.error).toMatch(/argument/i)
})
it('runs an allow-listed command and returns stdout', async () => {
  const ex = createKubectlExecutor({ enabled: true, spawn: fakeSpawn('pod/a Running') })
  const r = await ex.exec('get', ['pods', '-n', 'default'])
  expect(r.ok).toBe(true); expect(r.output).toContain('pod/a Running')
})
it('maps a non-zero exit to an honest error', async () => {
  const ex = createKubectlExecutor({ enabled: true, spawn: fakeSpawn('', 1, 'boom') })
  const r = await ex.exec('get', ['pods'])
  expect(r.ok).toBe(false); expect(r.error).toContain('boom')
})
```
- [ ] **Step 3: Run — expect FAIL.**
- [ ] **Step 4: Implement** (`kubectl-executor.ts`)
```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { ALLOWED_KUBECTL_COMMANDS, sanitizeArg } from './kubectl-generator.js'

export interface KubectlExecResult { ok: boolean; output?: string; error?: string; durationMs: number }
export interface KubectlExecutor { exec(command: string, args: string[]): Promise<KubectlExecResult> }
export type SpawnFn = (argv: string[], opts: { env?: Record<string, string> }) => {
  exited: Promise<number>; exitCode: number | null; stdout: ReadableStream | null; stderr: ReadableStream | null; kill: () => void
}

async function drain(s: ReadableStream | null): Promise<string> {
  if (!s) return ''
  return await new Response(s).text()
}

export function createKubectlExecutor(cfg: {
  enabled: boolean; kubeconfigPath?: string | null; binary?: string; spawn?: SpawnFn; timeoutMs?: number
}): KubectlExecutor {
  const binary = cfg.binary ?? 'kubectl'
  const timeoutMs = cfg.timeoutMs ?? 15_000
  const spawn: SpawnFn = cfg.spawn ?? ((argv, opts) => (Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...(opts.env ?? {}) } }) as any))
  return {
    async exec(command, args) {
      const started = Date.now()
      if (!cfg.enabled) return { ok: false, error: 'kubectl execution disabled', durationMs: 0 }
      if (!ALLOWED_KUBECTL_COMMANDS.has(command)) return { ok: false, error: `command '${command}' not allowed`, durationMs: 0 }
      const safe: string[] = []
      for (const a of args) { const s = sanitizeArg(a); if (s === null) return { ok: false, error: `argument '${a}' rejected`, durationMs: 0 }; safe.push(s) }
      const env = cfg.kubeconfigPath ? { KUBECONFIG: cfg.kubeconfigPath } : {}
      try {
        const proc = spawn([binary, command, ...safe], { env })
        const timer = setTimeout(() => proc.kill(), timeoutMs)
        const [code, out, err] = await Promise.all([proc.exited, drain(proc.stdout), drain(proc.stderr)])
        clearTimeout(timer)
        const durationMs = Date.now() - started
        if (code !== 0) return { ok: false, error: (err || `exit ${code}`).trim(), durationMs }
        return { ok: true, output: out.slice(0, 64_000), durationMs }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - started }
      }
    },
  }
}
```
- [ ] **Step 5: Run — expect PASS.**
- [ ] **Step 6: Full suite + typecheck; Checkpoint.**

---

## Phase 3 — apply() rewrite + honesty

### Task 5: inject executor + provider; rewire kubectl/gitops-pr
**Files:**
- Modify: `src/modules/ops/reconcile-loop.ts` — `ReconcileLoopDeps` (:31), the `apply()` body (~:319), imports (:14 drop `openPullRequest`); add diff resolution.
- Modify: `src/modules/ops/index.ts` — `OpsFactoryDeps` (:22) + `createOpsServices` (:34) to pass `kubectlExecutor`, `prProvider` through.
- Test: `tests/modules/ops/reconcile-apply.test.ts`

**Interfaces — Consumes:** `KubectlExecutor` (Task 4), `PrProvider` (Task 2).
**Produces:** `ReconcileLoopDeps` gains `kubectlExecutor?: KubectlExecutor` and `prProvider?: PrProvider`; `OpsFactoryDeps` gains the same two optional fields.

- [ ] **Step 1: Write failing tests** (`tests/modules/ops/reconcile-apply.test.ts`)
```ts
import { describe, it, expect } from 'vitest'
import { createOpsServices } from '@modules/ops'
import { createMemoryDb } from '../../helpers/test-db'
import { createOpsTables } from '@modules/ops'
// (helper to insert a runbook-less incident + a proposal directly — see repo's existing
// ops tests for the row-insert helper; reuse it. Assert on apply() results.)

function fakeExecutor(res: any) { return { exec: async () => res } }
function fakePrProvider() {
  return { getFileContent: async () => 'old: 1\n', openPullRequest: async () => ({ prUrl: 'https://x/pr/1', number: 1 }) }
}

it('kubectl apply maps the executor result (no fake success)', async () => {
  // Arrange a kubectl proposal (requiresApproval:false), then:
  const db = createMemoryDb(); createOpsTables(db)
  const svc = createOpsServices({ db, kubectlExecutor: fakeExecutor({ ok: true, output: 'pods', durationMs: 5 }) })
  // insert incident+proposal (actionType 'kubectl', command 'get', args ['pods'], requiresApproval false, approvedAt set)
  // const r = await svc.loop.apply(proposalId)
  // expect(r.ok).toBe(true); expect(r.output).toContain('pods')
})

it('kubectl apply surfaces an honest executor error', async () => {
  const db = createMemoryDb(); createOpsTables(db)
  const svc = createOpsServices({ db, kubectlExecutor: fakeExecutor({ ok: false, error: 'disabled', durationMs: 0 }) })
  // const r = await svc.loop.apply(kubectlProposalId)
  // expect(r.ok).toBe(false); expect(r.error).toMatch(/disabled/)
})

it('gitops-pr apply opens a real PR via the provider', async () => {
  const db = createMemoryDb(); createOpsTables(db)
  const svc = createOpsServices({ db, prProvider: fakePrProvider() })
  // const r = await svc.loop.apply(approvedGitopsProposalId)
  // expect(r.ok).toBe(true); expect(r.prUrl).toBe('https://x/pr/1')
})

it('gitops-pr apply is honest when no provider configured', async () => {
  const db = createMemoryDb(); createOpsTables(db)
  const svc = createOpsServices({ db }) // no prProvider
  // const r = await svc.loop.apply(approvedGitopsProposalId)
  // expect(r.ok).toBe(false); expect(r.error).toMatch(/not configured/i)
})
```
> Implementer note: complete the arrange steps using the row-insert helper already used by the
> existing ops reconcile tests (grep `tests/modules/ops` for how incidents/proposals are seeded).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — `ReconcileLoopDeps` add:
```ts
  kubectlExecutor?: import('./actions/kubectl-executor.js').KubectlExecutor
  prProvider?: import('./actions/pr-provider.js').PrProvider
```
In `apply()` replace the `kubectl` and `gitops-pr` branches:
```ts
if (p.actionType === 'kubectl') {
  if (!deps.kubectlExecutor) { result = { proposalId: p.id, ok: false, durationMs: 0, error: 'kubectl executor not configured' } }
  else { const r = await deps.kubectlExecutor.exec(p.payload.command!, p.payload.args ?? [])
    result = { proposalId: p.id, ok: r.ok, durationMs: r.durationMs, output: r.output, error: r.error } }
} else if (p.actionType === 'gitops-pr') {
  if (!deps.prProvider) { result = { proposalId: p.id, ok: false, durationMs: 0, error: 'PR provider not configured' } }
  else {
    const provider = deps.prProvider
    const filePath = p.payload.filePath!
    const current = (await provider.getFileContent(filePath)) ?? ''
    const { applyPatch } = await import('diff')
    const patched = p.payload.patch ? applyPatch(current, p.payload.patch) : p.payload.patch
    if (patched === false || patched == null) { result = { proposalId: p.id, ok: false, durationMs: Date.now() - started, error: 'could not apply patch to current file content' } }
    else {
      const pr = await provider.openPullRequest({ filePath, content: patched, title: p.summary ?? `ops: ${p.id}`, body: p.reasoning ?? '', branch: `ops/${p.id}` })
      result = { proposalId: p.id, ok: true, durationMs: Date.now() - started, prUrl: pr.prUrl }
    }
  }
}
```
Drop the `openPullRequest` import (:14). In `index.ts`, add `kubectlExecutor?` and `prProvider?` to `OpsFactoryDeps` and pass them into `createReconcileLoop({ …, kubectlExecutor: deps.kubectlExecutor, prProvider: deps.prProvider })`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Delete the stub** — remove `openPullRequest` from `gitops-committer.ts` (keep `buildGitopsProposal`); update/adjust any test that referenced the stub URL.
- [ ] **Step 6: Full suite + typecheck; Checkpoint.**

---

## Phase 4 — Approval wiring

### Task 6: `getApproval(id)` on autonomy-policy
**Files:**
- Modify: `src/modules/security-gate/autonomy-policy.ts` (add method near `listApprovals`)
- Test: extend `tests/modules/security-gate/autonomy-policy.test.ts`

**Produces:** `autonomyPolicy.getApproval(id: number): ApprovalRecord | null`.
- [ ] **Step 1: Write failing test** — createApproval → getApproval returns the row with `status:'pending'`; unknown id → null.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement**
```ts
getApproval(id: number): ApprovalRecord | null {
  const rows = db.all(sql`SELECT * FROM autonomy_approvals WHERE id = ${id}`) as ApprovalRow[]
  return rows[0] ? rowToApproval(rows[0]) : null
},
```
- [ ] **Step 4: Run — expect PASS. Checkpoint.**

### Task 7: real ApprovalQueue adapter + ops_apply category
**Files:**
- Create: `src/modules/ops/actions/autonomy-approval-queue.ts`
- Modify: `src/modules/security-gate/autonomy-policy.ts` seedDefaults — add `ops_apply` category (maxLevel per convention; default requires approval)
- Test: `tests/modules/ops/autonomy-approval-queue.test.ts`

**Interfaces — Consumes:** `ApprovalQueue` (from `approval-bridge.ts`: `enqueue(proposal)→Promise<string>`, `status(id)→Promise<'approved'|'rejected'|'pending'>`), `autonomyPolicy` (Task 6).
**Produces:** `export function createAutonomyApprovalQueue(policy): ApprovalQueue`.
- [ ] **Step 1: Write failing test** — enqueue(proposal) creates an `ops_apply` approval and returns its id as string; status maps DB status; a rejected approval → `'rejected'`.
```ts
import { createAutonomyApprovalQueue } from '@modules/ops/actions/autonomy-approval-queue'
import { createAutonomyPolicy } from '@modules/security-gate/autonomy-policy'
// use createMemoryDb + createAutonomyTables; enqueue a fake proposal; assert createApproval row + status()
```
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement**
```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
import type { ApprovalQueue } from './approval-bridge.js'
import type { Proposal } from '../types.js'
export function createAutonomyApprovalQueue(policy: {
  createApproval(i: { category: string; toolName?: string; inputJson?: string; preview?: string; reason?: string }): number
  getApproval(id: number): { status: string } | null
}): ApprovalQueue {
  return {
    async enqueue(p: Proposal) {
      const id = policy.createApproval({ category: 'ops_apply', toolName: 'ops.apply',
        inputJson: JSON.stringify(p.payload), preview: p.summary, reason: p.reasoning })
      return String(id)
    },
    async status(queueId: string) {
      const rec = policy.getApproval(Number(queueId))
      const s = rec?.status
      return s === 'approved' || s === 'rejected' ? s : 'pending'
    },
  }
}
```
Add to `seedDefaults` INSERT-OR-IGNORE list: `('ops_apply', 1, 0, 1)` (key, level, locked, maxLevel — mirror the existing seed tuple shape; default level requires approval per Cap 7 semantics).
- [ ] **Step 4: Run — expect PASS. Checkpoint.**

### Task 8: gate gitops-pr apply behind approval
**Files:**
- Modify: `src/modules/ops/reconcile-loop.ts` `apply()` — enforce approval for `gitops-pr`.
- Test: extend `tests/modules/ops/reconcile-apply.test.ts`
- [ ] **Step 1: Write failing test** — a `gitops-pr` proposal with `requiresApproval:true` and no `approvedAt` → `apply()` returns `{ ok:false, error:/requires approval/ }` (already enforced by the existing guard at top of apply); with `approvedAt` set → opens PR. Confirm read-only kubectl proposals set `requiresApproval:false` so they auto-run.
- [ ] **Step 2: Run — expect PASS or FAIL** (the top-of-apply guard likely already covers this; if so this task just adds the regression test + ensures kubectl proposals are generated with `requiresApproval:false`).
- [ ] **Step 3:** In `buildKubectlProposal`, ensure `requiresApproval:false` (read-only); in `buildGitopsProposal`, ensure `requiresApproval:true`. Adjust if not already so.
- [ ] **Step 4: Run — expect PASS. Full suite + typecheck; Checkpoint.**

---

## Phase 5 — Route mount + config

### Task 9: `ops` config schema
**Files:**
- Modify: `src/core/config/schema.ts` (add `ops` block)
- Test: extend the config schema test (grep `tests` for the config-schema test file)

**Produces:** `config.ops = { kubectl: { enabled: boolean; kubeconfigPath: string|null; binary: string }, pr: { provider: 'gitea'|'github'|null; baseUrl: string|null; owner: string|null; repo: string|null; baseBranch: string } }`.
- [ ] **Step 1: Write failing test** — default config yields `ops.kubectl.enabled === false` and `ops.pr.provider === null`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement (Zod)**
```ts
ops: z.object({
  kubectl: z.object({
    enabled: z.boolean().default(false),
    kubeconfigPath: z.string().nullable().default(null),
    binary: z.string().default('kubectl'),
  }).default({}),
  pr: z.object({
    provider: z.enum(['gitea', 'github']).nullable().default(null),
    baseUrl: z.string().nullable().default(null),
    owner: z.string().nullable().default(null),
    repo: z.string().nullable().default(null),
    baseBranch: z.string().default('main'),
  }).default({}),
}).default({}),
```
- [ ] **Step 4: Run — expect PASS. Checkpoint.**

### Task 10: wire executor + provider + approval queue in `onStart`; mount routes
**Files:**
- Modify: `src/modules/ops/index.ts` `onStart` (:133) — build executor, provider, approval queue; pass to `createOpsServices`; call `createOpsRoutes`.
- Modify: `src/modules/ops/routes.ts` — confirm/adjust the `OpsRoutesDeps.auth` adapter shape (grep :30 for `OpsRoutesDeps`); provide an adapter bridging `c.get('userId')`/`role` + CASL to `auth.currentUser`/`auth.can`.
- Test: `tests/modules/ops/ops-routes.test.ts`

**Interfaces — Consumes:** `createOpsServices` (now takes `kubectlExecutor`, `prProvider`), `createAutonomyApprovalQueue` (Task 7), `createPrProviderFromConfig` (Task 3), `createKubectlExecutor` (Task 4).
- [ ] **Step 1: Write failing route test** — mount `createOpsRoutes` on a Hono app with a test auth adapter; assert `GET /api/v1/ops/incidents` returns 200 for an authorized user and 403 for one lacking `OpsIncident:read`; `POST /api/v1/ops/actions/:id/apply` requires `OpsAction:apply`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement onStart wiring**
```ts
const kubectlExecutor = createKubectlExecutor({
  enabled: ctx.config.ops.kubectl.enabled,
  kubeconfigPath: ctx.config.ops.kubectl.kubeconfigPath,
  binary: ctx.config.ops.kubectl.binary,
})
const prProvider = await createPrProviderFromConfig(ctx.config.ops.pr, () => ctx.secrets.get('ops-pr-token', 'system').then(v => (v as string) ?? null))
const gate = (ctx as any).securityGate
const approvalQueue = gate?.autonomyPolicy ? createAutonomyApprovalQueue(gate.autonomyPolicy) : createInMemoryApprovalQueue()
const services = createOpsServices({ db: ctx.db, runbooks, kubectlExecutor, prProvider: prProvider ?? undefined, approvalQueue })
createOpsRoutes(ctx.http, { loop: services.loop, runbooks: services.runbooks, auth: opsAuthAdapter(ctx), logger: ctx.logger })
```
(Add `approvalQueue?: ApprovalQueue` to `OpsFactoryDeps` and pass it through to `createReconcileLoop`, replacing the hardcoded `createInMemoryApprovalQueue()`; keep in-memory as the default when absent. Implement `opsAuthAdapter(ctx)` to match `OpsRoutesDeps.auth` — `currentUser(c) = c.get('userId')` and `can(user, action, subject)` via the permission registry/CASL ability, mirroring how `requirePermission` resolves ability.)
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Full suite + typecheck.** `bun vitest run && bun run lint` — all green.
- [ ] **Step 6: Checkpoint** — present the complete diff for review; commit only on explicit request.

---

## Self-Review Notes (author)
- Spec coverage: PrProvider (T2/T3) ✓, kubectl-executor (T4) ✓, apply rewrite+honesty (T5) ✓,
  approval wiring+ops_apply (T6/T7/T8) ✓, route mount (T10) ✓, config (T9) ✓, deployment note = docs only ✓.
- helm-upgrade stays honest "not apply-able yet" (untouched) — matches spec Out-of-Scope.
- Diff resolution pinned via jsdiff `applyPatch` against `getFileContent` (spec §4.3 open item resolved).
- Type consistency: `PrProvider`, `KubectlExecutor`, `ApprovalQueue`, `OpsFactoryDeps` fields named
  identically across tasks.
