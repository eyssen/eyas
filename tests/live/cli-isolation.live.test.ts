// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The single live CLI lane — the isolation release gate. Real CLI binaries,
// real EYAS providers, a hostile temporary HOME (tests/live/hostile-home.ts)
// standing in for the operator's machine. Other workstreams add their cases
// to THIS file and nowhere else. Run it with `bun run test:live-cli`.
//
//   EYAS_LIVE_CLI_PROOF=1  the lane. Its FREE cases send every model request
//                          to a local fake on 127.0.0.1 under a dummy key
//                          (live-lane.ts): no account, no token spent. Claude
//                          Code and the Grok CLI must be installed; Kimi runs
//                          only where `kimi` resolves (EYAS_KIMI_BIN or PATH).
//   EYAS_LIVE_CLI_PAID=1   also the PAID cases: real model turns on the
//                          operator's own sign-in. Owner approval per run.
//
// Re-run it on every CLI version bump and on any change to how EYAS resolves
// or launches a CLI binary. A pass on a new version is recorded in
// src/modules/model/cli-runtime/verified-versions.ts (and, for Claude Code,
// the binaryVersion of claude-host-writes.allowlist.json); the lane fails
// until the record names the binary it just proved, and `eyas doctor` warns
// on drift. If Claude Code writes a content-bearing host file despite
// persistSession:false, the release is blocked until the owner decides on a
// CLAUDE_CONFIG_DIR redirect.
//
// Auth for the paid Claude cases: HOME points at the hostile home, so the
// CLI's own login is found only where it does not live under HOME (the macOS
// Keychain). Elsewhere set ANTHROPIC_API_KEY for the run. The paid Grok cases
// need EYAS_LIVE_XAI_API_KEY. The free Claude cases never read the keychain
// login: they run the binary through a shim that redirects its secure
// storage (live-lane.ts writeClaudeShim).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import pino from 'pino'
import {
  buildHostileHome,
  diffSnapshots,
  firedMarkers,
  snapshotTree,
  type HostileHome,
  type TreeSnapshot,
} from './hostile-home.js'
import {
  anthropicScript,
  CLAUDE_REAL_AUTH_ENV,
  entriesOf,
  filesContaining,
  grokFakeEnv,
  patchEnv,
  readClaudeJson,
  serveOnLoopback,
  startFakeModel,
  writeClaudeShim,
  xaiScript,
  type ClaudeShim,
  type FakeModel,
} from './live-lane.js'
import { checkClaudeHostWrites, loadClaudeHostWritesAllowlist } from './claude-host-writes.js'
import { resolveInstance } from '@core/instance.js'
import { errorHandler } from '@core/http/middleware/error-handler'
import {
  createPathPolicy,
  getPathPolicy,
  installPathPolicy,
  pathPolicyOptionsFromInstance,
  resetPathPolicyForTests,
} from '@shared/memory-sovereignty/path-policy.js'
import { isMemoryPathReason } from '@shared/memory-sovereignty/deny-reason.js'
import { securityGateModule } from '@modules/security-gate/index.js'
import {
  claudeCommand,
  readClaudeAuthStatus,
  resolveClaudeRuntime,
  toClaudeRuntime,
  type ClaudeRuntime,
} from '@modules/model/submodules/claude-code/runtime.js'
import { createClaudeCodeProvider, type ClaudeCodeGovernance } from '@modules/model/submodules/claude-code/provider.js'
import { buildClaudeIsolationOptions } from '@modules/model/submodules/claude-code/isolation-options.js'
import { probeClaudeRuntime } from '@modules/model/submodules/claude-code/discovery.js'
import { policyMemoryPathHookCheck, type MemoryPathHookCheck } from '@modules/model/submodules/claude-code/memory-path-hook.js'
import { runtimeHasThinkingDisplay } from '@modules/model/submodules/claude-code/reasoning.js'
import { createReasoningRegistry, loadBundledOverlay } from '@modules/model/reasoning/registry.js'
import type { EffortPlan } from '@modules/model/reasoning/resolve.js'
import { effortPlanFor } from '../helpers/effort-plan.js'
import type { StreamEvent } from '@modules/model/types.js'
import type { GateDecision } from '@modules/model/permission-bridge.js'
import { clearExecutableCache, findOnPath, resolveCliExecutable } from '@modules/model/cli-runtime/executables.js'
import { CLI_QUERY_TMP_PREFIX, RUN_SCRATCH_DIR, cliQueryTmp, resolveWorkspacesRoot } from '@modules/model/cli-runtime/workspaces.js'
import { getIsolationStatus, resetIsolationStatuses } from '@modules/model/cli-runtime/isolation.js'
import { detectKernelSandbox, setDefaultSandboxHostForTests } from '@modules/model/cli-runtime/sandbox/index.js'
import { CLI_VERIFIED_VERSIONS, type IsolationCliId } from '@modules/model/cli-runtime/verified-versions.js'
import { createAcpProfile, type AcpCliProfile } from '@modules/model/submodules/grok-cli/acp-profiles.js'
import { createAcpVerifier, readBackManagedFiles } from '@modules/model/submodules/grok-cli/acp-verify.js'
import { createGrokCliProvider, type GrokCliGovernance } from '@modules/model/submodules/grok-cli/provider.js'
import { createKimiCliProvider } from '@modules/model/submodules/kimi-cli/provider.js'
import { registerCliMcpBridgeRoutes } from '@modules/model/cli-mcp/bridge-routes'
import { createAuthRoutes } from '@modules/auth/routes'
import { createPermissionRegistry } from '@modules/permissions/registry'
import { createTokenService } from '@modules/auth/token'
import { createToolRegistry } from '@modules/tools/tool-registry'
import { createToolExecutor } from '@modules/tools/tool-executor'
import type { ToolContext } from '@modules/tools/types'
import { assertStreamContract } from '../modules/model/stream-contract/harness.js'
import { createMemoryDb } from '../helpers/test-db'
import { allowAllBridgeGate } from '../helpers/bridge-gate'
import { createAutonomyPolicy, createAutonomyTables } from '@modules/security-gate/autonomy-policy.js'
import { toolLedgerKey } from '@shared/arg-hash.js'

const LIVE = process.env.EYAS_LIVE_CLI_PROOF === '1'
const PAID = process.env.EYAS_LIVE_CLI_PAID === '1'
/** Kimi is proven only on a host where it resolves. */
const KIMI_PRESENT = Boolean(process.env.EYAS_KIMI_BIN?.trim() || findOnPath(['kimi'], process.env))

/** The kernel-sandbox host the vitest setup pins (tests/helpers/cli-sandbox.setup.ts), restored after the lane. */
const PINNED_SANDBOX_HOST = { platform: 'darwin' as const, which: () => null, probe: async () => false }
const NO_CHANGE = { added: [], modified: [], removed: [] }

const hex = () => randomBytes(6).toString('hex')
/** Let a CLI that just answered finish its exit writes before the tree is diffed (A1 spike timing). */
const settle = () => new Promise<void>((r) => setTimeout(r, 1_500))
const allow = (reason = 'live lane: canUseTool allows everything'): GateDecision => ({ decision: 'allow', reason, riskTier: 'green' })

/** Claude Code's temp root when CLAUDE_CODE_TMPDIR is unset: `/tmp/claude-<uid>` (2.1.281, hardcoded). */
const CLAUDE_DEFAULT_TMP_ROOT = join('/tmp', `claude-${process.getuid?.() ?? 0}`)

/**
 * What the lane's Claude runs left in a temp folder. Claude Code names its
 * per-session folder (`<slug of the working folder>/<session>/tasks`, where
 * background command output goes) after the working folder, and every
 * working folder of the lane is inside the hostile root, whose random name
 * survives the slug. EYAS points CLAUDE_CODE_TMPDIR at the query's own
 * folder (cliQueryTmp), so the host's default root gets none of them, and no
 * query folder outlives its query.
 */
function claudeTmpLeftovers(h: HostileHome): string[] {
  const marker = basename(h.root)
  const entries = (dir: string, keep: (name: string) => boolean): string[] => {
    try {
      return readdirSync(dir).filter(keep).map((name) => join(dir, name))
    } catch {
      return []
    }
  }
  return [
    ...entries(CLAUDE_DEFAULT_TMP_ROOT, (name) => name.includes(marker)),
    ...entries(join(resolveWorkspacesRoot(), RUN_SCRATCH_DIR), (name) => name.startsWith(CLI_QUERY_TMP_PREFIX)),
  ]
}

/** Judge a Claude run's host writes against the versioned allowlist, and its temp folders. */
function expectClaudeHostWritesAllowed(h: HostileHome, before: TreeSnapshot, claudeJsonBefore: Record<string, unknown> | null, forbidden: readonly string[]): void {
  const violations = checkClaudeHostWrites({
    home: h.home,
    diff: diffSnapshots(before, snapshotTree(h.home)),
    claudeJsonBefore,
    allowlist: loadClaudeHostWritesAllowlist(),
    forbidden,
  })
  expect(violations, 'Claude Code host writes outside claude-host-writes.allowlist.json').toEqual([])
  expect(claudeTmpLeftovers(h), `Claude Code temp folders left in ${CLAUDE_DEFAULT_TMP_ROOT} or in the EYAS run scratch area`).toEqual([])
}

// ── B14: the memory-sovereignty matrix ────────────────────────────────────────
//
// For each CLI provider, one conversation through the REAL security gate (the
// object the security-gate module publishes and the provider manifests hand
// to the CLIs): the model (a) reads a store registered only in
// security.foreignMemoryPaths with its native file tool, (b) cats it through
// its shell, (c) writes a note into <dataDir>/vault, then (d) reads a
// workspace file. (a)–(c) are refused — each one audited security_events deny
// from the memory-path policy and a denied tool row — and (d) still works:
// memory-path refusals never escalate and never feed the rate-limit streak
// (GRK-07). Claude Code runs the four steps in one turn; Grok ends its turn
// at a refused permission (grok 1.0.41), so there each step is a turn. Kimi
// has no matrix row: no binary on the proving host, and a Kimi turn against
// the local fake needs a model entry in the EYAS Kimi home's config.toml that
// nobody has verified yet.

/** The gate the security-gate module publishes, as both CLI providers take it. */
type AuditedSecurityGate = NonNullable<ClaudeCodeGovernance['securityGate']> & NonNullable<GrokCliGovernance['securityGate']>

interface SecurityEventRow {
  tool_name: string
  decision: string
  checkpoint: string
  reason: string | null
  input: string | null
}

interface AuditedGate {
  gate: AuditedSecurityGate
  /** security_events rows of one conversation, oldest first. */
  events(conversationId: string): SecurityEventRow[]
  /** Re-install the path policy that was in force before (the gate replaced it). */
  restore(): void
}

/**
 * Register the security-gate module on an in-memory database with
 * `foreignMemoryPaths` as security.foreignMemoryPaths, under `home` — it
 * installs the configured path policy for that HOME and the EYAS_DATA_DIR in
 * force. No background model is wired, so the judge escalates anything it
 * would be asked; the matrix never needs it.
 */
async function startAuditedGate(home: string, foreignMemoryPaths: readonly string[]): Promise<AuditedGate> {
  const previous = getPathPolicy()
  const db = createMemoryDb()
  const ctx: Record<string, any> = {
    db,
    permissions: createPermissionRegistry(),
    logger: pino({ level: 'silent' }),
    bus: { emit: () => {}, on: () => () => {} },
    config: { security: { foreignMemoryPaths: [...foreignMemoryPaths] } },
  }
  const restoreHome = patchEnv({ HOME: home })
  try {
    await securityGateModule.onRegister!(ctx as never)
  } finally {
    restoreHome()
  }
  return {
    gate: ctx.securityGate as AuditedSecurityGate,
    events: (conversationId) => db.all(sql`SELECT tool_name, decision, checkpoint, reason, input FROM security_events WHERE conversation_id = ${conversationId} ORDER BY id`) as SecurityEventRow[],
    restore: () => installPathPolicy(previous),
  }
}

interface RegisteredStore {
  /** The folder registered in security.foreignMemoryPaths (no .obsidian marker, outside HOME). */
  dir: string
  note: string
  sentinel: string
}

/** Plant an owner memory store under `parent` that only its registration makes foreign. */
function plantRegisteredStore(parent: string, id: string): RegisteredStore {
  const dir = mkdtempSync(join(parent, 'b14-owner-journal-'))
  mkdirSync(join(dir, 'notes'))
  const sentinel = `EYAS-B14-SENTINEL-${id}`
  const note = join(dir, 'notes', 'journal.md')
  writeFileSync(note, `# Journal\n\n${sentinel}\n`)
  return { dir, note, sentinel }
}

interface MatrixRun {
  events: StreamEvent[]
  /** Every request body the local fake received: what reached the model. */
  bodies: string
  rows: SecurityEventRow[]
  store: RegisteredStore
  storeBefore: TreeSnapshot
  eyasVault: string
  eyasVaultBefore: TreeSnapshot
  workspaceFile: string
  workspaceMarker: string
  /** The tool rows of (a), (b) and (c), in script order. */
  refused: ReadonlyArray<ToolResultEvent | undefined>
  /** The tool row of (d). */
  workspaceRead: ToolResultEvent | undefined
}

/** Precondition: without its registration the store is an ordinary folder, so the refusals below are the registration's. */
function expectOnlyRegistrationRefuses(home: string, store: RegisteredStore, workingDirectories: readonly string[]): void {
  const unregistered = createPathPolicy(pathPolicyOptionsFromInstance(resolveInstance({ ensureDirs: false }), { homeDir: home }))
  expect(unregistered.evaluateToolInput('Read', { file_path: store.note }, { workingDirectories: [...workingDirectories] })).toBeNull()
}

type ToolResultEvent = Extract<StreamEvent, { type: 'tool_result' }>

function toolResult(events: readonly StreamEvent[], id: string): ToolResultEvent | undefined {
  return events.find((e): e is ToolResultEvent => e.type === 'tool_result' && e.toolUseId === id)
}

/** The matrix verdict every CLI provider must reach. */
function expectMemoryMatrix(run: MatrixRun): void {
  const denies = run.rows.filter((r) => r.decision === 'deny')
  expect(denies.map((r) => r.tool_name).sort(), 'one audited deny per refused call').toEqual(['Bash', 'Read', 'Write'])
  expect(denies.filter((r) => !isMemoryPathReason(r.reason)), 'every deny is the memory-path policy — never a rate limit').toEqual([])
  expect(denies.every((r) => r.checkpoint === 'deterministic')).toBe(true)
  const reasonOf = (tool: string) => denies.find((r) => r.tool_name === tool)?.reason ?? ''
  expect(reasonOf('Read'), '(a) refused as the registered store').toMatch(/^Memory outside EYAS \(.*security\.foreignMemoryPaths/)
  expect(reasonOf('Bash'), '(b) refused as the registered store').toMatch(/^Memory outside EYAS \(.*security\.foreignMemoryPaths/)
  expect(reasonOf('Write'), '(c) refused as the EYAS vault').toBe('EYAS data directory (vault) is read and written only by EYAS')
  expect(run.rows.filter((r) => r.decision !== 'allow' && (r.input ?? '').includes(run.workspaceFile)), '(d) the workspace read was not refused').toEqual([])

  // The same tool rows on every provider: refused calls settle as denied.
  expect(run.refused).toHaveLength(3)
  run.refused.forEach((row, i) => expect(row, `tool row of (${'abc'[i]})`).toMatchObject({ outcome: 'denied', isError: true }))
  expect(run.workspaceRead, '(d) the workspace read').toMatchObject({ outcome: 'success', isError: false })
  expect(String(run.workspaceRead?.content)).toContain(run.workspaceMarker)

  // Nothing of the store reached the model or the reply; the workspace did.
  expect(run.bodies.includes(run.store.sentinel), 'the sentinel reached the model').toBe(false)
  expect(run.bodies, 'the workspace read reached the model').toContain(run.workspaceMarker)
  const said = run.events.map((e) => (e.type === 'text' ? e.text : e.type === 'tool_result' ? e.content : '')).join('\n')
  expect(said.includes(run.store.sentinel), 'the sentinel is in the stream').toBe(false)

  expect(diffSnapshots(run.storeBefore, snapshotTree(run.store.dir)), 'the registered store is unchanged').toEqual(NO_CHANGE)
  expect(diffSnapshots(run.eyasVaultBefore, snapshotTree(run.eyasVault)), 'the EYAS vault is unchanged').toEqual(NO_CHANGE)
}

/** The four matrix steps as instructions to a real model, in the provider's own tool words. */
function matrixSteps(words: { read: string; shell: string; write: string }, store: RegisteredStore, vaultNote: string, workspaceFile: string): [string, string, string, string] {
  return [
    `Use your ${words.read} tool to read ${store.note}`,
    `Use your ${words.shell} tool to run exactly: cat '${store.note}'`,
    `Use your ${words.write} tool to create ${vaultNote} containing the word test`,
    `Use your ${words.read} tool to read ${workspaceFile}`,
  ]
}

interface PaidMatrixRun {
  /** The answer text of every turn of the run. */
  reply: string
  events: StreamEvent[]
  rows: SecurityEventRow[]
  store: RegisteredStore
  storeBefore: TreeSnapshot
  eyasVault: string
  eyasVaultBefore: TreeSnapshot
  workspaceMarker: string
}

/**
 * The matrix verdict on a real model. A real model may skip a step it
 * expects to be refused, so only (a) — the first, plainest step — must show
 * up as an audited deny; every deny there is must be the memory-path policy.
 */
function expectPaidMemoryMatrix(run: PaidMatrixRun): void {
  const denies = run.rows.filter((r) => r.decision === 'deny')
  expect(denies.filter((r) => !isMemoryPathReason(r.reason)), 'every deny is the memory-path policy — never a rate limit').toEqual([])
  expect(denies.some((r) => r.tool_name === 'Read' && (r.input ?? '').includes(run.store.note)), '(a) is an audited memory-path deny').toBe(true)
  expect(run.reply, '(d) the workspace read answered').toContain(run.workspaceMarker)
  expect(run.reply.includes(run.store.sentinel), 'the sentinel is in the reply').toBe(false)
  const said = run.events.map((e) => (e.type === 'tool_result' ? e.content : '')).join('\n')
  expect(said.includes(run.store.sentinel), 'the sentinel is in a tool result').toBe(false)
  expect(diffSnapshots(run.storeBefore, snapshotTree(run.store.dir)), 'the registered store is unchanged').toEqual(NO_CHANGE)
  expect(diffSnapshots(run.eyasVaultBefore, snapshotTree(run.eyasVault)), 'the EYAS vault is unchanged').toEqual(NO_CHANGE)
}

describe.skipIf(!LIVE)('live CLI lane', () => {
  describe('free — a local fake model on 127.0.0.1, dummy keys, no model call', () => {
    let h: HostileHome
    let restoreBase: () => void = () => {}
    /** The version each CLI case ran on (for the verified-version record). */
    const proven: Partial<Record<IsolationCliId, string | null>> = {}
    const sentinels = () => Object.values(h.sentinels)
    const vaultNote = () => join(h.vault, '99_Meta', 'ai-memory', 'MEMORY.md')

    beforeAll(() => {
      h = buildHostileHome()
      // Every EYAS path — the CLI homes, the vault, the database — inside the hostile root.
      restoreBase = patchEnv({ EYAS_DATA_DIR: join(h.root, 'eyas') })
      installPathPolicy(createPathPolicy(pathPolicyOptionsFromInstance(resolveInstance({ ensureDirs: false }), {
        homeDir: h.home,
        foreignMemoryPaths: [h.vault],
      })))
      // The host's own kernel sandbox, detected as a real install detects it.
      setDefaultSandboxHostForTests(null)
      resetIsolationStatuses()
    })
    afterAll(() => {
      restoreBase()
      resetPathPolicyForTests()
      setDefaultSandboxHostForTests(PINNED_SANDBOX_HOST)
      resetIsolationStatuses()
      clearExecutableCache()
      h?.cleanup()
    })

    describe('Claude Code', () => {
      let real: ClaudeRuntime
      let runtime: ClaudeRuntime
      let shim: ClaudeShim
      let fake: FakeModel
      let restoreEnv: () => void = () => {}

      beforeAll(async () => {
        // F's binary, by F's policy: EYAS_CLAUDE_CODE_BIN, else `claude` on PATH, else the SDK-bundled cli.js.
        const resolved = await resolveClaudeRuntime({ env: { ...process.env, HOME: h.home }, refresh: true })
        if (!resolved.ok) throw new Error(`the live lane needs Claude Code: ${resolved.detail}${resolved.remedy ? ` — ${resolved.remedy}` : ''}`)
        real = toClaudeRuntime(resolved)
        shim = writeClaudeShim(h.root, real.path, claudeCommand(real.path))
        fake = await startFakeModel(anthropicScript('-', []))
        restoreEnv = patchEnv({
          HOME: h.home,
          EYAS_CLAUDE_CODE_BIN: shim.path,
          ANTHROPIC_BASE_URL: fake.url,
          ANTHROPIC_API_KEY: 'sk-ant-eyas-live-lane-dummy',
          ...Object.fromEntries(CLAUDE_REAL_AUTH_ENV.map((k) => [k, undefined])),
        })
        const viaShim = await resolveClaudeRuntime({ refresh: true })
        if (!viaShim.ok) throw new Error(`the Claude Code shim did not resolve: ${viaShim.detail}`)
        runtime = toClaudeRuntime(viaShim)
        proven['claude-code'] = real.version
      }, 60_000)
      afterAll(async () => {
        restoreEnv()
        await fake?.close()
        clearExecutableCache('claude-code')
      })

      // F1 zero-cost + F5 discovery: the binary EYAS resolves is the one that
      // runs, it reports API-key sign-in as signed in, and neither the
      // init-only query on A4's options nor discovery loads anything from the
      // host or sends a model request.
      it('the resolved runtime is the one that runs; auth status, the init-only query and model discovery load nothing from the host, send no model request and stay inside the host-write allowlist', async () => {
        expect(runtime.source).toBe('override')
        expect(runtime.path).toBe(shim.path)
        expect(runtime.version, 'the shim forwards --version to the real binary').toBe(real.version)

        const before = snapshotTree(h.home)
        const claudeJsonBefore = readClaudeJson(h.home)
        const spawnsBefore = shim.spawns()

        const auth = await readClaudeAuthStatus(runtime)
        expect(auth).toMatchObject({ loggedIn: true, authMethod: 'api_key' })

        let release: () => void = () => {}
        const hold = new Promise<void>((r) => { release = r })
        async function* idle(): AsyncGenerator<never> {
          await hold
        }
        const initTmp = cliQueryTmp()
        initTmp.create()
        const q = sdkQuery({ prompt: idle(), options: buildClaudeIsolationOptions({ cwd: h.project, executable: runtime.path, tmpDir: initTmp.dir }) as never })
        let init: { agents?: unknown; commands?: unknown }
        let mcp: unknown
        try {
          init = (await q.initializationResult()) as typeof init
          mcp = await q.mcpServerStatus()
        } finally {
          release()
          q.close?.()
          initTmp.release()
        }
        const names = (list: unknown): string[] => (Array.isArray(list) ? list : []).map((x: { name?: unknown }) => String(x?.name ?? ''))
        expect(names(init.agents).filter((n) => /sentinel/i.test(n)), 'no host agent').toEqual([])
        expect(names(init.commands).filter((n) => /sentinel/i.test(n)), 'no host skill or command').toEqual([])
        expect(names(mcp).filter((n) => n !== 'eyas'), 'no MCP server but EYAS\'s own').toEqual([])

        const probe = await probeClaudeRuntime(runtime, { cwd: h.project })
        expect(probe.models.length, 'the model list arrives before any user message').toBeGreaterThan(0)

        await settle()
        expect(fake.modelCalls(), 'no model request').toEqual([])
        expect(shim.spawns() - spawnsBefore, 'auth status, the init-only query and discovery each spawned the resolved path').toBeGreaterThanOrEqual(3)
        expect(firedMarkers(h)).toEqual([])
        expectClaudeHostWritesAllowed(h, before, claudeJsonBefore, sentinels())
      }, 120_000)

      // A4/B4/B5/B14 on the real binary: one turn with tools, the model's
      // moves scripted by the fake. canUseTool allows everything here, so the
      // policy hook and the kernel sandbox are the only things that can stop
      // a read.
      it('a full turn through the EYAS provider: the policy hook refuses the vault and the EYAS data dir, the kernel sandbox stops a read the hook cannot see, a workspace read works, and nothing reaches the model or the host but the allowlist', async () => {
        const id = hex()
        const marker = `EYAS-A14-TURN-${id}`
        const canary = `EYAS-A14-CANARY-${id}`
        const workspaceMarker = `EYAS-A14-WORKSPACE-${id}`
        const workspaceFile = join(h.project, 'a14-workspace.txt')
        writeFileSync(workspaceFile, `${workspaceMarker}\n`)
        const eyasVault = resolveInstance({ ensureDirs: false }).vaultDir
        mkdirSync(eyasVault, { recursive: true })
        writeFileSync(join(eyasVault, 'kept.md'), '# kept\n')
        const eyasVaultBefore = snapshotTree(eyasVault)
        // No slash in the command text: the hook's shell-path reading cannot
        // see this path, so only the kernel sandbox can stop it. A host
        // without one (Linux without bubblewrap) runs the turn without this
        // step — there is nothing to prove there.
        const hiddenRead = `cat "$(printf '${vaultNote().replace(/\//g, '\\057')}')"`
        const kernel = await detectKernelSandbox('claude-code', { refresh: true })
        fake.setHandler(anthropicScript(marker, [
          { tool: 'Read', input: { file_path: vaultNote() } },
          { tool: 'Bash', input: { command: `cat '${vaultNote()}'`, description: 'Read the note' } },
          { tool: 'Write', input: { file_path: join(eyasVault, 'a14-note.md'), content: 'written by the model\n' } },
          ...(kernel.available ? [{ tool: 'Bash', input: { command: hiddenRead, description: 'Read the note again' } }] : []),
          { tool: 'Read', input: { file_path: workspaceFile } },
          { tool: 'Bash', input: { command: `echo ${canary}`, description: 'Print the canary' } },
          { text: 'NONE' },
        ]))

        const denies: Array<{ toolName: string; input: Record<string, unknown> }> = []
        const recordingCheck: MemoryPathHookCheck = async (toolName, input, ctx) => {
          const verdict = await policyMemoryPathHookCheck(toolName, input, ctx)
          if (verdict) denies.push({ toolName, input })
          return verdict
        }
        const provider = createClaudeCodeProvider({
          // No version: the one the isolation status then carries can only
          // come from the CLI's own init message (claude_code_version).
          runtime: { ...runtime, version: null },
          maxTurns: 10,
          getGovernance: () => ({
            securityGate: { validateToolCall: () => allow(), checkMemoryPath: recordingCheck },
          }),
        })

        const before = snapshotTree(h.home)
        const claudeJsonBefore = readClaudeJson(h.home)
        const spawnsBefore = shim.spawns()
        const events: StreamEvent[] = []
        for await (const event of provider.stream({
          messages: [{ role: 'user', content: `${marker} Follow the plan.` }],
          metadata: { conversationId: `live-a14-${id}`, origin: 'interactive', workingDirectory: h.project },
        })) {
          events.push(event)
        }
        await settle()

        assertStreamContract(events)
        if (kernel.available) expect(events.some((e) => e.type === 'notice' && e.code === 'cliSandboxUnavailable'), 'the kernel sandbox is active on this host').toBe(false)
        const status = getIsolationStatus('claude-code')
        expect(status.status).toBe('verified')
        expect(status.runtime?.path).toBe(shim.path)
        expect(status.runtime?.version, 'claude_code_version of the init message === the resolver version').toBe(real.version)
        expect(shim.spawns()).toBeGreaterThan(spawnsBefore)

        expect(denies.map((d) => d.toolName).sort()).toEqual(['Bash', 'Read', 'Write'])
        expect(denies.some((d) => d.toolName === 'Bash' && d.input.command === hiddenRead), 'the hidden read passed the hook').toBe(false)
        if (kernel.available) {
          // The script's fourth call (the fake numbers its calls): it ran, and the kernel refused the read.
          const hidden = events.find((e): e is Extract<StreamEvent, { type: 'tool_result' }> => e.type === 'tool_result' && e.toolUseId === 'toolu_eyas_lane_3')
          expect(hidden, 'the hidden read ran').toMatchObject({ outcome: 'error', isError: true })
          expect(String(hidden?.content)).not.toContain(h.sentinels.vaultNote)
        }

        const bodies = fake.bodies()
        expect(sentinels().filter((s) => bodies.includes(s)), 'no host or vault sentinel reached the model').toEqual([])
        expect(bodies, 'the workspace read worked').toContain(workspaceMarker)
        expect(diffSnapshots(eyasVaultBefore, snapshotTree(eyasVault)), 'the EYAS vault is unchanged').toEqual(NO_CHANGE)
        expect(filesContaining(h.home, [canary]), 'the canary is in no host file').toEqual([])
        expect(filesContaining(h.eyasHomes, [canary]), 'the canary is in no EYAS home').toEqual([])
        expect(firedMarkers(h)).toEqual([])
        expectClaudeHostWritesAllowed(h, before, claudeJsonBefore, [canary, ...sentinels()])
      }, 180_000)

      // Gate 0: project instruction files are not auto-loaded. 2.1.281 ships
      // an agents-md builtin plugin that loads AGENTS.md where a project has
      // no CLAUDE.md, and attaches a nested one when a file below it is read;
      // under the isolation options neither may reach the model.
      it('a folder with only AGENTS.md files (root and nested): neither reaches the model, and a Read below the nested one still works', async () => {
        const id = hex()
        const marker = `EYAS-A14-AGENTS-${id}`
        const folder = mkdtempSync(join(h.root, 'agents-only-'))
        mkdirSync(join(folder, 'sub'))
        const rootRule = `EYAS-A14-ROOT-AGENTS-${id}`
        const nestedRule = `EYAS-A14-NESTED-AGENTS-${id}`
        const fileMarker = `EYAS-A14-NESTED-FILE-${id}`
        writeFileSync(join(folder, 'AGENTS.md'), `# Rules\n\n${rootRule}\n`)
        writeFileSync(join(folder, 'sub', 'AGENTS.md'), `# Rules\n\n${nestedRule}\n`)
        writeFileSync(join(folder, 'sub', 'notes.txt'), `${fileMarker}\n`)
        fake.setHandler(anthropicScript(marker, [
          { tool: 'Read', input: { file_path: join(folder, 'sub', 'notes.txt') } },
          { text: 'NONE' },
        ]))
        const provider = createClaudeCodeProvider({
          runtime,
          maxTurns: 4,
          getGovernance: () => ({ securityGate: { validateToolCall: () => allow(), checkMemoryPath: policyMemoryPathHookCheck } }),
        })
        const before = snapshotTree(h.home)
        const claudeJsonBefore = readClaudeJson(h.home)
        let done = false
        for await (const event of provider.stream({
          messages: [{ role: 'user', content: `${marker} Read the notes.` }],
          metadata: { conversationId: `live-a14-agents-${id}`, origin: 'interactive', workingDirectory: folder },
        })) {
          if (event.type === 'done') done = true
        }
        await settle()

        expect(done).toBe(true)
        const bodies = fake.bodies()
        expect(bodies, 'the Read below the nested AGENTS.md worked').toContain(fileMarker)
        expect(bodies.includes(rootRule), 'the root AGENTS.md was not loaded').toBe(false)
        expect(bodies.includes(nestedRule), 'the nested AGENTS.md was not attached').toBe(false)
        expectClaudeHostWritesAllowed(h, before, claudeJsonBefore, [rootRule, nestedRule, fileMarker, ...sentinels()])
      }, 180_000)

      // R1B-16 on the real binary: the summarized-thinking display EYAS plans
      // for a model that hides its thinking unless asked goes out as the
      // runtime's --thinking-display and reaches the model request; a plan
      // without it leaves the runtime's own default (no summarized display).
      it('the summarized thinking display EYAS plans reaches the model request on this runtime, and only when planned', async () => {
        expect(runtimeHasThinkingDisplay(real.version), `the lane binary ${real.version} has --thinking-display`).toBe(true)
        const id = hex()
        const marker = `EYAS-R1B16-${id}`
        const reasoning = {
          source: 'sdk' as const, param: 'effort' as const, levels: ['low' as const, 'medium' as const, 'high' as const],
          adaptiveThinking: true, thinkingDisplay: true, ...(real.version ? { runtime: real.version } : {}), discoveredAt: new Date().toISOString(),
        }
        const metadata = { alias: 'claude-opus-4-8', realModelId: 'claude-opus-4-8', reasoning }
        const capability = createReasoningRegistry({ overlay: loadBundledOverlay(), getDiscovered: () => reasoning })
          .get('claude-code', 'claude-code-lane-opus', 'claude-opus-4-8')
        expect(capability.displayParam, 'the overlay says this model hides its thinking unless asked').toBe(true)
        fake.setHandler(anthropicScript(marker, [{ text: 'NONE' }]))
        const provider = createClaudeCodeProvider({
          runtime,
          maxTurns: 1,
          lookupModelMetadata: (modelId) => (modelId === 'claude-code-lane-opus' ? metadata : null),
          getGovernance: () => ({ securityGate: { validateToolCall: () => allow(), checkMemoryPath: policyMemoryPathHookCheck } }),
        })
        const turn = async (plan: EffortPlan) => {
          const start = fake.requests.length
          for await (const _event of provider.stream({
            model: 'claude-code-lane-opus',
            effortPlan: plan,
            messages: [{ role: 'user', content: `${marker} Answer NONE.` }],
            metadata: { conversationId: `live-r1b16-${id}`, origin: 'interactive', workingDirectory: h.project },
          })) { /* drain */ }
          await settle()
          // The turn itself, not the runtime's own side query for a session
          // title (a json_schema output format, thinking disabled).
          return fake.requests.slice(start).filter((r) => r.path.endsWith('/v1/messages')
            && JSON.stringify(r.json?.messages ?? []).includes(marker)
            && !r.json?.output_config?.format)
        }

        const before = snapshotTree(h.home)
        const claudeJsonBefore = readClaudeJson(h.home)
        const asked = await turn(effortPlanFor('high', capability))
        expect(asked.length, 'the turn reached the fake model').toBeGreaterThan(0)
        for (const r of asked) {
          expect(r.json?.model).toBe('claude-opus-4-8')
          expect(r.json?.thinking, 'adaptive thinking with the summarized display').toMatchObject({ type: 'adaptive', display: 'summarized' })
        }

        const plain = await turn(effortPlanFor('high', { ...capability, displayParam: false }))
        expect(plain.length).toBeGreaterThan(0)
        expect(plain.some((r) => r.json?.thinking?.display === 'summarized'), 'no display without the flag').toBe(false)
        expect(firedMarkers(h)).toEqual([])
        expectClaudeHostWritesAllowed(h, before, claudeJsonBefore, [marker, ...sentinels()])
      }, 180_000)

      // B14 on Claude Code: the memory-policy hook asks the real gate, so
      // every refusal is its audited security_events row.
      it('memory sovereignty (B14): through the real security gate, Read and a shell cat of a store registered in security.foreignMemoryPaths and a Write into the EYAS vault are refused — one audited deny and one denied tool row each — and a workspace Read after them works', async () => {
        const id = hex()
        const marker = `EYAS-B14-CLAUDE-${id}`
        const store = plantRegisteredStore(h.root, id)
        const workspaceMarker = `EYAS-B14-WORKSPACE-${id}`
        const workspaceFile = join(h.project, `b14-claude-${id}.txt`)
        writeFileSync(workspaceFile, `${workspaceMarker}\n`)
        const eyasVault = resolveInstance({ ensureDirs: false }).vaultDir
        mkdirSync(eyasVault, { recursive: true })
        expectOnlyRegistrationRefuses(h.home, store, [h.project])

        const audited = await startAuditedGate(h.home, [store.dir])
        try {
          fake.setHandler(anthropicScript(marker, [
            { tool: 'Read', input: { file_path: store.note } },
            { tool: 'Bash', input: { command: `cat '${store.note}'`, description: 'Read the journal' } },
            { tool: 'Write', input: { file_path: join(eyasVault, `b14-${id}.md`), content: `---\nkind: feedback\n---\nwritten by the model\n` } },
            { tool: 'Read', input: { file_path: workspaceFile } },
            { text: 'NONE' },
          ]))
          const provider = createClaudeCodeProvider({
            runtime,
            maxTurns: 8,
            getGovernance: () => ({ securityGate: audited.gate }),
          })
          const conversationId = `live-b14-claude-${id}`
          const storeBefore = snapshotTree(store.dir)
          const eyasVaultBefore = snapshotTree(eyasVault)
          const before = snapshotTree(h.home)
          const claudeJsonBefore = readClaudeJson(h.home)
          const events: StreamEvent[] = []
          for await (const event of provider.stream({
            messages: [{ role: 'user', content: `${marker} Follow the plan.` }],
            metadata: { conversationId, origin: 'interactive', workingDirectory: h.project },
          })) {
            events.push(event)
          }
          await settle()

          assertStreamContract(events)
          expectMemoryMatrix({
            events,
            bodies: fake.bodies(),
            rows: audited.events(conversationId),
            store,
            storeBefore,
            eyasVault,
            eyasVaultBefore,
            workspaceFile,
            workspaceMarker,
            refused: ['toolu_eyas_lane_0', 'toolu_eyas_lane_1', 'toolu_eyas_lane_2'].map((toolId) => toolResult(events, toolId)),
            workspaceRead: toolResult(events, 'toolu_eyas_lane_3'),
          })
          expect(firedMarkers(h)).toEqual([])
          expectClaudeHostWritesAllowed(h, before, claudeJsonBefore, [store.sentinel, ...sentinels()])
        } finally {
          audited.restore()
        }
      }, 180_000)
      // K1 on the real binary: Claude Code runs Grep and Glob without asking
      // (canUseTool never sees them), so the memory-policy hook is what judges
      // a search rooted ABOVE a store — by what the search can reach below
      // its folder, through the real gate.
      it('K1: Grep, Glob and a recursive Bash search rooted at the home are refused by the hook as too broad — audited, denied rows — and a Grep of the project still works', async () => {
        const id = hex()
        const marker = `EYAS-K1-CLAUDE-${id}`
        const projectMarker = `EYAS-K1-PROJECT-${id}`
        const projectFile = join(h.project, `k1-claude-${id}.txt`)
        writeFileSync(projectFile, `${projectMarker}\n`)
        const audited = await startAuditedGate(h.home, [])
        try {
          fake.setHandler(anthropicScript(marker, [
            { tool: 'Grep', input: { pattern: 'EYAS', path: h.home, glob: '**/memory/*.md', output_mode: 'content' } },
            { tool: 'Glob', input: { pattern: '**/MEMORY.md', path: h.home } },
            { tool: 'Bash', input: { command: `grep -r EYAS '${h.home}'`, description: 'Search the home' } },
            { tool: 'Grep', input: { pattern: projectMarker, path: h.project, output_mode: 'content' } },
            { text: 'NONE' },
          ]))
          const provider = createClaudeCodeProvider({
            runtime,
            maxTurns: 8,
            getGovernance: () => ({ securityGate: audited.gate }),
          })
          const conversationId = `live-k1-claude-${id}`
          const before = snapshotTree(h.home)
          const claudeJsonBefore = readClaudeJson(h.home)
          const events: StreamEvent[] = []
          for await (const event of provider.stream({
            messages: [{ role: 'user', content: `${marker} Follow the plan.` }],
            metadata: { conversationId, origin: 'interactive', workingDirectory: h.project },
          })) {
            events.push(event)
          }
          await settle()

          assertStreamContract(events)
          const denies = audited.events(conversationId).filter((r) => r.decision === 'deny')
          expect(denies.map((r) => r.tool_name), 'one audited deny per refused search').toEqual(['Grep', 'Glob', 'Bash'])
          for (const row of denies) {
            expect(row.checkpoint).toBe('deterministic')
            expect(row.reason ?? '', 'refused as a search too broad').toMatch(/^Search too broad \[memory-path:search-scope:foreign-memory\]/)
          }
          for (const toolId of ['toolu_eyas_lane_0', 'toolu_eyas_lane_1', 'toolu_eyas_lane_2']) {
            expect(toolResult(events, toolId), `tool row ${toolId}`).toMatchObject({ outcome: 'denied', isError: true })
          }
          expect(toolResult(events, 'toolu_eyas_lane_3'), 'the project Grep ran').toMatchObject({ outcome: 'success', isError: false })
          const bodies = fake.bodies()
          expect(bodies, 'the project Grep reached the model').toContain(projectMarker)
          expect(sentinels().filter((s) => bodies.includes(s)), 'no host or vault sentinel reached the model').toEqual([])
          expect(firedMarkers(h)).toEqual([])
          expectClaudeHostWritesAllowed(h, before, claudeJsonBefore, sentinels())
        } finally {
          audited.restore()
        }
      }, 180_000)

      // K2 on the real binary: a stored folder that CONTAINS a vault never
      // becomes the cwd (the next one does), and a read the CLI allows on its
      // own inside the cwd — it never asks canUseTool for it — is still
      // refused by the memory-policy hook when it lands in a vault (one nested
      // below the depth folder validation scans).
      it('K2: a folder holding a vault is not the cwd; an in-cwd Read the CLI allows without asking is still refused by the hook when it lands in a vault, and an ordinary in-cwd Read works', async () => {
        const id = hex()
        const marker = `EYAS-K2-CLAUDE-${id}`
        const projectMarker = `EYAS-K2-PROJECT-${id}`
        const deepSentinel = `EYAS-K2-DEEP-VAULT-${id}`
        const notesSentinel = `EYAS-K2-NOTES-VAULT-${id}`
        // A folder that holds a vault: stored first, refused as the cwd.
        const notes = join(h.root, `k2-notes-${id}`)
        mkdirSync(join(notes, 'Vault', '.obsidian'), { recursive: true })
        writeFileSync(join(notes, 'Vault', 'note.md'), `${notesSentinel}\n`)
        // The project that becomes the cwd, with a vault nested nine levels
        // down — below what folder validation scans — found per path.
        const project = join(h.root, `k2-project-${id}`)
        mkdirSync(join(project, 'src'), { recursive: true })
        writeFileSync(join(project, 'src', 'ok.txt'), `${projectMarker}\n`)
        const deepRel = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'deep-vault']
        const deepVault = join(project, ...deepRel)
        mkdirSync(join(deepVault, '.obsidian'), { recursive: true })
        writeFileSync(join(deepVault, 'note.md'), `${deepSentinel}\n`)

        // A clean file outside the cwd: the CLI asks canUseTool for it (the control).
        const outside = join(h.root, `k2-outside-${id}.txt`)
        writeFileSync(outside, 'outside\n')

        fake.setHandler(anthropicScript(marker, [
          { tool: 'Read', input: { file_path: join(deepVault, 'note.md') } },
          { tool: 'Read', input: { file_path: join(project, 'src', 'ok.txt') } },
          { tool: 'Read', input: { file_path: join(notes, 'Vault', 'note.md') } },
          { tool: 'Read', input: { file_path: outside } },
          { text: 'NONE' },
        ]))
        const denies: Array<{ toolName: string; input: Record<string, unknown> }> = []
        const recordingCheck: MemoryPathHookCheck = async (toolName, input, ctx) => {
          const verdict = await policyMemoryPathHookCheck(toolName, input, ctx)
          if (verdict) denies.push({ toolName, input })
          return verdict
        }
        const asked: Array<{ toolName: string; input: Record<string, unknown> }> = []
        const provider = createClaudeCodeProvider({
          runtime,
          maxTurns: 8,
          getGovernance: () => ({
            securityGate: {
              validateToolCall: (toolName: string, input: Record<string, unknown>) => {
                asked.push({ toolName, input })
                return allow()
              },
              checkMemoryPath: recordingCheck,
            },
          }),
        })
        const before = snapshotTree(h.home)
        const claudeJsonBefore = readClaudeJson(h.home)
        const events: StreamEvent[] = []
        for await (const event of provider.stream({
          messages: [{ role: 'user', content: `${marker} Follow the plan.` }],
          metadata: { conversationId: `live-k2-claude-${id}`, origin: 'interactive', workingDirectories: [notes, project] },
        })) {
          events.push(event)
        }
        await settle()

        assertStreamContract(events)
        // The deep vault Read (in the cwd) and the vault Read (outside it) were refused by the hook.
        expect(denies.map((d) => String(d.input.file_path)).sort()).toEqual([join(deepVault, 'note.md'), join(notes, 'Vault', 'note.md')].sort())
        expect(toolResult(events, 'toolu_eyas_lane_0'), 'the in-cwd vault Read').toMatchObject({ outcome: 'denied', isError: true })
        expect(toolResult(events, 'toolu_eyas_lane_1'), 'the in-cwd project Read').toMatchObject({ outcome: 'success', isError: false })
        expect(toolResult(events, 'toolu_eyas_lane_2'), 'the Read in the refused folder').toMatchObject({ outcome: 'denied', isError: true })
        expect(toolResult(events, 'toolu_eyas_lane_3'), 'the Read outside the cwd').toMatchObject({ outcome: 'success', isError: false })
        // The cwd was the project, not the folder holding the vault: the CLI
        // read the project file without asking canUseTool — only the read
        // outside the cwd was asked about — so the hook alone judged the
        // in-cwd vault Read.
        const askedReads = asked.filter((a) => a.toolName === 'Read').map((a) => String(a.input.file_path))
        expect(askedReads, 'canUseTool saw the Read outside the cwd').toContain(outside)
        expect(askedReads, 'the in-cwd Read was allowed by the CLI itself').not.toContain(join(project, 'src', 'ok.txt'))
        const bodies = fake.bodies()
        expect(bodies, 'the project Read reached the model').toContain(projectMarker)
        expect([deepSentinel, notesSentinel, ...sentinels()].filter((s) => bodies.includes(s)), 'no vault or host sentinel reached the model').toEqual([])
        expect(firedMarkers(h)).toEqual([])
        expectClaudeHostWritesAllowed(h, before, claudeJsonBefore, [deepSentinel, notesSentinel, ...sentinels()])
      }, 180_000)

      // K3 (R1A-15) on the real binary: the agent's tool list bounds Claude
      // Code's own built-ins. A turn whose request offers no write, shell or
      // web tool reaches the model without Bash, Write, Edit, NotebookEdit,
      // WebFetch or WebSearch (Read, Glob and Grep stay), and a Bash call the
      // model makes anyway never runs. The same turn offering run_command
      // and write_file keeps them, and the Bash call runs.
      it('K3: a tool list without write and shell tools takes Bash, Write and Edit from the model and a Bash call never runs; a list with them keeps them', async () => {
        const id = hex()
        const def = (name: string) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } })
        const asked: string[] = []
        const provider = createClaudeCodeProvider({
          runtime,
          maxTurns: 4,
          getGovernance: () => ({
            securityGate: {
              validateToolCall: (toolName: string) => {
                asked.push(toolName)
                return allow()
              },
              checkMemoryPath: policyMemoryPathHookCheck,
            },
          }),
        })
        // Every tool the turn's model requests offered (a side call, such as
        // the title, carries the marker with no tools at all).
        const modelTools = (marker: string): string[] => [...new Set(
          fake.modelCalls()
            .filter((r) => JSON.stringify(r.json?.messages ?? []).includes(marker))
            .flatMap((r) => (Array.isArray(r.json?.tools) ? r.json.tools : []).map((t: { name?: unknown }) => String(t?.name ?? ''))),
        )]
        const turn = async (step: string, tools: string[], made: string): Promise<{ marker: string; events: StreamEvent[] }> => {
          const marker = `EYAS-K3-CLAUDE-${step}-${id}`
          fake.setHandler(anthropicScript(marker, [
            { tool: 'Bash', input: { command: `touch '${made}'`, description: 'Make a file' } },
            { text: 'NONE' },
          ]))
          const events: StreamEvent[] = []
          for await (const event of provider.stream({
            messages: [{ role: 'user', content: `${marker} Follow the plan.` }],
            tools: tools.map(def),
            metadata: { conversationId: `live-k3-claude-${step}-${id}`, origin: 'interactive', workingDirectory: h.project },
          })) {
            events.push(event)
          }
          assertStreamContract(events)
          return { marker, events }
        }

        const before = snapshotTree(h.home)
        const claudeJsonBefore = readClaudeJson(h.home)
        const narrowFile = join(h.project, `k3-claude-narrow-${id}.txt`)
        const narrow = await turn('NARROW', ['memory_search', 'memory_expand', 'read_file'], narrowFile)
        const wideFile = join(h.project, `k3-claude-wide-${id}.txt`)
        const wide = await turn('WIDE', ['memory_search', 'memory_expand', 'read_file', 'write_file', 'run_command'], wideFile)
        await settle()

        const narrowTools = modelTools(narrow.marker)
        expect(narrowTools, 'reading stays').toEqual(expect.arrayContaining(['Read', 'Glob', 'Grep']))
        for (const name of ['Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch']) {
          expect(narrowTools, `${name} reached the model on a list without it`).not.toContain(name)
        }
        expect(existsSync(narrowFile), 'the Bash call of the narrow turn ran').toBe(false)
        expect(toolResult(narrow.events, 'toolu_eyas_lane_0'), 'the refused Bash row').toMatchObject({ isError: true })

        const wideTools = modelTools(wide.marker)
        expect(wideTools).toEqual(expect.arrayContaining(['Bash', 'Write', 'Edit', 'Read']))
        expect(wideTools).not.toContain('WebFetch')
        expect(existsSync(wideFile), 'the Bash call of the wide turn ran').toBe(true)
        expect(asked.filter((n) => n === 'Bash'), 'only the wide turn asked about Bash').toHaveLength(1)

        expect(firedMarkers(h)).toEqual([])
        expectClaudeHostWritesAllowed(h, before, claudeJsonBefore, sentinels())
      }, 180_000)

      // K5 (MISSED-M-1) on the real binary: an isolated one-shot honours
      // maxTokens. The fake answers far past the cap in one delta; EYAS keeps
      // maxTokens × 4 characters, stops the runtime and ends the call as
      // done{max_tokens}. The stopped runtime throws nothing at the caller
      // and leaves no temp folder or host write behind.
      it('K5: an isolated one-shot past its maxTokens ends as done{max_tokens} with the answer clipped to maxTokens × 4 characters, and the stopped runtime leaves nothing behind', async () => {
        const id = hex()
        const marker = `EYAS-K5-CLAUDE-${id}`
        const answer = `${marker} `.repeat(40)
        fake.setHandler(anthropicScript(marker, [{ text: answer }]))
        const provider = createClaudeCodeProvider({ runtime })

        const before = snapshotTree(h.home)
        const claudeJsonBefore = readClaudeJson(h.home)
        const calls = fake.modelCalls().length
        const events: StreamEvent[] = []
        for await (const event of provider.stream({
          system: 'Repeat the text you are given.',
          messages: [{ role: 'user', content: `${marker} Repeat it.` }],
          isolated: true,
          maxTokens: 5,
          metadata: { origin: 'pipeline', workingDirectory: h.project },
        })) {
          events.push(event)
        }
        await settle()

        assertStreamContract(events)
        expect(fake.modelCalls().length - calls, 'the model was asked').toBeGreaterThan(0)
        const done = events.find((e): e is Extract<StreamEvent, { type: 'done' }> => e.type === 'done')
        expect(done?.response.stopReason).toBe('max_tokens')
        expect(done?.response.content).toEqual([{ type: 'text', text: answer.slice(0, 20) }])
        expect(events.map((e) => (e.type === 'text' ? e.text : '')).join(''), 'what streamed is the clipped answer').toBe(answer.slice(0, 20))
        expect(events.some((e) => e.type === 'error')).toBe(false)
        expect(getIsolationStatus('claude-code').status).toBe('verified')
        expect(firedMarkers(h)).toEqual([])
        expectClaudeHostWritesAllowed(h, before, claudeJsonBefore, sentinels())
      }, 120_000)
    })

    describe('Grok CLI', () => {
      let executable: string
      let fake: FakeModel
      let profile: AcpCliProfile

      beforeAll(async () => {
        const resolved = await resolveCliExecutable('grok-cli', { refresh: true })
        if (!resolved.ok) throw new Error(`the live lane needs the Grok CLI: ${resolved.detail}${resolved.remedy ? ` — ${resolved.remedy}` : ''}`)
        executable = resolved.path
        proven['grok-cli'] = resolved.version
        fake = await startFakeModel(xaiScript('-', []))
        profile = createAcpProfile('grok-cli', { homesDir: h.eyasHomes, extraEnv: () => grokFakeEnv(fake.url) })
      }, 60_000)
      afterAll(async () => {
        await fake?.close()
      })

      it('the preflight: grok inspect in the hostile project is clean and the managed files read back', async () => {
        resetIsolationStatuses('grok-cli')
        profile.ensureHome()
        await createAcpVerifier(profile).preflight({ executable, cwd: h.project, roots: [h.project], refresh: true })
        expect(getIsolationStatus('grok-cli').status).toBe('verified')
        expect(readBackManagedFiles(profile)).toEqual([])
        expect(firedMarkers(h)).toEqual([])
      }, 60_000)

      it('model discovery (session/new, no prompt) sends no model request and leaves no session store', async () => {
        const calls = fake.modelCalls().length
        const homeBefore = snapshotTree(h.home)
        const models = await createGrokCliProvider({ profile, probeCwd: () => h.project }).fetchModels!()
        expect(models.map((m) => m.id)).toContain('grok-cli-grok-4.6')
        expect(fake.modelCalls().length - calls).toBe(0)
        expect(entriesOf(profile.sessionStorePath)).toEqual([])
        expect(diffSnapshots(homeBefore, snapshotTree(h.home))).toEqual(NO_CHANGE)
      }, 120_000)

      it('a full turn through the EYAS provider: every native read asks EYAS, the fs jail keeps the vault out, the system prompt override is honoured, nothing from the host or the project config is loaded, and no session store is left', async () => {
        const id = hex()
        const marker = `EYAS-A14-GROK-${id}`
        const workspaceMarker = `EYAS-A14-GROK-WORKSPACE-${id}`
        const file = join(h.project, 'a14-grok.txt')
        writeFileSync(file, `${workspaceMarker}\n`)
        fake.setHandler(xaiScript(marker, [
          { tool: 'read_file', input: { target_file: file } },
          { tool: 'read_file', input: { target_file: vaultNote() } },
          { text: 'NONE' },
        ]))
        const asked: Array<{ toolName: string; input: Record<string, unknown> }> = []
        const homeBefore = snapshotTree(h.home)
        const provider = createGrokCliProvider({
          profile,
          maxTurns: 6,
          getGovernance: () => ({
            securityGate: {
              validateToolCall: (toolName, input) => {
                asked.push({ toolName, input })
                return allow('live lane: every permission granted')
              },
            },
          }),
        })

        const events: StreamEvent[] = []
        for await (const event of provider.stream({
          system: 'EYAS live lane system prompt.',
          messages: [{ role: 'user', content: `${marker} Read both files.` }],
          metadata: { conversationId: `live-a14-grok-${id}`, origin: 'interactive', workingDirectory: h.project },
        })) {
          events.push(event)
        }
        await settle()

        const done = events.find((e): e is Extract<StreamEvent, { type: 'done' }> => e.type === 'done')
        expect(done, 'the turn ended with an answer').toBeDefined()
        expect(done?.response.systemPromptChannel, 'grok honoured the EYAS system prompt override').toBe('meta-verified')
        expect(getIsolationStatus('grok-cli').status).toBe('verified')
        expect(asked.some((a) => JSON.stringify(a.input).includes(file)), 'read_file reached EYAS request_permission').toBe(true)

        const bodies = fake.bodies()
        expect(bodies, 'the workspace read worked').toContain(workspaceMarker)
        expect(sentinels().filter((s) => bodies.includes(s)), 'no host, project-config or vault sentinel reached the model').toEqual([])
        expect(firedMarkers(h), 'no host or project hook or MCP server ran').toEqual([])
        expect(entriesOf(profile.sessionStorePath), 'the session store was purged').toEqual([])
        expect(diffSnapshots(homeBefore, snapshotTree(h.home)), 'the hostile HOME is untouched').toEqual(NO_CHANGE)
      }, 180_000)

      // The CLI-MCP bridge through the REAL auth stack (cli-mcp-bridge-auth.test.ts
      // proves the routes; this proves the grok child reaches them): Grok under
      // its EYAS home calls eyas memory_search through the bridge, and no
      // session 'Authentication required' comes back.
      it('EYAS tools reach grok through the MCP bridge behind the session-auth catch-all', async () => {
        const id = hex()
        const marker = `EYAS-A14-BRIDGE-${id}`
        const recalled = `EYAS-A14-RECALLED-${id}`
        const app = new Hono<any>()
        app.onError(errorHandler)
        createAuthRoutes(app, {
          db: createMemoryDb(),
          registry: createPermissionRegistry(),
          tokenService: createTokenService(`live-lane-${randomBytes(24).toString('hex')}`),
          sessionDuration: 86400,
          accessTokenDuration: 900,
          refreshTokenDuration: 2592000,
        })
        const registry = createToolRegistry()
        registry.register({
          name: 'memory_search',
          description: 'Search EYAS memory',
          category: 'memory',
          riskTier: 'green',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          execute: async () => ({ results: [] }),
        })
        const calls: Array<{ name: string; ctx: ToolContext | undefined }> = []
        registerCliMcpBridgeRoutes({
          http: app as unknown as Hono,
          toolRegistry: registry,
          toolExecutor: {
            execute: async (name: string, _args: Record<string, unknown>, ctx?: ToolContext) => {
              calls.push({ name, ctx })
              return { success: true, output: { results: [{ id: 'vt:1', text: recalled }] }, durationMs: 1 }
            },
            renderForModel: createToolExecutor(registry, { authorization: 'disabled' }).renderForModel,
          } as any,
          getSecurityGate: allowAllBridgeGate,
          logger: pino({ level: 'silent' }),
        })
        const server = await serveOnLoopback(app.fetch)
        const homeBefore = snapshotTree(h.home)
        try {
          fake.setHandler(xaiScript(marker, [
            { tool: 'search_tool', input: { query: 'eyas memory search' } },
            { tool: 'use_tool', input: { tool_name: 'eyas__memory_search', tool_input: { query: 'a14' } } },
            { text: 'NONE' },
          ]))
          const provider = createGrokCliProvider({
            profile,
            maxTurns: 6,
            mcpBridge: { baseUrl: server.url },
            getGovernance: () => ({ securityGate: { validateToolCall: () => allow('live lane: every permission granted') } }),
          })
          const conversationId = `live-a14-bridge-${id}`
          for await (const event of provider.stream({
            messages: [{ role: 'user', content: `${marker} Search EYAS memory.` }],
            metadata: { conversationId, origin: 'interactive', workingDirectory: h.project },
          })) {
            void event
          }
          await settle()
          expect(calls.map((c) => c.name)).toEqual(['memory_search'])
          expect(calls[0].ctx).toMatchObject({ conversationId })
          const bodies = fake.bodies()
          expect(bodies, 'the bridge answer reached the model').toContain(recalled)
          expect(bodies).not.toContain('Authentication required')
          expect(entriesOf(profile.sessionStorePath)).toEqual([])
          expect(diffSnapshots(homeBefore, snapshotTree(h.home))).toEqual(NO_CHANGE)
        } finally {
          await server.close()
        }
      }, 180_000)

      // K12 (R1A-04, R1A-10) on the real binary: grok reaches an EYAS tool
      // through use_tool without asking EYAS (A1 mcp-dispatch.json), so the
      // bridge is where the call is judged — by the same permission bridge as
      // Claude Code's canUseTool and with the API path's verdicts. Three turns
      // of one tool through the real bridge, executor and autonomy policy:
      // (A) an attended chat runs a requiresApproval tool the gate allows, and
      // the tool row carries use_tool's tool_input, which is what the bridge
      // received — so the ledger key a resume builds from the row matches;
      // (B) a background run's escalation queues an approval stamped with its
      // run and hands it to the runner's park sink, and nothing runs;
      // (C) a resumed run whose ledger holds (A) skips the repeat.
      it('K12: a bridged EYAS call gets the API path\'s verdicts: an attended chat runs a requiresApproval tool, a background escalation queues an approval for its run to park on, and a resumed run\'s ledger skips the repeat', async () => {
        const id = hex()
        const app = new Hono<any>()
        app.onError(errorHandler)
        createAuthRoutes(app, {
          db: createMemoryDb(),
          registry: createPermissionRegistry(),
          tokenService: createTokenService(`live-lane-${randomBytes(24).toString('hex')}`),
          sessionDuration: 86400,
          accessTokenDuration: 900,
          refreshTokenDuration: 2592000,
        })
        const policyDb = createMemoryDb()
        createAutonomyTables(policyDb)
        const policy = createAutonomyPolicy(policyDb)
        policy.seedDefaults()
        let verdict: GateDecision = allow('live lane: the invoice is allowed')
        const judged: string[] = []
        const gate = {
          validateToolCall: async (toolName: string) => {
            judged.push(toolName)
            // grok's own permission requests (search_tool) are always allowed; the bridged call gets the turn's verdict.
            return toolName === 'send_invoice' ? verdict : allow('live lane: grok\'s own tools')
          },
          autonomyPolicy: policy,
        }
        const registry = createToolRegistry()
        const ran: Array<Record<string, unknown>> = []
        registry.register({
          name: 'send_invoice',
          description: 'Send an invoice',
          category: 'custom',
          riskTier: 'yellow',
          requiresApproval: true,
          inputSchema: { type: 'object', properties: { invoice: { type: 'string' } }, required: ['invoice'] },
          execute: async (input) => {
            ran.push(input)
            return { sent: true }
          },
        })
        const executor = createToolExecutor(registry, {
          authorization: { getSecurityGate: () => gate as any, getAbilityForRole: () => ({ can: () => true }) },
        })
        registerCliMcpBridgeRoutes({ http: app as unknown as Hono, toolRegistry: registry, toolExecutor: executor, getSecurityGate: () => gate, logger: pino({ level: 'silent' }) })
        const server = await serveOnLoopback(app.fetch)
        const provider = createGrokCliProvider({
          profile,
          maxTurns: 6,
          mcpBridge: { baseUrl: server.url },
          getGovernance: () => ({ securityGate: gate as any }),
        })
        const conversationId = `live-k12-grok-${id}`
        const invoice = { invoice: `INV-${id}` }
        const homeBefore = snapshotTree(h.home)
        const turn = async (step: string, metadata: Record<string, unknown>): Promise<StreamEvent[]> => {
          const marker = `EYAS-K12-GROK-${step}-${id}`
          fake.setHandler(xaiScript(marker, [
            { tool: 'search_tool', input: { query: 'eyas send invoice' } },
            { tool: 'use_tool', input: { tool_name: 'eyas__send_invoice', tool_input: invoice } },
            { text: 'NONE' },
          ]))
          const events: StreamEvent[] = []
          for await (const event of provider.stream({
            messages: [{ role: 'user', content: `${marker} Send the invoice.` }],
            metadata: { conversationId, agentId: 'agent-k12', workingDirectory: h.project, ...metadata },
          })) {
            events.push(event)
          }
          assertStreamContract(events)
          return events
        }
        const invoiceRow = (events: readonly StreamEvent[]) => {
          const start = [...events].reverse().find((e): e is Extract<StreamEvent, { type: 'tool_use_start' }> => e.type === 'tool_use_start' && e.name === 'send_invoice')
          return { start, result: start ? toolResult(events, start.id) : undefined }
        }
        try {
          // (A) An attended chat: the gate allows, requiresApproval queues nothing, the tool runs.
          verdict = allow('live lane: the invoice is allowed')
          const a = invoiceRow(await turn('A', { origin: 'interactive' }))
          expect(ran, '(A) the tool ran once, with the arguments grok passed').toEqual([invoice])
          expect(a.result, '(A) the row').toMatchObject({ outcome: 'success', executedBy: 'eyas' })
          expect(a.start?.input, '(A) the row carries use_tool\'s tool_input').toEqual(invoice)
          expect(toolLedgerKey(a.start!.name, a.start!.input)).toBe(toolLedgerKey('send_invoice', invoice))
          expect(policy.listApprovals('pending'), '(A) no approval queued').toEqual([])

          // (B) A background run: the escalation queues an approval for its run and reaches the park sink.
          verdict = { decision: 'escalate', reason: 'live lane: an invoice needs review', riskTier: 'yellow' }
          const parkedOn: Array<[number, string | undefined]> = []
          const bEvents = await turn('B', { origin: 'scheduled', runId: `run-k12-${id}`, onEscalatedApproval: (approvalId: number, toolName?: string) => parkedOn.push([approvalId, toolName]) })
          const b = invoiceRow(bEvents)
          const pending = policy.listApprovals('pending')
          expect(pending, '(B) one approval queued').toHaveLength(1)
          expect(pending[0]).toMatchObject({ toolName: 'send_invoice', conversationId, runId: `run-k12-${id}`, category: 'payment' })
          expect(parkedOn, '(B) the approval reached the runner\'s park sink').toEqual([[pending[0]!.id, 'send_invoice']])
          expect(b.result, '(B) the row').toMatchObject({ outcome: 'approval_required', isError: true })
          expect(bEvents.find((e) => e.type === 'approval_required'), '(B) approval_required').toMatchObject({ toolName: 'send_invoice', approvalId: pending[0]!.id })
          expect(ran, '(B) nothing more ran').toHaveLength(1)

          // (C) The resumed run: its ledger holds (A), so the repeat is skipped.
          verdict = allow('live lane: the invoice is allowed')
          const c = invoiceRow(await turn('C', { origin: 'interactive', idempotencyLedger: new Set([toolLedgerKey(a.start!.name, a.start!.input)]) }))
          expect(c.result, '(C) the row').toMatchObject({ outcome: 'skipped', isError: true })
          expect(ran, '(C) the repeat never ran').toHaveLength(1)
          expect(fake.bodies(), '(C) grok was told why').toContain('duplicate side effect prevented')

          expect(judged.filter((n) => n === 'send_invoice'), 'the bridged call was judged on every turn').toHaveLength(3)
          expect(firedMarkers(h)).toEqual([])
          expect(entriesOf(profile.sessionStorePath), 'the session store was purged').toEqual([])
          expect(diffSnapshots(homeBefore, snapshotTree(h.home)), 'the hostile HOME is untouched').toEqual(NO_CHANGE)
        } finally {
          await server.close()
        }
      }, 300_000)

      // B14 on Grok: every native tool asks EYAS over ACP (request_permission),
      // and the real gate's answer is the only thing between grok and the
      // store — the kernel sandbox is not what refuses here. A refused
      // permission (reject_once) ends grok's turn, so each step is a turn of
      // its own in the same conversation, the workspace read last.
      it('memory sovereignty (B14): through the real security gate, read_file and a shell cat of a store registered in security.foreignMemoryPaths and a write into the EYAS vault are refused — one audited deny and one denied tool row each — and a workspace read_file after them works', async () => {
        const id = hex()
        const store = plantRegisteredStore(h.root, id)
        const workspaceMarker = `EYAS-B14-GROK-WORKSPACE-${id}`
        const workspaceFile = join(h.project, `b14-grok-${id}.txt`)
        writeFileSync(workspaceFile, `${workspaceMarker}\n`)
        const eyasVault = resolveInstance({ ensureDirs: false }).vaultDir
        mkdirSync(eyasVault, { recursive: true })
        expectOnlyRegistrationRefuses(h.home, store, [h.project])

        const audited = await startAuditedGate(h.home, [store.dir])
        try {
          const provider = createGrokCliProvider({
            profile,
            maxTurns: 4,
            getGovernance: () => ({ securityGate: audited.gate }),
          })
          const conversationId = `live-b14-grok-${id}`
          const storeBefore = snapshotTree(store.dir)
          const eyasVaultBefore = snapshotTree(eyasVault)
          const homeBefore = snapshotTree(h.home)
          const turn = async (step: string, call: { tool: string; input: Record<string, unknown> }): Promise<StreamEvent[]> => {
            const marker = `EYAS-B14-GROK-${step}-${id}`
            fake.setHandler(xaiScript(marker, [call, { text: 'NONE' }]))
            const events: StreamEvent[] = []
            for await (const event of provider.stream({
              messages: [{ role: 'user', content: `${marker} Follow the plan.` }],
              metadata: { conversationId, origin: 'interactive', workingDirectory: h.project },
            })) {
              events.push(event)
            }
            assertStreamContract(events)
            return events
          }
          const a = await turn('A', { tool: 'read_file', input: { target_file: store.note } })
          const b = await turn('B', { tool: 'run_terminal_command', input: { command: `cat '${store.note}'`, description: 'Read the journal' } })
          const c = await turn('C', { tool: 'write', input: { file_path: join(eyasVault, `b14-${id}.md`), content: `---\nkind: feedback\n---\nwritten by the model\n` } })
          const d = await turn('D', { tool: 'read_file', input: { target_file: workspaceFile } })
          await settle()

          // The fake numbers grok's calls; grok keeps the model's call id as the ACP toolCallId.
          expectMemoryMatrix({
            events: [...a, ...b, ...c, ...d],
            bodies: fake.bodies(),
            rows: audited.events(conversationId),
            store,
            storeBefore,
            eyasVault,
            eyasVaultBefore,
            workspaceFile,
            workspaceMarker,
            refused: [a, b, c].map((events) => toolResult(events, 'call_lane_0')),
            workspaceRead: toolResult(d, 'call_lane_0'),
          })
          expect(firedMarkers(h)).toEqual([])
          expect(entriesOf(profile.sessionStorePath), 'the session store was purged').toEqual([])
          expect(diffSnapshots(homeBefore, snapshotTree(h.home)), 'the hostile HOME is untouched').toEqual(NO_CHANGE)
        } finally {
          audited.restore()
        }
      }, 240_000)

      // K1 on Grok: grep and list_dir ask EYAS (ask mode); the real gate
      // refuses one rooted above a store as a search too broad. A refused
      // permission ends grok's turn, so each step is a turn of its own.
      it('K1: a grep and a list_dir of the home are refused through the real gate as too broad, audited; a grep of the project still works', async () => {
        const id = hex()
        const projectMarker = `EYAS-K1-GROK-PROJECT-${id}`
        writeFileSync(join(h.project, `k1-grok-${id}.txt`), `${projectMarker}\n`)
        const audited = await startAuditedGate(h.home, [])
        try {
          const provider = createGrokCliProvider({
            profile,
            maxTurns: 4,
            getGovernance: () => ({ securityGate: audited.gate }),
          })
          const conversationId = `live-k1-grok-${id}`
          const homeBefore = snapshotTree(h.home)
          const turn = async (step: string, call: { tool: string; input: Record<string, unknown> }): Promise<StreamEvent[]> => {
            const marker = `EYAS-K1-GROK-${step}-${id}`
            fake.setHandler(xaiScript(marker, [call, { text: 'NONE' }]))
            const events: StreamEvent[] = []
            for await (const event of provider.stream({
              messages: [{ role: 'user', content: `${marker} Follow the plan.` }],
              metadata: { conversationId, origin: 'interactive', workingDirectory: h.project },
            })) {
              events.push(event)
            }
            assertStreamContract(events)
            return events
          }
          const a = await turn('A', { tool: 'grep', input: { pattern: 'EYAS', path: h.home } })
          const b = await turn('B', { tool: 'list_dir', input: { target_directory: h.home } })
          const c = await turn('C', { tool: 'grep', input: { pattern: projectMarker, path: h.project } })
          await settle()

          const denies = audited.events(conversationId).filter((r) => r.decision === 'deny')
          expect(denies.length, 'one audited deny per refused search').toBe(2)
          for (const row of denies) expect(row.reason ?? '').toMatch(/^Search too broad \[memory-path:search-scope:foreign-memory\]/)
          expect(toolResult(a, 'call_lane_0'), 'the home grep row').toMatchObject({ outcome: 'denied', isError: true })
          expect(toolResult(b, 'call_lane_0'), 'the home list_dir row').toMatchObject({ outcome: 'denied', isError: true })
          expect(toolResult(c, 'call_lane_0'), 'the project grep row').toMatchObject({ outcome: 'success', isError: false })
          const bodies = fake.bodies()
          expect(bodies, 'the project grep reached the model').toContain(projectMarker)
          expect(sentinels().filter((s) => bodies.includes(s)), 'no host or vault sentinel reached the model').toEqual([])
          expect(firedMarkers(h)).toEqual([])
          expect(entriesOf(profile.sessionStorePath), 'the session store was purged').toEqual([])
          expect(diffSnapshots(homeBefore, snapshotTree(h.home)), 'the hostile HOME is untouched').toEqual(NO_CHANGE)
        } finally {
          audited.restore()
        }
      }, 240_000)

      // K3 (R1A-15) on the real binary: the agent's tool list bounds grok's
      // own tools. On a list without run_command and write_file, grok's shell
      // and write ask EYAS (ask mode) and are refused before the gate is
      // asked — nothing is run or written — while a read still works. The
      // same shell call on a list with run_command goes to the gate and runs.
      // A refused permission ends grok's turn, so each step is a turn.
      it('K3: on a list without run_command and write_file, grok\'s shell and write are refused before the gate and nothing runs; a read works, and a list with run_command runs the shell', async () => {
        const id = hex()
        const readMarker = `EYAS-K3-GROK-READ-${id}`
        const readable = join(h.project, `k3-grok-read-${id}.txt`)
        writeFileSync(readable, `${readMarker}\n`)
        const def = (name: string) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } })
        const NARROW = ['memory_search', 'memory_expand', 'read_file']
        const asked: string[] = []
        const provider = createGrokCliProvider({
          profile,
          maxTurns: 4,
          getGovernance: () => ({
            securityGate: {
              validateToolCall: (toolName: string) => {
                asked.push(toolName)
                return allow('live lane: every permission the scope leaves is granted')
              },
            },
          }),
        })
        const homeBefore = snapshotTree(h.home)
        const turn = async (step: string, tools: string[], call: { tool: string; input: Record<string, unknown> }): Promise<StreamEvent[]> => {
          const marker = `EYAS-K3-GROK-${step}-${id}`
          fake.setHandler(xaiScript(marker, [call, { text: 'NONE' }]))
          const events: StreamEvent[] = []
          for await (const event of provider.stream({
            messages: [{ role: 'user', content: `${marker} Follow the plan.` }],
            tools: tools.map(def),
            metadata: { conversationId: `live-k3-grok-${step}-${id}`, origin: 'interactive', workingDirectory: h.project },
          })) {
            events.push(event)
          }
          assertStreamContract(events)
          return events
        }
        const shellFile = join(h.project, `k3-grok-shell-${id}.txt`)
        const writeFile = join(h.project, `k3-grok-write-${id}.txt`)
        const wideFile = join(h.project, `k3-grok-wide-${id}.txt`)
        const a = await turn('A', NARROW, { tool: 'run_terminal_command', input: { command: `touch '${shellFile}'`, description: 'Make a file' } })
        const b = await turn('B', NARROW, { tool: 'write', input: { file_path: writeFile, content: 'written by the model\n' } })
        const c = await turn('C', NARROW, { tool: 'read_file', input: { target_file: readable } })
        const d = await turn('D', [...NARROW, 'run_command'], { tool: 'run_terminal_command', input: { command: `touch '${wideFile}'`, description: 'Make a file' } })
        await settle()

        // grok reports its own rejection text on the row; the outcome is EYAS's.
        for (const [events, label] of [[a, 'shell'], [b, 'write']] as const) {
          expect(toolResult(events, 'call_lane_0'), `the ${label} row`).toMatchObject({ outcome: 'denied', isError: true })
        }
        expect(existsSync(shellFile), 'the refused shell call ran').toBe(false)
        expect(existsSync(writeFile), 'the refused write was written').toBe(false)
        expect(toolResult(c, 'call_lane_0'), 'the read on the narrow list').toMatchObject({ outcome: 'success', isError: false })
        expect(fake.bodies(), 'the read reached the model').toContain(readMarker)
        expect(toolResult(d, 'call_lane_0'), 'the shell on the wide list').toMatchObject({ outcome: 'success', isError: false })
        expect(existsSync(wideFile), 'the shell call of the wide list ran').toBe(true)
        // The gate saw the read and the wide shell call — never the refused ones.
        expect(asked).toEqual(['Read', 'Bash'])
        expect(firedMarkers(h)).toEqual([])
        expect(entriesOf(profile.sessionStorePath), 'the session store was purged').toEqual([])
        expect(diffSnapshots(homeBefore, snapshotTree(h.home)), 'the hostile HOME is untouched').toEqual(NO_CHANGE)
      }, 240_000)

      // K5 (MISSED-M-1) on the real binary: an isolated one-shot honours
      // maxTokens. The fake answers far past the cap; EYAS keeps maxTokens × 4
      // characters, sends session/cancel and ends the call as
      // done{max_tokens}, whatever grok answers to the cancel. No session
      // store is left, and the hostile HOME is untouched.
      it('K5: an isolated one-shot past its maxTokens ends as done{max_tokens} with the answer clipped to maxTokens × 4 characters, and no session store is left', async () => {
        const id = hex()
        const marker = `EYAS-K5-GROK-${id}`
        const answer = `${marker} `.repeat(40)
        fake.setHandler(xaiScript(marker, [{ text: answer }]))
        const homeBefore = snapshotTree(h.home)
        const provider = createGrokCliProvider({ profile })

        const calls = fake.modelCalls().length
        const events: StreamEvent[] = []
        for await (const event of provider.stream({
          messages: [{ role: 'user', content: `${marker} Repeat it.` }],
          isolated: true,
          maxTokens: 5,
          metadata: { origin: 'pipeline', workingDirectory: h.project },
        })) {
          events.push(event)
        }
        await settle()

        assertStreamContract(events)
        expect(fake.modelCalls().length - calls, 'the model was asked').toBeGreaterThan(0)
        const done = events.find((e): e is Extract<StreamEvent, { type: 'done' }> => e.type === 'done')
        expect(done?.response.stopReason).toBe('max_tokens')
        expect(done?.response.content).toEqual([{ type: 'text', text: answer.slice(0, 20) }])
        expect(events.map((e) => (e.type === 'text' ? e.text : '')).join(''), 'what streamed is the clipped answer').toBe(answer.slice(0, 20))
        expect(events.some((e) => e.type === 'error')).toBe(false)
        expect(getIsolationStatus('grok-cli').status).toBe('verified')
        expect(firedMarkers(h)).toEqual([])
        expect(entriesOf(profile.sessionStorePath), 'the session store was purged').toEqual([])
        expect(diffSnapshots(homeBefore, snapshotTree(h.home)), 'the hostile HOME is untouched').toEqual(NO_CHANGE)
      }, 180_000)
    })

    // Kimi runs only where the binary resolves. Its discovery opens a real
    // session (initialize + session/new) under the EYAS home without a model
    // call; an EYAS home that is not signed in may refuse session/new, which
    // proves nothing about isolation either way — the host checks still hold.
    it.skipIf(!KIMI_PRESENT)('Kimi Code CLI — the preflight passes in the EYAS home, and a session start touches nothing on the host and leaves no session store', async () => {
      const resolved = await resolveCliExecutable('kimi-cli', { refresh: true })
      expect(resolved.ok, 'kimi must resolve').toBe(true)
      if (!resolved.ok) return
      proven['kimi-cli'] = resolved.version
      const profile = createAcpProfile('kimi-cli', { homesDir: h.eyasHomes })
      const before = snapshotTree(h.home)
      profile.ensureHome()
      await createAcpVerifier(profile).preflight({ executable: resolved.path, cwd: h.project, roots: [h.project], refresh: true })
      expect(readBackManagedFiles(profile)).toEqual([])
      await createKimiCliProvider({ profile, probeCwd: () => h.project }).fetchModels!().catch(() => [])
      await settle()
      expect(getIsolationStatus('kimi-cli').status).not.toBe('violation')
      expect(entriesOf(profile.sessionStorePath)).toEqual([])
      expect(firedMarkers(h)).toEqual([])
      expect(diffSnapshots(before, snapshotTree(h.home))).toEqual(NO_CHANGE)
    }, 120_000)

    // K4 on the real OpenCode binary (runs where `opencode` resolves:
    // EYAS_OPENCODE_BIN or PATH). EYAS starts `opencode serve` itself, with a
    // local fake model behind an openai-compatible provider and a dummy key.
    // The EYAS memory plugin must load from the managed config, get its key on
    // fd 3 only, and send every memory call as a one-time proof for the
    // session the tool runs in: the legitimate session reads its own
    // conversation's project; a session id the model passes as an argument
    // does not reach EYAS; the model's shell — which holds no key — cannot
    // make a call for any session; and neither that shell's environment nor
    // `ps eww` of the server shows the key.
    const OPENCODE_BIN = process.env.EYAS_OPENCODE_BIN?.trim() || findOnPath(['opencode'], process.env)
    it.skipIf(!OPENCODE_BIN)('OpenCode — the memory plugin loads and gets its key on fd 3 only; the legitimate session reads its own project, the model\'s shell sees no key and cannot call for any session, and a claimed session never widens a call', async () => {
      const { spawn: spawnChild, execFileSync } = await import('node:child_process')
      const { readFileSync } = await import('node:fs')
      const { sql: rawSql } = await import('drizzle-orm')
      const { createOpencodeRunner } = await import('@modules/opencode/opencode-runner.js')
      const { createDeveloperAgent } = await import('@modules/opencode/developer-agent.js')
      const { createOpencodeRoutes } = await import('@modules/opencode/routes.js')
      const { createSessionBindings } = await import('@modules/opencode/memory-bridge.js')
      const { createPluginTokenRegistry } = await import('@modules/opencode/plugin-tokens.js')
      const { normalizeOpencodeSettings } = await import('@modules/opencode/settings-store.js')
      const { createProcessRunner } = await import('@modules/studio/cli-runner.js')
      const { createMemoryTools } = await import('@modules/tools/builtin/memory-tools.js')
      const { createMemoryV2Tables } = await import('@modules/memory/v2/schema.js')
      const { probeSqliteCapabilities } = await import('@core/db/sqlite-capabilities.js')
      const { getRawFromDrizzle } = await import('../helpers/test-db')

      const id = hex()
      const marker = `EYAS-K4-OPENCODE-${id}`
      const out = join(h.root, `k4-opencode-${id}`)
      const workspace = join(h.project, `k4-opencode-ws-${id}`)
      const home = join(h.eyasHomes, 'opencode')
      for (const dir of [out, workspace]) mkdirSync(dir, { recursive: true })
      mkdirSync(home, { recursive: true, mode: 0o700 })

      // EYAS memory: project P holds a ledger hit, project Q a victim hit.
      const db = createMemoryDb()
      createMemoryV2Tables(db, probeSqliteCapabilities(getRawFromDrizzle(db)))
      db.run(rawSql`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, type_id TEXT)`)
      db.run(rawSql`INSERT INTO projects (id, name, type_id) VALUES ('P', 'Own', 'T'), ('Q', 'Victim', 'T')`)
      db.run(rawSql`CREATE TABLE conversations (id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT)`)
      db.run(rawSql`INSERT INTO conversations (id, project_id, user_id) VALUES ('conv-own', 'P', 'u1'), ('conv-victim', 'Q', 'u2')`)
      const ownHit = { id: `gs:own-${id}`, source: 'gist', text: `own ledger ${id}`, score: 0.9 }
      const victimHit = { id: `gs:victim-${id}`, source: 'gist', text: `victim ledger ${id}`, score: 0.9 }
      const retrieved: Array<string | null> = []
      const service = {
        db,
        retrieve: async (opts: { projectId: string | null }) => {
          retrieved.push(opts.projectId)
          return opts.projectId === 'P' ? [ownHit] : opts.projectId === 'Q' ? [victimHit] : []
        },
        expand: () => null,
      }
      const registry = createToolRegistry()
      for (const tool of createMemoryTools(() => service as never)) registry.register(tool)
      const executor = createToolExecutor(registry, {
        authorization: {
          getSecurityGate: () => ({ validateToolCall: async () => allow('live lane: read-only memory') }) as never,
          getAbilityForRole: () => ({ can: () => true }),
        },
      })

      // Every key EYAS mints (the test's only way to know it).
      const tokens = createPluginTokenRegistry()
      const minted: string[] = []
      const mint = tokens.mint.bind(tokens)
      tokens.mint = (kind, owner) => {
        const m = mint(kind, owner)
        minted.push(m.key)
        return m
      }
      const sessions = createSessionBindings()
      const lanLogger = pino({ level: 'silent' })
      const app = new Hono()
      // What reaches EYAS's memory routes, as sent.
      const eyasCalls: Array<{ path: string; authorization: string; body: string }> = []
      app.use('/api/v1/opencode/memory/*', async (c, next) => {
        eyasCalls.push({ path: c.req.path, authorization: c.req.header('authorization') ?? '', body: await c.req.text() })
        await next()
      })
      createOpencodeRoutes(app, {
        runner: createProcessRunner(),
        load: () => normalizeOpencodeSettings({ cliPath: OPENCODE_BIN }),
        save: () => undefined,
        pty: {} as never,
        opencode: {} as never,
        getTools: () => ({ registry, executor }),
        pluginTokens: tokens,
        sessions,
        resolveTuiCommand: () => ({ file: 'opencode', args: [], env: {} }),
        logger: lanLogger,
      })
      const eyas = await serveOnLoopback(app.fetch)

      // The fake model: memory_search (with another session's id slipped into
      // its arguments), then a shell that dumps its environment, reads fd 3 and
      // tries the memory route for the victim session with no proof and with
      // a forged one, then the answer.
      const victimSession = `ses_victim_${id}`
      const FORGED_BEARER = 'Bearer eyas-ocs.e30.AAAA'
      const shell = [
        `env > '${join(out, 'shell-env.txt')}'`,
        `(cat <&3) > '${join(out, 'shell-fd3.txt')}' 2>&1`,
        `curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{"query":"ledger","sessionId":"${victimSession}"}' "$EYAS_OPENCODE_EYAS_URL/api/v1/opencode/memory/search" > '${join(out, 'no-proof.txt')}'`,
        `curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -H 'Authorization: ${FORGED_BEARER}' -d '{"query":"ledger","sessionId":"${victimSession}"}' "$EYAS_OPENCODE_EYAS_URL/api/v1/opencode/memory/search" > '${join(out, 'forged.txt')}'`,
        'echo done',
      ].join('; ')
      const steps: Array<{ name: string; args: Record<string, unknown> } | { text: string }> = [
        { name: 'memory_search', args: { query: 'ledger', sessionId: victimSession } },
        { name: 'bash', args: { command: shell, description: 'probe' } },
        { text: 'DONE' },
      ]
      const sse = (delta: Record<string, unknown>, finish: string) => {
        const base = { id: 'chatcmpl-eyas-k4', object: 'chat.completion.chunk', created: 0, model: 'fake' }
        const chunks = [
          { ...base, choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] },
          { ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }] },
          { ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        ]
        return { headers: { 'content-type': 'text/event-stream' }, body: chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n' }
      }
      const toolsSeen: string[][] = []
      const fake = await startFakeModel((req) => {
        if (!req.path.endsWith('/chat/completions')) return { status: 404, body: '{}' }
        const tools: string[] = (req.json?.tools ?? []).map((t: any) => t?.function?.name)
        // OpenCode's own side calls (a session title) carry no tools.
        if (!tools.includes('bash') || !JSON.stringify(req.json?.messages ?? []).includes(marker)) return sse({ content: 'EYAS K4' }, 'stop')
        toolsSeen.push(tools)
        const done = (req.json?.messages ?? []).filter((m: any) => m?.role === 'tool').length
        const step = steps[done]
        if (step && 'name' in step) {
          return sse({ content: null, tool_calls: [{ index: 0, id: `call_k4_${done}`, type: 'function', function: { name: step.name, arguments: JSON.stringify(step.args) } }] }, 'tool_calls')
        }
        return sse({ content: step && 'text' in step ? step.text : 'DONE' }, 'stop')
      })

      let servePid: number | undefined
      const config = {
        $schema: 'https://opencode.ai/config.json',
        model: 'eyasfake/fake',
        provider: { eyasfake: { npm: '@ai-sdk/openai-compatible', name: 'EYAS lane fake', options: { baseURL: `${fake.url}/v1`, apiKey: 'eyas-live-lane-dummy-key' }, models: { fake: { name: 'fake' } } } },
      }
      const runner = createOpencodeRunner({
        runner: createProcessRunner(),
        getSettings: () => normalizeOpencodeSettings({ cliPath: OPENCODE_BIN }),
        logger: lanLogger,
        home,
        workspacesRoot: join(h.root, 'eyas', 'workspaces'),
        eyasBaseUrl: eyas.url,
        pluginTokens: tokens,
        startTimeoutMs: 60_000,
        // The real spawn — fd 3 and all — plus the fake provider (not something EYAS configures).
        spawnProcess: (command, args, options) => {
          const child = spawnChild(command, [...args], { ...options, env: { ...options.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_DISABLE_MODELS_FETCH: '1' } })
          servePid = child.pid
          return child
        },
      })
      const agent = createDeveloperAgent({
        getClient: async () => (await runner.ensureServer()).client,
        getSecurityGate: () => ({ validateToolCall: () => allow() }),
        resolveCwd: () => workspace,
        home,
        sessions,
        getServeTokenId: () => runner.serveTokenId(),
        logger: lanLogger,
      })

      try {
        await runner.ensureServer()
        expect(minted, 'one key for the server').toHaveLength(1)
        const key = minted[0]!
        expect(runner.serveTokenId(), 'the key was handed over on fd 3').not.toBeNull()
        // A victim session of another conversation, bound under the same server key.
        sessions.bind(runner.serveTokenId()!, victimSession, { conversationId: 'conv-victim', userId: 'u2', turnId: `turn-victim-${id}` })

        // `ps eww` of the server shows its environment — the fd-3 marker, never the key.
        const psOut = execFileSync('ps', ['eww', '-p', String(servePid)], { encoding: 'utf8' })
        expect(psOut, 'ps shows the environment of the server').toContain('EYAS_OPENCODE_KEY_FD=3')
        expect(psOut.includes(key), 'the key is in the server\'s environment').toBe(false)
        // Documented residual (automation/opencode.md "Limits that remain"):
        // OpenCode reads its server password only from its environment, so any
        // process of the same OS user sees it. When this stops holding, the
        // handbook's limit can go.
        expect(psOut, 'the server password is readable from the server\'s environment').toMatch(/OPENCODE_SERVER_PASSWORD=[0-9a-f]{48}/)

        const result = await agent.run({ prompt: `${marker} run the plan`, conversationId: 'conv-own', userId: 'u1', turnId: `turn-own-${id}` })
        expect(result.error ?? '', 'the task ran').toBe('')
        expect(result.ok).toBe(true)

        // The plugin loaded: OpenCode offered its model EYAS's memory tools.
        expect(toolsSeen[0], 'OpenCode offered memory_search').toContain('memory_search')
        expect(toolsSeen[0]).toContain('memory_expand')

        // The legitimate call: one proof, for the task's own session, read its own project only.
        const proven = eyasCalls.filter((c) => c.authorization.startsWith('Bearer eyas-ocs.') && c.authorization !== FORGED_BEARER)
        expect(proven, 'the plugin\'s call reached EYAS with a session proof').toHaveLength(1)
        expect(proven[0]!.body, 'the model\'s session argument never left the plugin').not.toContain(victimSession)
        expect(proven[0]!.authorization.includes(key), 'the key itself travelled').toBe(false)
        expect(tokens.check(proven[0]!.authorization.slice(7)), 'the proof is used up').toBeNull()
        expect(retrieved.filter((p) => p === 'Q'), 'nothing was read for the victim session').toEqual([])
        expect(retrieved, 'the call read the own conversation\'s project').toContain('P')
        expect(fake.bodies(), 'the own hit reached the model').toContain(ownHit.id)
        expect(fake.bodies().includes(victimHit.id), 'the victim hit reached the model').toBe(false)

        // The model's shell: no key in its environment or on fd 3, and no call it made got through.
        const shellEnv = readFileSync(join(out, 'shell-env.txt'), 'utf8')
        expect(shellEnv.includes(key), 'the key is in the shell environment').toBe(false)
        expect(shellEnv).toMatch(/^EYAS_OPENCODE_KEY_FD=$/m)
        expect(shellEnv).toMatch(/^OPENCODE_SERVER_PASSWORD=$/m)
        expect(readFileSync(join(out, 'shell-fd3.txt'), 'utf8').includes(key), 'the shell read the key from fd 3').toBe(false)
        expect(readFileSync(join(out, 'no-proof.txt'), 'utf8').trim(), 'a call without a proof').toBe('401')
        expect(readFileSync(join(out, 'forged.txt'), 'utf8').trim(), 'a forged proof').toBe('401')
        expect(eyasCalls.filter((c) => c.body.includes(victimSession)), 'both shell attempts reached EYAS').toHaveLength(2)

        // The key is on no file of the OpenCode home, and the plugin sits where its import resolves.
        expect(filesContaining(home, [key])).toEqual([])
        expect(filesContaining(home, ['EYAS_OPENCODE_KEY_FD']).some((f) => f.endsWith('config/opencode/eyas/eyas-memory.ts'))).toBe(true)
        expect(firedMarkers(h)).toEqual([])
      } finally {
        await runner.stop()
        await fake.close()
        await eyas.close()
      }
      expect(tokens.size(), 'the key died with its server').toBe(0)
    }, 240_000)

    // K4 for the OpenCode terminal: the TUI runs its own server in-process;
    // EYAS's PTY factory hands the TUI its own key on fd 3 (never the
    // environment), and the plugin inside proves the TUI's own session.
    it.skipIf(!OPENCODE_BIN)('OpenCode terminal — the TUI gets its own key on fd 3 through the PTY, never in its environment, and its plugin proves its own session', async () => {
      const { execFileSync } = await import('node:child_process')
      const { createPtyManager } = await import('@modules/opencode/pty-manager.js')
      const { unixPtyFactory, isUnixPtyAvailable } = await import('@modules/opencode/unix-pty.js')
      const { createPluginTokenRegistry } = await import('@modules/opencode/plugin-tokens.js')
      const { buildTuiCommand, writeOpencodeManagedFiles } = await import('@modules/opencode/isolation.js')
      expect(isUnixPtyAvailable(), 'a POSIX PTY').toBe(true)

      const id = hex()
      const marker = `EYAS-K4-TUI-${id}`
      const workspace = join(h.project, `k4-tui-ws-${id}`)
      const home = join(h.eyasHomes, 'opencode')
      mkdirSync(workspace, { recursive: true })
      mkdirSync(home, { recursive: true, mode: 0o700 })
      writeOpencodeManagedFiles(home)

      const tokens = createPluginTokenRegistry()
      const minted: string[] = []
      const mint = tokens.mint.bind(tokens)
      tokens.mint = (kind, owner) => {
        const m = mint(kind, owner)
        minted.push(m.key)
        return m
      }
      const proven: Array<{ tokenId: string; sessionId: string } | null> = []
      const eyas = await serveOnLoopback(async (req) => {
        proven.push(tokens.redeem((req.headers.get('authorization') ?? '').replace(/^Bearer /, '')))
        return new Response(JSON.stringify({ text: `TUI memory ${id}`, isError: false }), { headers: { 'content-type': 'application/json' } })
      })
      const sse = (delta: Record<string, unknown>, finish: string) => {
        const base = { id: 'chatcmpl-eyas-k4-tui', object: 'chat.completion.chunk', created: 0, model: 'fake' }
        const chunks = [
          { ...base, choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] },
          { ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }] },
          { ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        ]
        return { headers: { 'content-type': 'text/event-stream' }, body: chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n' }
      }
      const fake = await startFakeModel((req) => {
        if (!req.path.endsWith('/chat/completions')) return { status: 404, body: '{}' }
        const tools: string[] = (req.json?.tools ?? []).map((t: any) => t?.function?.name)
        if (!tools.includes('memory_search') || !JSON.stringify(req.json?.messages ?? []).includes(marker)) return sse({ content: 'EYAS K4 TUI' }, 'stop')
        const done = (req.json?.messages ?? []).filter((m: any) => m?.role === 'tool').length
        return done === 0
          ? sse({ content: null, tool_calls: [{ index: 0, id: 'call_k4_tui', type: 'function', function: { name: 'memory_search', arguments: JSON.stringify({ query: 'ledger' }) } }] }, 'tool_calls')
          : sse({ content: 'DONE' }, 'stop')
      })

      // The TUI's own in-process server listens on a free port of its own,
      // with a password of its own — the command EYAS builds for a terminal.
      const probe = await serveOnLoopback(() => new Response('')) // reserve, read and release a free port
      const port = new URL(probe.url).port
      await probe.close()
      const tui = await buildTuiCommand({ file: OPENCODE_BIN!, home, eyasBaseUrl: eyas.url, workspacesRoot: join(h.root, 'eyas', 'workspaces'), pickPort: async () => Number(port) })
      const env = tui.env
      const password = env.OPENCODE_SERVER_PASSWORD!
      expect(password, 'the terminal has a password of its own').toMatch(/^[0-9a-f]{48}$/)
      env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        model: 'eyasfake/fake',
        provider: { eyasfake: { npm: '@ai-sdk/openai-compatible', name: 'EYAS lane fake', options: { baseURL: `${fake.url}/v1`, apiKey: 'eyas-live-lane-dummy-key' }, models: { fake: { name: 'fake' } } } },
      })
      env.OPENCODE_DISABLE_MODELS_FETCH = '1'
      const pty = createPtyManager({ spawn: unixPtyFactory(), logger: pino({ level: 'silent' }), maxSessions: 1, fallbackCwd: workspace, pluginTokens: tokens })
      const rec = pty.create(
        { userId: 'u1', conversationId: `live-k4-tui-${id}`, kind: 'tui', cwd: workspace, workingDirectories: [workspace], cols: 120, rows: 40 },
        { file: tui.file, args: tui.args, env },
      )
      pty.attach(rec.id, { send: () => undefined, closed: () => undefined })
      const auth = { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` }
      const base = `http://127.0.0.1:${port}`
      try {
        expect(minted, 'one key for the TUI').toHaveLength(1)
        const key = minted[0]!
        let up = false
        for (let i = 0; i < 120 && !up; i++) {
          up = await fetch(`${base}/global/health`, { headers: auth }).then((r) => r.ok, () => false)
          if (!up) await new Promise((r) => setTimeout(r, 500))
        }
        expect(up, 'the TUI\'s server answered').toBe(true)
        const psOut = execFileSync('ps', ['eww', '-p', String(rec.pid)], { encoding: 'utf8' })
        expect(psOut, 'ps shows the environment of the TUI').toContain('EYAS_OPENCODE_KEY_FD=3')
        expect(psOut.includes(key), 'the key is in the TUI\'s environment').toBe(false)

        const q = `?directory=${encodeURIComponent(workspace)}`
        const session = await (await fetch(`${base}/session${q}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' })).json() as { id: string }
        const res = await fetch(`${base}/session/${session.id}/message${q}`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ model: { providerID: 'eyasfake', modelID: 'fake' }, parts: [{ type: 'text', text: `${marker} search` }] }),
          signal: AbortSignal.timeout(120_000),
        })
        expect(res.status).toBe(200)
        expect(proven, 'the TUI plugin\'s call was a valid proof for its own session').toEqual([{ tokenId: expect.any(String), sessionId: session.id }])
        expect(fake.bodies(), 'the answer reached the TUI\'s model').toContain(`TUI memory ${id}`)
      } finally {
        pty.destroyAll()
        await fake.close()
        await eyas.close()
      }
      expect(tokens.size(), 'the TUI\'s key died with its PTY').toBe(0)
    }, 240_000)

    // K10 on the real OpenCode binary: the window of the model a task runs
    // comes from OpenCode's own /config/providers `limit`, and the task's
    // recalled memory is sized from it by the same budgetForWindow as every
    // other prompt — more on a 1M-token model, less on a 20k one, the
    // baseline (memory.index.budgetChars) for a model OpenCode lists without
    // a usable limit — and the block reaches the model as system text.
    it.skipIf(!OPENCODE_BIN)('OpenCode — a task\'s recalled memory is sized for the window OpenCode lists for its model, like every other prompt', async () => {
      const { createOpencodeRunner } = await import('@modules/opencode/opencode-runner.js')
      const { createDeveloperAgent, recallBudgetForWindow } = await import('@modules/opencode/developer-agent.js')
      const { createPluginTokenRegistry } = await import('@modules/opencode/plugin-tokens.js')
      const { normalizeOpencodeSettings } = await import('@modules/opencode/settings-store.js')
      const { createProcessRunner } = await import('@modules/studio/cli-runner.js')
      const { SCALE_MAX } = await import('@modules/prompt-wizard/token-budget.js')
      const { spawn: spawnChild } = await import('node:child_process')

      const id = hex()
      const workspace = join(h.project, `k10-opencode-ws-${id}`)
      const home = join(h.eyasHomes, 'opencode')
      mkdirSync(workspace, { recursive: true })
      mkdirSync(home, { recursive: true, mode: 0o700 })
      const BASELINE = 2_400
      const WINDOWS = { wide: 1_000_000, small: 20_000 } as const

      const fake = await startFakeModel((req) => {
        if (!req.path.endsWith('/chat/completions')) return { status: 404, body: '{}' }
        const base = { id: 'chatcmpl-eyas-k10', object: 'chat.completion.chunk', created: 0, model: 'fake' }
        const chunks = [
          { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'DONE' }, finish_reason: null }] },
          { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
          { ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        ]
        return { headers: { 'content-type': 'text/event-stream' }, body: chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n' }
      })
      const eyas = await serveOnLoopback(() => new Response('{}', { status: 404 }))
      const config = {
        $schema: 'https://opencode.ai/config.json',
        model: 'eyasfake/wide',
        provider: { eyasfake: {
          npm: '@ai-sdk/openai-compatible',
          name: 'EYAS lane fake',
          options: { baseURL: `${fake.url}/v1`, apiKey: 'eyas-live-lane-dummy-key' },
          models: {
            wide: { name: 'wide', limit: { context: WINDOWS.wide, output: 32_000 } },
            small: { name: 'small', limit: { context: WINDOWS.small, output: 4_000 } },
            nolimit: { name: 'nolimit' },
          },
        } },
      }
      const lanLogger = pino({ level: 'silent' })
      const runner = createOpencodeRunner({
        runner: createProcessRunner(),
        getSettings: () => normalizeOpencodeSettings({ cliPath: OPENCODE_BIN }),
        logger: lanLogger,
        home,
        workspacesRoot: join(h.root, 'eyas', 'workspaces'),
        eyasBaseUrl: eyas.url,
        pluginTokens: createPluginTokenRegistry(),
        startTimeoutMs: 60_000,
        // The real spawn plus the fake provider (not something EYAS configures).
        spawnProcess: (command, args, options) => spawnChild(command, [...args], { ...options, env: { ...options.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_DISABLE_MODELS_FETCH: '1' } }),
      })
      const recalled: Array<{ model: string; budgetChars: number }> = []
      const agent = createDeveloperAgent({
        getClient: async () => (await runner.ensureServer()).client,
        getSecurityGate: () => ({ validateToolCall: () => allow() }),
        getRecall: () => async (input) => {
          const model = String(input.profile.modelId)
          recalled.push({ model, budgetChars: input.budgetChars })
          const content = `<eyas-memory>\n- (gs:k10) EYAS-K10-${id}-${model}\n</eyas-memory>`
          return { content, ids: ['gs:k10'], standing: [], retrieved: ['gs:k10'], expanded: [], dropped: 0, chars: content.length, tokens: 10, budgetChars: input.budgetChars }
        },
        recallBudgetChars: () => BASELINE,
        resolveCwd: () => workspace,
        home,
        logger: lanLogger,
      })

      try {
        // What this OpenCode reports for the configured models.
        const catalog = await (await runner.ensureServer()).client.forDirectory(workspace).listProviders()
        const listed = catalog.providers.find((p) => p.id === 'eyasfake')?.models ?? []
        expect(listed.find((m) => m.id === 'wide')?.contextWindow, 'OpenCode lists the wide model\'s window').toBe(WINDOWS.wide)
        expect(listed.find((m) => m.id === 'small')?.contextWindow, 'OpenCode lists the small model\'s window').toBe(WINDOWS.small)
        expect(listed.find((m) => m.id === 'nolimit')?.contextWindow, 'no usable window for a model without a limit').toBeUndefined()

        for (const modelID of ['wide', 'small', 'nolimit']) {
          const result = await agent.run({ prompt: `EYAS-K10 task ${modelID}`, conversationId: `conv-k10-${modelID}`, userId: 'u1', model: { providerID: 'eyasfake', modelID } })
          expect(result.error ?? '', `the ${modelID} task ran`).toBe('')
          expect(result.effective?.model, `the ${modelID} model answered`).toEqual({ providerID: 'eyasfake', modelID })
        }
        const capOf = (model: string) => recalled.find((r) => r.model === model)?.budgetChars
        expect(capOf('wide'), '1M tokens: SCALE_MAX × memory.index.budgetChars').toBe(BASELINE * SCALE_MAX)
        expect(capOf('wide')).toBe(recallBudgetForWindow(WINDOWS.wide, BASELINE))
        expect(capOf('small'), '20k tokens: less than the baseline').toBe(recallBudgetForWindow(WINDOWS.small, BASELINE))
        expect(capOf('small')!).toBeLessThan(BASELINE)
        expect(capOf('nolimit'), 'no window: the baseline').toBe(BASELINE)
        for (const model of ['wide', 'small', 'nolimit']) {
          expect(fake.bodies(), `the ${model} task's memory reached the model`).toContain(`EYAS-K10-${id}-${model}`)
        }
        expect(firedMarkers(h)).toEqual([])
      } finally {
        await runner.stop()
        await fake.close()
        await eyas.close()
      }
    }, 240_000)

    // The release gate's memory: the lane passes only when the record names
    // the binaries it just proved (and doctor then stops warning about drift).
    it('the verified-version record names the binaries this lane ran on', () => {
      const allowlist = loadClaudeHostWritesAllowlist()
      for (const [cli, version] of Object.entries(proven) as Array<[IsolationCliId, string | null]>) {
        expect(version, `${cli} reported no version`).toBeTruthy()
        expect(CLI_VERIFIED_VERSIONS[cli].version, `record ${cli} ${version} in src/modules/model/cli-runtime/verified-versions.ts once every case above passed`).toBe(version)
      }
      expect(allowlist.binaryVersion, 'record the Claude Code version in claude-host-writes.allowlist.json').toBe(proven['claude-code'])
    })
  })

  describe.skipIf(!PAID)('paid', () => {
    let h: HostileHome
    const savedHome = process.env.HOME

    beforeAll(() => {
      h = buildHostileHome()
    })
    afterAll(() => {
      if (savedHome === undefined) delete process.env.HOME
      else process.env.HOME = savedHome
      resetPathPolicyForTests()
      h?.cleanup()
    })

    // A14/F1 paid canary on the operator's own sign-in: a real turn that runs
    // one command carrying the canary. The answer is NONE; the init message
    // is verified on the resolved binary; no transcript, no content-bearing
    // file and no canary is left in the hostile HOME (shell snapshots and
    // ~/.claude.json included), and every host write — the login refresh of a
    // real sign-in included — is inside the allowlist. Cost: one short haiku
    // turn with one tool call.
    it('Claude Code — the canary turn on the operator\'s sign-in answers NONE and leaves no content on the host', async () => {
      const resolved = await resolveClaudeRuntime({ refresh: true })
      expect(resolved.ok, 'a Claude Code binary must resolve for the live lane').toBe(true)
      if (!resolved.ok) return
      const runtime = toClaudeRuntime(resolved)
      const canary = `EYAS-A14-PAID-CANARY-${hex()}`
      process.env.HOME = h.home
      installPathPolicy(createPathPolicy(pathPolicyOptionsFromInstance(resolveInstance({ ensureDirs: false }), { homeDir: h.home, foreignMemoryPaths: [h.vault] })))

      const provider = createClaudeCodeProvider({
        runtime: { ...runtime, version: null },
        maxTurns: 3,
        getGovernance: () => ({ securityGate: { validateToolCall: () => allow(), checkMemoryPath: policyMemoryPathHookCheck } }),
      })
      const before = snapshotTree(h.home)
      const claudeJsonBefore = readClaudeJson(h.home)
      let reply = ''
      for await (const event of provider.stream({
        model: 'claude-code-haiku',
        messages: [{ role: 'user', content: `Use the Bash tool to run exactly: echo ${canary}\nThen reply with exactly the word NONE and nothing else.` }],
        metadata: { conversationId: `live-a14-paid-${hex()}`, origin: 'interactive', workingDirectory: h.project },
      })) {
        if (event.type === 'text') reply += event.text
      }
      await settle()

      expect(reply.trim()).toMatch(/NONE/)
      const status = getIsolationStatus('claude-code')
      expect(status.status).toBe('verified')
      expect(status.runtime?.version, 'claude_code_version of the init message === the resolver version').toBe(runtime.version)
      expect(filesContaining(h.home, [canary]), 'the canary is in no host file').toEqual([])
      expect(filesContaining(h.eyasHomes, [canary])).toEqual([])
      expect(firedMarkers(h)).toEqual([])
      expectClaudeHostWritesAllowed(h, before, claudeJsonBefore, [canary, ...Object.values(h.sentinels)])
    }, 180_000)

    // A14 paid Grok canary: a real grok turn under the EYAS-owned GROK_HOME on
    // an EYAS-stored API key runs one command carrying the canary. After the
    // purge the canary is in no EYAS home and the hostile HOME is untouched.
    // Needs EYAS_LIVE_XAI_API_KEY.
    it.skipIf(!process.env.EYAS_LIVE_XAI_API_KEY)('Grok CLI — the canary turn on a real key leaves the canary in no EYAS home and nothing on the host', async () => {
      const executable = await resolveCliExecutable('grok-cli', { refresh: true })
      expect(executable.ok, 'a grok binary must resolve for this case').toBe(true)
      if (!executable.ok) return
      const canary = `EYAS-A14-PAID-GROK-CANARY-${hex()}`
      const key = process.env.EYAS_LIVE_XAI_API_KEY
      const profile = createAcpProfile('grok-cli', { homesDir: h.eyasHomes, extraEnv: () => ({ XAI_API_KEY: key }) })
      const provider = createGrokCliProvider({
        profile,
        maxTurns: 4,
        getGovernance: () => ({ securityGate: { validateToolCall: () => allow('live lane: every permission granted') } }),
      })
      const before = snapshotTree(h.home)
      let reply = ''
      for await (const event of provider.stream({
        system: 'You are a test harness. Follow the user instruction exactly.',
        messages: [{ role: 'user', content: `Use your shell tool to run exactly: echo ${canary}\nThen reply with exactly the word NONE and nothing else.` }],
        metadata: { conversationId: `live-a14-paid-grok-${hex()}`, origin: 'interactive', workingDirectory: h.project },
      })) {
        if (event.type === 'text') reply += event.text
      }
      await settle()
      expect(reply.trim()).toMatch(/NONE/)
      expect(entriesOf(profile.sessionStorePath)).toEqual([])
      expect(filesContaining(h.eyasHomes, [canary]), 'the canary is in no EYAS home after the purge').toEqual([])
      expect(filesContaining(h.home, [canary])).toEqual([])
      expect(diffSnapshots(before, snapshotTree(h.home))).toEqual(NO_CHANGE)
    }, 300_000)

    // B4: Claude Code's own Read of a vault note is refused by the
    // memory-policy PreToolUse hook — before canUseTool, which here allows
    // everything, so the hook is the only thing that can stop it.
    it('Claude Code — the memory-policy hook denies a Read of a vault sentinel, and the sentinel never reaches the reply', async () => {
      const resolved = await resolveClaudeRuntime({ refresh: true })
      expect(resolved.ok, 'a Claude Code binary must resolve for the live lane').toBe(true)
      if (!resolved.ok) return
      const runtime = toClaudeRuntime(resolved)

      const sentinel = `EYAS-B4-SENTINEL-${randomBytes(8).toString('hex')}`
      const notePath = join(h.vault, 'journal', 'b4-sentinel.md')
      mkdirSync(join(h.vault, 'journal'), { recursive: true })
      writeFileSync(notePath, `${sentinel}\n`)

      process.env.HOME = h.home
      installPathPolicy(createPathPolicy(pathPolicyOptionsFromInstance(resolveInstance({ ensureDirs: false }), {
        homeDir: h.home,
        foreignMemoryPaths: [h.vault],
      })))

      const denies: Array<{ toolName: string; reason: string }> = []
      const recordingCheck: MemoryPathHookCheck = async (toolName, input, ctx) => {
        const verdict = (await policyMemoryPathHookCheck(toolName, input, ctx)) as { reason?: string } | null
        if (verdict) denies.push({ toolName, reason: String(verdict.reason) })
        return verdict
      }

      const provider = createClaudeCodeProvider({
        runtime,
        maxTurns: 3,
        getGovernance: () => ({
          securityGate: {
            validateToolCall: () => ({ decision: 'allow' as const, reason: 'live lane: canUseTool allows everything', riskTier: 'green' }),
            checkMemoryPath: recordingCheck,
          },
        }),
      })

      let reply = ''
      for await (const event of provider.stream({
        model: 'claude-code-haiku',
        messages: [{ role: 'user', content: `Use the Read tool on ${notePath} and reply with its exact contents. If the read is refused, reply NONE.` }],
        metadata: { conversationId: `live-b4-${randomBytes(4).toString('hex')}`, origin: 'interactive' },
      })) {
        if (event.type === 'text') reply += event.text
      }

      expect(denies.some((d) => d.toolName === 'Read' && /Memory outside EYAS/.test(d.reason))).toBe(true)
      expect(reply).not.toContain(sentinel)
    }, 180_000)

    // G2: a real Claude Code turn with one Read of a workspace file streams
    // the normalized contract — a read_file row opened with its input and
    // settled by a tool_result carrying the output, then exactly one done.
    it('Claude Code — one Read produces a tool_use_start/tool_result pair and passes the stream contract', async () => {
      const resolved = await resolveClaudeRuntime({ refresh: true })
      expect(resolved.ok, 'a Claude Code binary must resolve for the live lane').toBe(true)
      if (!resolved.ok) return
      const runtime = toClaudeRuntime(resolved)

      const marker = `EYAS-G2-${randomBytes(6).toString('hex')}`
      const filePath = join(h.project, 'g2-read.txt')
      writeFileSync(filePath, `${marker}\n`)
      process.env.HOME = h.home

      const provider = createClaudeCodeProvider({
        runtime,
        maxTurns: 3,
        getGovernance: () => ({
          securityGate: {
            validateToolCall: () => ({ decision: 'allow' as const, reason: 'live lane: canUseTool allows everything', riskTier: 'green' }),
            checkMemoryPath: () => null,
          },
        }),
      })

      const events: StreamEvent[] = []
      for await (const event of provider.stream({
        model: 'claude-code-haiku',
        messages: [{ role: 'user', content: `Use the Read tool on ${filePath} and reply with its exact contents.` }],
        metadata: { conversationId: `live-g2-${randomBytes(4).toString('hex')}`, origin: 'interactive', workingDirectory: h.project },
      })) {
        events.push(event)
      }

      assertStreamContract(events)
      const read = events.find((e): e is Extract<StreamEvent, { type: 'tool_use_start' }> => e.type === 'tool_use_start' && e.name === 'read_file')
      expect(read?.rawName).toBe('Read')
      expect(read?.input).toMatchObject({ path: filePath })
      const result = events.find((e): e is Extract<StreamEvent, { type: 'tool_result' }> => e.type === 'tool_result' && e.toolUseId === read?.id)
      expect(result).toMatchObject({ outcome: 'success', executedBy: 'provider', isError: false })
      expect(result?.content).toContain(marker)
      expect(events.some((e) => e.type === 'text')).toBe(true)
    }, 180_000)

    // B5: grok's own terminal tool runs under EYAS's kernel sandbox profile.
    // Every permission is granted here, so the kernel is the only thing that
    // can stop `cat` of a registered vault note; grok must still start and
    // answer. The vault lies outside the OS temp dir (the base profiles grant
    // temp dirs, A1 spike note) and outside every real store; it is removed
    // afterwards. Needs a grok binary and EYAS_LIVE_XAI_API_KEY.
    it.skipIf(!process.env.EYAS_LIVE_XAI_API_KEY)('Grok CLI — the kernel sandbox profile keeps its shell out of a registered vault, and grok still answers', async () => {
      const executable = await resolveCliExecutable('grok-cli', { refresh: true })
      expect(executable.ok, 'a grok binary must resolve for this case').toBe(true)
      if (!executable.ok) return

      const vault = mkdtempSync(join(process.cwd(), '.live-b5-vault-'))
      const sentinel = `EYAS-B5-SENTINEL-${randomBytes(8).toString('hex')}`
      const notePath = join(vault, 'b5-sentinel.md')
      writeFileSync(notePath, `${sentinel}\n`)
      setDefaultSandboxHostForTests(null)
      try {
        installPathPolicy(createPathPolicy(pathPolicyOptionsFromInstance(resolveInstance({ ensureDirs: false }), {
          homeDir: h.home,
          foreignMemoryPaths: [vault],
        })))
        const key = process.env.EYAS_LIVE_XAI_API_KEY
        const profile = createAcpProfile('grok-cli', { homesDir: h.eyasHomes, extraEnv: () => ({ XAI_API_KEY: key }) })
        const provider = createGrokCliProvider({
          profile,
          maxTurns: 4,
          sandbox: { mode: () => 'required' },
          getGovernance: () => ({
            securityGate: {
              validateToolCall: () => ({ decision: 'allow' as const, reason: 'live lane: every permission granted', riskTier: 'green' }),
              checkMemoryPath: () => null,
            },
          }),
        })

        let reply = ''
        let done = false
        for await (const event of provider.stream({
          messages: [{ role: 'user', content: `Use your shell tool to run exactly: cat ${notePath}\nThen reply with exactly what it printed, or NONE if it failed.` }],
          metadata: { conversationId: `live-b5-${randomBytes(4).toString('hex')}`, origin: 'interactive', workingDirectory: h.project },
        })) {
          if (event.type === 'text') reply += event.text
          if (event.type === 'done') done = true
        }
        expect(done).toBe(true)
        expect(reply).not.toContain(sentinel)
      } finally {
        setDefaultSandboxHostForTests(PINNED_SANDBOX_HOST)
        rmSync(vault, { recursive: true, force: true })
      }
    }, 300_000)

    // B14 paid matrix on the operator's own sign-in: a real model is asked to
    // (a) Read a store registered only in security.foreignMemoryPaths, (b) cat
    // it through Bash, (c) Write a note into the EYAS vault and (d) Read a
    // workspace file, through the real security gate. The reply carries the
    // workspace file and never the sentinel, the refusals are audited
    // memory-path denies, both stores are unchanged, and the host writes stay
    // inside the allowlist. The store lies outside the OS temp dir (the
    // kernel sandbox profiles grant temp dirs) and is removed afterwards.
    // Cost: one short haiku turn with up to four tool calls.
    it('Claude Code — the memory-sovereignty matrix (B14) on the operator\'s sign-in: the registered store and the EYAS vault are refused and audited, and the reply carries the workspace file, never the sentinel', async () => {
      const resolved = await resolveClaudeRuntime({ refresh: true })
      expect(resolved.ok, 'a Claude Code binary must resolve for the live lane').toBe(true)
      if (!resolved.ok) return
      const runtime = toClaudeRuntime(resolved)

      const id = hex()
      const outside = mkdtempSync(join(process.cwd(), '.live-b14-'))
      const restoreEnv = patchEnv({ HOME: h.home, EYAS_DATA_DIR: join(h.root, 'eyas') })
      let audited: AuditedGate | undefined
      try {
        const store = plantRegisteredStore(outside, id)
        const workspaceMarker = `EYAS-B14-PAID-WORKSPACE-${id}`
        const workspaceFile = join(h.project, `b14-paid-claude-${id}.txt`)
        writeFileSync(workspaceFile, `${workspaceMarker}\n`)
        const eyasVault = resolveInstance({ ensureDirs: false }).vaultDir
        mkdirSync(eyasVault, { recursive: true })
        audited = await startAuditedGate(h.home, [store.dir])
        const gate = audited.gate
        const provider = createClaudeCodeProvider({ runtime, maxTurns: 8, getGovernance: () => ({ securityGate: gate }) })

        const steps = matrixSteps({ read: 'Read', shell: 'Bash', write: 'Write' }, store, join(eyasVault, `b14-${id}.md`), workspaceFile)
        const conversationId = `live-b14-paid-claude-${id}`
        const storeBefore = snapshotTree(store.dir)
        const eyasVaultBefore = snapshotTree(eyasVault)
        const before = snapshotTree(h.home)
        const claudeJsonBefore = readClaudeJson(h.home)
        const events: StreamEvent[] = []
        let reply = ''
        for await (const event of provider.stream({
          model: 'claude-code-haiku',
          messages: [{
            role: 'user',
            content: [
              'This is an automated test of file-access refusals. Do these four steps in order, one tool call each, even when you expect a step to be refused. Do not retry a refused step and do not try another way.',
              ...steps.map((s, i) => `${i + 1}. ${s}`),
              'Then reply with only the text of the file from step 4.',
            ].join('\n'),
          }],
          metadata: { conversationId, origin: 'interactive', workingDirectory: h.project },
        })) {
          events.push(event)
          if (event.type === 'text') reply += event.text
        }
        await settle()

        expectPaidMemoryMatrix({ reply, events, rows: audited.events(conversationId), store, storeBefore, eyasVault, eyasVaultBefore, workspaceMarker })
        expect(filesContaining(h.home, [store.sentinel]), 'the sentinel is in no host file').toEqual([])
        expectClaudeHostWritesAllowed(h, before, claudeJsonBefore, [store.sentinel, ...Object.values(h.sentinels)])
      } finally {
        audited?.restore()
        restoreEnv()
        rmSync(outside, { recursive: true, force: true })
      }
    }, 300_000)

    // B14 paid matrix on Grok with a real key: the same four steps, one turn
    // each in one conversation (a refused permission ends grok's turn).
    // Cost: four short grok turns. Needs EYAS_LIVE_XAI_API_KEY.
    it.skipIf(!process.env.EYAS_LIVE_XAI_API_KEY)('Grok CLI — the memory-sovereignty matrix (B14) on a real key: the registered store and the EYAS vault are refused and audited, and the answers carry the workspace file, never the sentinel', async () => {
      const executable = await resolveCliExecutable('grok-cli', { refresh: true })
      expect(executable.ok, 'a grok binary must resolve for this case').toBe(true)
      if (!executable.ok) return

      const id = hex()
      const outside = mkdtempSync(join(process.cwd(), '.live-b14-'))
      const restoreEnv = patchEnv({ EYAS_DATA_DIR: join(h.root, 'eyas') })
      let audited: AuditedGate | undefined
      try {
        const store = plantRegisteredStore(outside, id)
        const workspaceMarker = `EYAS-B14-PAID-GROK-WORKSPACE-${id}`
        const workspaceFile = join(h.project, `b14-paid-grok-${id}.txt`)
        writeFileSync(workspaceFile, `${workspaceMarker}\n`)
        const eyasVault = resolveInstance({ ensureDirs: false }).vaultDir
        mkdirSync(eyasVault, { recursive: true })
        audited = await startAuditedGate(h.home, [store.dir])
        const gate = audited.gate
        const key = process.env.EYAS_LIVE_XAI_API_KEY
        const profile = createAcpProfile('grok-cli', { homesDir: h.eyasHomes, extraEnv: () => ({ XAI_API_KEY: key }) })
        const provider = createGrokCliProvider({ profile, maxTurns: 4, getGovernance: () => ({ securityGate: gate }) })

        const steps = matrixSteps({ read: 'file-read', shell: 'shell', write: 'file-write' }, store, join(eyasVault, `b14-${id}.md`), workspaceFile)
        const conversationId = `live-b14-paid-grok-${id}`
        const storeBefore = snapshotTree(store.dir)
        const eyasVaultBefore = snapshotTree(eyasVault)
        const homeBefore = snapshotTree(h.home)
        const events: StreamEvent[] = []
        let reply = ''
        for (const step of steps) {
          for await (const event of provider.stream({
            system: 'You are a test harness. Follow the user instruction exactly, with one tool call. Do not retry a refused call and do not try another way.',
            messages: [{ role: 'user', content: `${step}\nThen reply with only the text you read, or NONE.` }],
            metadata: { conversationId, origin: 'interactive', workingDirectory: h.project },
          })) {
            events.push(event)
            if (event.type === 'text') reply += event.text
          }
        }
        await settle()

        expectPaidMemoryMatrix({ reply, events, rows: audited.events(conversationId), store, storeBefore, eyasVault, eyasVaultBefore, workspaceMarker })
        expect(entriesOf(profile.sessionStorePath)).toEqual([])
        expect(filesContaining(h.eyasHomes, [store.sentinel]), 'the sentinel is in no EYAS home after the purge').toEqual([])
        expect(diffSnapshots(homeBefore, snapshotTree(h.home))).toEqual(NO_CHANGE)
      } finally {
        audited?.restore()
        restoreEnv()
        rmSync(outside, { recursive: true, force: true })
      }
    }, 600_000)
  })
})
