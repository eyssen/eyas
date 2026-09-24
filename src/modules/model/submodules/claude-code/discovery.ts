// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Zero-cost model discovery on the Claude Code runtime EYAS actually runs
// (D5): one query() on the resolved binary, started in streaming-input mode
// with a prompt that never yields, so the CLI answers the SDK's `initialize`
// control request — which lists the models it offers with their effort levels
// — and is closed before a single user message exists. No model request is
// sent, nothing is billed (the A1 spike recorded the init-only run on the
// operator's 2.1.280 binary: no model request, no content written).
//
// The probe runs on the same isolated options as every other query
// (buildClaudeIsolationOptions: no transcript, no host settings, CLAUDE.md,
// skills or filesystem MCP, allowlisted env) plus `tools: []`, in an EYAS run
// scratch folder — never the server's cwd.
//
// The runtime is untrusted input and newer than the Agent SDK client EYAS
// pins (Gate 0 F1(b)): the model rows are read untyped and Zod-parsed
// tolerantly. A field a newer CLI adds (resolvedModel, xhigh) is read when
// present; a malformed entry is dropped, never guessed into a model. The
// signed-in account the same answer carries is never read.
//
// The live CLI lane (tests/live/cli-isolation.live.test.ts) proves this probe
// on the operator's binary: the model list arrives before any user message,
// no model request is sent, and the host-write diff stays inside the Claude
// Code allowlist.

import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { ModelInfo } from '../../types.js'
import type { ClaudeRuntime } from './runtime.js'
import { buildClaudeIsolationOptions } from './isolation-options.js'
import { cliQueryTmp, runScratchCwd } from '../../cli-runtime/workspaces.js'
import { CliModelNameSchema } from '../../cli-model-id.js'
import { pickContextWindow } from '../../model-window.js'
import { sortEffortLevels } from '../../reasoning/ladder.js'
import type { DiscoveredReasoning } from '../../reasoning/schemas.js'
import { runtimeHasThinkingDisplay } from './reasoning.js'

/** EYAS ids of Claude Code models are `claude-code-<slug of the runtime's value>`. */
export const CLAUDE_CODE_MODEL_PREFIX = 'claude-code-'
/** The runtime's own default model (no model option is sent for it). */
export const CLAUDE_CODE_DEFAULT_VALUE = 'default'

/** How long the runtime may take to answer `initialize` before the probe gives up. */
const DEFAULT_PROBE_TIMEOUT_MS = 30_000

/** Output cap per model family when the runtime names none (it never does). */
const FAMILY_MAX_OUTPUT: ReadonlyArray<{ pattern: RegExp; tokens: number }> = [
  { pattern: /haiku/i, tokens: 64_000 },
  { pattern: /sonnet-4(?:[-.][05])?(?:-\d{8})?(?:\[1m\])?$/i, tokens: 64_000 },
]
const DEFAULT_MAX_OUTPUT = 128_000
/** The runtime's window for a model selected with its 1M-context suffix. */
const ONE_M_WINDOW = 1_000_000
/** The suffix that selects a model's 1M-context variant ('opus[1m]'). */
const ONE_M_SUFFIX = /\[1m\]$/i

// ─── The runtime's model rows ──────────────────────────────────────────

const OptBool = z.boolean().optional().catch(undefined)
const OptText = (max: number) => z.string().min(1).max(max).optional().catch(undefined)

/**
 * One model the runtime offers, as `initialize` / supportedModels() report
 * it. Only `value` is required; every other field is optional and a
 * malformed one reads as absent.
 */
const RuntimeModelSchema = z.object({
  value: z.string().min(1).max(200),
  resolvedModel: OptText(300),
  displayName: OptText(200),
  supportsEffort: OptBool,
  supportedEffortLevels: z.array(z.unknown()).max(32).optional().catch(undefined),
  supportsAdaptiveThinking: OptBool,
  disabled: OptBool,
})

export type RuntimeModel = z.infer<typeof RuntimeModelSchema>

/** The model list of an `initialize` answer: every readable, selectable entry. */
export function parseRuntimeModels(raw: unknown): RuntimeModel[] {
  if (!Array.isArray(raw)) return []
  const out: RuntimeModel[] = []
  for (const entry of raw) {
    const parsed = RuntimeModelSchema.safeParse(entry)
    if (!parsed.success) continue
    const model = parsed.data
    // The runtime marks an entry it offers but will not run.
    if (model.disabled === true) continue
    // A value no --model may carry is not a model row (the default is never sent).
    if (model.value !== CLAUDE_CODE_DEFAULT_VALUE && !CliModelNameSchema.safeParse(model.value).success) continue
    out.push(model)
  }
  return out
}

// ─── The probe ─────────────────────────────────────────────────────────

/** The part of the SDK's Query the probe uses. */
export interface ProbeQuery {
  initializationResult(): Promise<unknown>
  supportedModels?(): Promise<unknown>
  close?(): void
}

export type ProbeQueryFn = (args: { prompt: AsyncIterable<never>; options: Record<string, unknown> }) => ProbeQuery

export interface ClaudeProbeOptions {
  /** The SDK's query() (tests inject a fake). */
  query?: ProbeQueryFn
  /** Working directory of the probe (default: the 'model-probe' EYAS run scratch folder). */
  cwd?: string
  /** Environment the claude-code allowlist reads from (default process.env). */
  envSource?: NodeJS.ProcessEnv
  timeoutMs?: number
  logger?: Pick<Logger, 'debug'>
}

export interface ClaudeProbeResult {
  models: RuntimeModel[]
  /** The version of the binary that answered (the resolved runtime's). */
  runtimeVersion: string | null
}

const InitModelsSchema = z.object({ models: z.unknown() }).passthrough()

/**
 * Ask the runtime which models it offers. Never yields a user message; the
 * query is closed as soon as the answer (or a failure) is in. Throws when
 * the runtime answers nothing usable, so a failed probe is never mistaken
 * for "no models".
 */
export async function probeClaudeRuntime(runtime: ClaudeRuntime, opts: ClaudeProbeOptions = {}): Promise<ClaudeProbeResult> {
  const cwd = opts.cwd ?? runScratchCwd('model-probe')
  // The probe's own temp root (CLAUDE_CODE_TMPDIR), removed when it is done.
  const probeTmp = cliQueryTmp()
  const isolation = buildClaudeIsolationOptions({ cwd, executable: runtime.path, tmpDir: probeTmp.dir, envSource: opts.envSource })
  const abortController = new AbortController()

  // Streaming-input mode with a prompt that never yields: the CLI starts and
  // answers `initialize`, and has nothing to send to a model. Released (the
  // input ends, still empty) only when the probe is done.
  let release: () => void = () => {}
  const released = new Promise<void>((resolve) => { release = resolve })
  async function* idle(): AsyncGenerator<never> {
    await released
  }

  const run = opts.query ?? (sdkQuery as unknown as ProbeQueryFn)
  let q: ProbeQuery
  try {
    probeTmp.create()
    q = run({
      prompt: idle(),
      options: {
        ...isolation,
        // No builtins and no EYAS bridge: nothing could run even if a turn started.
        tools: [],
        abortController,
      },
    })
  } catch (err) {
    probeTmp.release()
    throw err
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Claude Code runtime did not report its models within ${timeoutMs} ms`)), timeoutMs)
  })

  try {
    const init = await Promise.race([q.initializationResult(), timeout])
    let raw: unknown
    try {
      raw = q.supportedModels ? await Promise.race([q.supportedModels(), timeout]) : undefined
    } catch {
      raw = undefined
    }
    // supportedModels() is the init answer's own list on the pinned SDK;
    // the init list is the fallback for a client that answers differently.
    if (!Array.isArray(raw)) {
      const parsed = InitModelsSchema.safeParse(init)
      raw = parsed.success ? parsed.data.models : undefined
    }
    const models = parseRuntimeModels(raw)
    if (models.length === 0) throw new Error('Claude Code runtime offered no model')
    opts.logger?.debug({ models: models.length, version: runtime.version }, 'claude-code: runtime models discovered')
    return { models, runtimeVersion: runtime.version }
  } finally {
    if (timer) clearTimeout(timer)
    release()
    abortController.abort()
    try {
      q.close?.()
    } catch {
      // Already closed.
    }
    probeTmp.release()
  }
}

// ─── Rows ──────────────────────────────────────────────────────────────

/** A runtime value as an EYAS id segment: 'opus[1m]' → 'opus-1m'. */
export function claudeModelSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * What the runtime says about one model's reasoning, in THE discovered
 * shape: its effort levels (discovery is the truth for them — the binary
 * decides what it accepts) and whether it runs adaptive thinking. A model the
 * runtime offers no effort for has no reasoning control here. The default
 * level is not reported by the runtime; the overlay supplies it. Whether the
 * runtime can be asked to show thinking (`--thinking-display`) follows from
 * its version, so an older runtime's models read as hiding their reasoning.
 */
export function claudeReasoningOf(model: RuntimeModel, facts: { runtimeVersion: string | null; discoveredAt: string }): DiscoveredReasoning {
  const runtime = facts.runtimeVersion ? { runtime: facts.runtimeVersion.slice(0, 64) } : {}
  const thinkingDisplay = runtimeHasThinkingDisplay(facts.runtimeVersion)
  const reported = (model.supportedEffortLevels ?? []).filter((l): l is string => typeof l === 'string')
  // The runtime's own ladder has no 'none'/'minimal'; anything else it names
  // that is not a rung is dropped rather than guessed.
  const levels = sortEffortLevels(reported).filter((l) => l !== 'none' && l !== 'minimal')
  if (model.supportsEffort === false || levels.length === 0) {
    return { source: 'sdk', param: 'none', levels: [], thinkingDisplay, ...runtime, discoveredAt: facts.discoveredAt }
  }
  return {
    source: 'sdk',
    param: 'effort',
    levels,
    adaptiveThinking: model.supportsAdaptiveThinking === true,
    thinkingDisplay,
    ...runtime,
    discoveredAt: facts.discoveredAt,
  }
}

function maxOutputFor(concrete: string): number {
  return FAMILY_MAX_OUTPUT.find((f) => f.pattern.test(concrete))?.tokens ?? DEFAULT_MAX_OUTPUT
}

/**
 * The window of one Claude Code model, from its alias and, when known, the
 * concrete model it resolves to: 1M only when the model is selected with its
 * 1M-context suffix, else the provider's known window from THE window
 * resolver (model-window.ts). The first-boot seed (provider.ts KNOWN_MODELS)
 * and every discovery use this one function, so the stored catalog, the
 * context bar and prompt sizing agree on a model's window before and after
 * discovery. A larger window the runtime reports for the model that answered
 * reaches the context bar as the observed window (context-occupancy.ts),
 * never the catalog.
 */
export function claudeCodeWindowFor(value: string, concrete?: string): number {
  return ONE_M_SUFFIX.test(value) || (concrete !== undefined && ONE_M_SUFFIX.test(concrete))
    ? ONE_M_WINDOW
    : pickContextWindow(null, 'claude-code')
}

/**
 * The model catalog from one discovery: `claude-code-<slug>` per model the
 * runtime offers (`claude-code-default` for its own default), each naming the
 * alias that selects it, the concrete model it resolves to, the runtime
 * version and its reasoning facts. Duplicate slugs keep the first entry.
 */
export function claudeModelsFromDiscovery(probe: ClaudeProbeResult, discoveredAt: string): ModelInfo[] {
  const rows: ModelInfo[] = []
  const seen = new Set<string>()
  for (const model of probe.models) {
    const slug = claudeModelSlug(model.value)
    if (!slug) continue
    const id = `${CLAUDE_CODE_MODEL_PREFIX}${slug}`
    if (seen.has(id)) continue
    seen.add(id)
    const concrete = model.resolvedModel
    const label = model.value === CLAUDE_CODE_DEFAULT_VALUE ? 'Default' : (model.displayName ?? model.value)
    rows.push({
      id,
      name: `Claude Code (${label})`,
      provider: 'claude-code',
      contextWindow: claudeCodeWindowFor(model.value, concrete),
      maxOutputTokens: maxOutputFor(concrete ?? model.value),
      supportsTools: true,
      supportsImages: true,
      supportsStreaming: true,
      metadata: {
        alias: model.value,
        ...(concrete ? { realModelId: concrete } : {}),
        ...(probe.runtimeVersion ? { cliVersion: probe.runtimeVersion.slice(0, 64) } : {}),
        reasoning: claudeReasoningOf(model, { runtimeVersion: probe.runtimeVersion, discoveredAt }),
        discoveredAt,
      },
    })
  }
  if (rows.length === 0) throw new Error('Claude Code runtime offered no model')
  return rows
}
