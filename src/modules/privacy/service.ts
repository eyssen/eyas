// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// PrivacyService: the one place that decides what a match means. Every
// consumer — the model egress, memory tool results on the CLI bridges and
// external MCP (redactToolOutput), the OpenCode hand-off, memory written to
// the vault, inbound message checks, the scan tester — goes through the same
// deterministic mask function, so one memory line is masked identically
// wherever it appears.
//
// Contract: EYAS data is stored raw and masked when it leaves EYAS for a
// remote destination. Masking never throws and never blocks a call; 'block'
// only matters to checkInbound (refusing a NEW interactive user message).
//
// stats() counts real traffic only — the egress digests the privacy module
// reports (recordEgress), memory tool results sent past the gateway, inbound
// checks and their outcomes. The scan tester (preview) is never counted.

import type { Logger } from 'pino'
import type { EyasBus } from '@core/types'
import { isLoopbackHost } from '@shared/endpoint-locality.js'
import { createScannerChain } from './scanner-chain.js'
import { createRegexScanner } from './scanners/regex-scanner.js'
import { createCustomScanner } from './scanners/custom-scanner.js'
import type { PiiMatch, PiiScanner, PrivacyStats } from './types.js'
import {
  PrivacyPolicySchema,
  PrivacyPolicyValidationError,
  canonicalHost,
  changedTypes,
  rulesetVersion,
  toPolicyIssues,
  type PrivacyAction,
  type PrivacyPolicy,
} from './policy.js'
import type { PolicySource, PolicyStore } from './policy-store.js'
import { PRIVACY_EGRESS_EVENT, toolOutputEventOf } from './egress-audit.js'

/** Where a text is going: this machine (exempt) or anywhere else (masked). */
export type Locality = 'local' | 'remote'

/** A detection together with the action the policy assigns it ('off' never appears). */
export interface ClassifiedMatch extends PiiMatch {
  action: Exclude<PrivacyAction, 'off'>
}

export interface RedactResult {
  text: string
  /** Every non-'off' detection, masked or not (warn-class ones are left in the text). */
  matches: ClassifiedMatch[]
}

export interface RedactValueResult<T> {
  /** The same reference when nothing was masked; otherwise a copy with only the changed leaves replaced. */
  value: T
  matches: ClassifiedMatch[]
}

export interface InboundVerdict {
  /** True only when a block-class type is present and a destination is remote. */
  blocked: boolean
  /** The block-class types found, in order of first appearance. */
  types: string[]
  /** The text with ONLY the block-class values masked. */
  maskedText: string
}

/** What the scan tester shows for one text. Never counted in stats(). */
export interface ScanPreview {
  /** False: the policy is switched off, so nothing is detected. */
  enabled: boolean
  rulesetVersion: string
  /** Every non-'off' detection, with its action. */
  matches: ClassifiedMatch[]
  /** The text as a remote model would receive it. */
  egressText: string
  /** The verdict a NEW chat or channel message with this text gets when it is bound for a remote model. */
  inbound: { refused: boolean; types: string[] }
}

/** The part of an egress digest the counters read (EgressDigest satisfies it). */
export interface EgressTally {
  locality: Locality
  matches: ReadonlyArray<{ type: string; action: ClassifiedMatch['action']; scanner: string }>
}

/** A NEW message's ingress outcome, reported by the chat route and the channels (bus events). */
export type InboundOutcome = 'refused' | 'masked'

export interface PolicyState {
  version: number
  source: PolicySource
  seedError: string | null
  updatedAt: string
  rulesetVersion: string
}

/** Anything that can say which host it sends prompts to (an AIProvider). */
export interface EgressHostSource {
  egressHost?(): string | undefined
}

/**
 * A way EYAS data reaches a model WITHOUT passing the model gateway, so the
 * gateway's egress filter never sees it: the CLI tool bridges (Claude Code's
 * in-process MCP server and the Grok/Kimi ACP bridge — 'mcp-bridge'), an
 * external MCP client ('mcp-external') and the OpenCode sidecar ('opencode').
 * Every one of them counts as remote: EYAS cannot tell where the model behind
 * it runs.
 */
export type OutboundTransport = 'mcp-bridge' | 'mcp-external' | 'opencode'

/**
 * Who a value leaving through an OutboundTransport is sent for. Callers fill
 * it from server-side state (a bridge binding, the tool context of the call),
 * never from a request body.
 */
export interface ToolOutputContext {
  transport: OutboundTransport
  conversationId?: string
  runId?: string
  agentId?: string
  turnId?: string
}

/** What redactToolOutput found, for the log and the audit. It never carries a detected value. */
export interface ToolOutputDigest extends ToolOutputContext {
  /** The EYAS tool whose call carried the value out. */
  toolName: string
  rulesetVersion: string
  masked: number
  warned: number
  byType: Record<string, number>
  matches: Array<{ type: string; action: ClassifiedMatch['action']; scanner: string; confidence: number }>
}

export interface RedactToolOutputResult<T> {
  /** redactValue's result for a remote destination: the same reference when nothing was masked. */
  value: T
  /** Null when nothing was detected. */
  digest: ToolOutputDigest | null
}

/**
 * The policy as compiled at one moment, with the mask functions bound to it.
 * A caller that must mask a whole run identically (the model egress filter
 * across the iterations of one tool loop) pins one, so a policy swap mid-run
 * cannot change bytes already sent earlier in that run.
 */
export interface PolicySnapshot {
  readonly version: number
  readonly enabled: boolean
  /** 'regex@2/policy@<version>' of this snapshot. */
  readonly rulesetVersion: string
  localityOf(provider: EgressHostSource | null | undefined): Locality
  redactText(text: string, opts: { locality: Locality }): RedactResult
  redactValue<T>(value: T, opts: { locality: Locality }): RedactValueResult<T>
}

export interface PrivacyService {
  policy(): PrivacyPolicy
  state(): PolicyState
  /** 'regex@2/policy@<version>' — recorded with anything that was masked. */
  rulesetVersion(): string
  /**
   * 'local' when the provider's egress host is loopback or one of the
   * policy's localHosts; 'remote' otherwise — including a provider without a
   * known host (CLI providers, unknown endpoints). Never resolves DNS.
   */
  localityOf(provider: EgressHostSource | null | undefined): Locality
  /** Masks mask- and block-class values as '[TYPE]' for a remote destination; local → unchanged. Never throws. */
  redactText(text: string, opts: { locality: Locality }): RedactResult
  /** redactText applied to every string leaf of a JSON-like value; keys, numbers and booleans are untouched. */
  redactValue<T>(value: T, opts: { locality: Locality }): RedactValueResult<T>
  /**
   * Masks a value that an EYAS tool call carries out of EYAS past the model
   * gateway (see OutboundTransport): a memory-bearing tool's result on a CLI
   * bridge or an external MCP call, the memory and prompt handed to an
   * OpenCode task. Always the remote-destination mask — nothing in the
   * request can make it local — so the same memory item is masked exactly as
   * it is in the system prompt or a gateway tool_result. A detection is
   * logged (types and identity only, never a value). Never throws on a match.
   */
  redactToolOutput<T>(toolName: string, output: T, ctx: ToolOutputContext): RedactToolOutputResult<T>
  /** Verdict for a NEW interactive user message bound for `localities` (empty = unknown = remote). Counted as checked. */
  checkInbound(text: string, opts: { localities: readonly Locality[] }): InboundVerdict
  /**
   * The scan tester: the current policy's detections in `text`, the text as
   * a remote model would receive it, and the ingress verdict of a new message
   * carrying it. Not counted in stats().
   */
  preview(text: string): ScanPreview
  /** The mask applied to memory written at rest (vault notes): the remote-destination mask. */
  maskAtRest(text: string): string
  /** The current policy, pinned: later swaps do not affect the returned snapshot. */
  snapshot(): PolicySnapshot
  /** Validates, persists (as UI-managed) and applies a new policy on the next call. Throws PrivacyPolicyValidationError. */
  update(input: unknown, opts?: { userId?: string | null }): PrivacyPolicy
  /** Re-imports privacy.yaml if it changed (config hot-reload); true when the policy changed. */
  reloadFromYaml(): boolean
  /**
   * Counts one model-gateway or embed egress for stats(): a remote call is
   * counted with its detections; a local pass-through is not.
   */
  recordEgress(digest: EgressTally): void
  /** Counts a new message's ingress outcome (the inbound_refused / inbound_masked events). */
  recordInboundOutcome(outcome: InboundOutcome): void
  /** Counters of real traffic since the service started (see PrivacyStats). */
  stats(): PrivacyStats
}

/** Where a masked tool result is attributed to its turn's composition (the context recorder). */
export interface ToolEgressSink {
  attachToolEgress?(compositionId: string, digest: ToolOutputDigest): void
}

export interface PrivacyServiceOptions {
  store: PolicyStore
  bus?: Pick<EyasBus, 'emit'>
  logger: Pick<Logger, 'info' | 'warn' | 'error'>
  /** Resolved per call: the context recorder appears in the observability module's onStart. */
  getRecorder?: () => ToolEgressSink | undefined
  /** Clock seam for tests (stats().since). */
  now?: () => Date
}

/** Replacement text for a masked value. */
export function maskPlaceholder(type: string): string {
  return `[${type.toUpperCase()}]`
}

/** Custom patterns carry no confidence of their own; they win ties against nothing. */
const CUSTOM_PATTERN_CONFIDENCE = 0.9

interface Compiled {
  policy: PrivacyPolicy
  /** First custom pattern per type decides that type's action. */
  customActions: Map<string, PrivacyAction>
  /**
   * This policy's own custom scanner. It belongs to the compiled policy, not
   * to the shared chain, so a pinned snapshot keeps scanning with its own
   * patterns after the policy was swapped.
   */
  customScanner: PiiScanner | null
  localHosts: Set<string>
  version: number
  /** The mask functions bound to this compiled policy (built once). */
  snapshot: PolicySnapshot
}

export function createPrivacyService(options: PrivacyServiceOptions): PrivacyService {
  const { store, bus, logger, getRecorder } = options

  // One chain for the service's lifetime. It holds only the built-in regex
  // scanner; each compiled policy brings its custom scanner to the scan call.
  const chain = createScannerChain()
  chain.addScanner(createRegexScanner())

  // Counters of real traffic (stats()); a policy swap does not reset them.
  const counters: PrivacyStats = {
    since: (options.now ?? (() => new Date()))().toISOString(),
    egress: { calls: 0, maskedCalls: 0, byType: {} },
    inbound: { checked: 0, refused: 0, masked: 0 },
    byScanner: {},
  }
  const bump = (map: Record<string, number>, key: string) => {
    map[key] = (map[key] ?? 0) + 1
  }
  /** One outgoing payload scanned for a remote destination, with its detections. */
  function countEgress(matches: EgressTally['matches']): void {
    counters.egress.calls++
    let masked = false
    for (const m of matches) {
      if (m.action !== 'warn') masked = true
      bump(counters.egress.byType, m.type)
      bump(counters.byScanner, m.scanner)
    }
    if (masked) counters.egress.maskedCalls++
  }

  function actionFor(match: PiiMatch, c: Compiled): PrivacyAction {
    if (match.scanner === 'custom') return c.customActions.get(match.type) ?? 'warn'
    return (c.policy.actions as Record<string, PrivacyAction | undefined>)[match.type] ?? 'warn'
  }

  function classify(text: string, c: Compiled): ClassifiedMatch[] {
    if (!c.policy.enabled || !text) return []
    const out: ClassifiedMatch[] = []
    for (const match of chain.scan(text, c.customScanner ? [c.customScanner] : [])) {
      const action = actionFor(match, c)
      if (action === 'off') continue
      out.push({ ...match, action })
    }
    return out
  }

  function applyMasks(text: string, matches: readonly ClassifiedMatch[], mask: (m: ClassifiedMatch) => boolean): string {
    const selected = matches.filter(mask).sort((a, b) => b.start - a.start)
    if (selected.length === 0) return text
    let result = text
    for (const m of selected) {
      result = result.slice(0, m.start) + maskPlaceholder(m.type) + result.slice(m.end)
    }
    return result
  }

  const isMasked = (m: ClassifiedMatch) => m.action === 'mask' || m.action === 'block'

  function redactTextWith(c: Compiled, text: string, opts: { locality: Locality }): RedactResult {
    if (opts.locality === 'local' || typeof text !== 'string' || !text) return { text, matches: [] }
    try {
      const matches = classify(text, c)
      return { text: applyMasks(text, matches, isMasked), matches }
    } catch (err) {
      // Fail closed without throwing: a scanner bug must neither stop the
      // call nor let the text out unmasked.
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Privacy: scan failed — the text was withheld')
      return { text: '[REDACTED]', matches: [] }
    }
  }

  function redactValueWith<T>(c: Compiled, value: T, opts: { locality: Locality }): RedactValueResult<T> {
    if (opts.locality === 'local') return { value, matches: [] }
    const matches: ClassifiedMatch[] = []
    // A shared sub-object is redacted once and reused; a cycle is cut at the
    // back-reference (JSON-shaped values, the real input, have neither).
    const done = new Map<object, unknown>()
    const inProgress = new Set<object>()

    const walkNode = (v: object): unknown => {
      if (Array.isArray(v)) {
        let changed = false
        const next = v.map((item) => {
          const out = walk(item)
          if (out !== item) changed = true
          return out
        })
        return changed ? next : v
      }
      const proto = Object.getPrototypeOf(v)
      if (proto !== Object.prototype && proto !== null) return v
      let changed = false
      const entries = Object.entries(v as Record<string, unknown>).map(([key, item]): [string, unknown] => {
        const out = walk(item)
        if (out !== item) changed = true
        return [key, out]
      })
      // fromEntries defines every key as an own property — including a
      // '__proto__' key from parsed JSON, which a plain assignment would turn
      // into a prototype change and so drop its (masked) value.
      return changed ? Object.fromEntries(entries) : v
    }

    const walk = (v: unknown): unknown => {
      if (typeof v === 'string') {
        const r = redactTextWith(c, v, opts)
        if (r.matches.length) matches.push(...r.matches)
        return r.text
      }
      if (!v || typeof v !== 'object') return v
      if (done.has(v)) return done.get(v)
      if (inProgress.has(v)) return v
      inProgress.add(v)
      const out = walkNode(v)
      inProgress.delete(v)
      done.set(v, out)
      return out
    }

    return { value: walk(value) as T, matches }
  }

  function localityWith(c: Compiled, provider: EgressHostSource | null | undefined): Locality {
    let host: string | undefined
    try {
      host = provider?.egressHost?.()
    } catch {
      host = undefined
    }
    if (!host) return 'remote'
    if (isLoopbackHost(host)) return 'local'
    const canonical = canonicalHost(host)
    return canonical && c.localHosts.has(canonical) ? 'local' : 'remote'
  }

  function compile(policy: PrivacyPolicy, version: number): Compiled {
    const customActions = new Map<string, PrivacyAction>()
    for (const p of policy.customPatterns) {
      if (!customActions.has(p.type)) customActions.set(p.type, p.action)
    }
    const customScanner = policy.customPatterns.length === 0
      ? null
      : createCustomScanner(
          policy.customPatterns.map((p) => ({ name: p.name, regex: p.regex, type: p.type, confidence: CUSTOM_PATTERN_CONFIDENCE })),
          logger,
        )
    const c = { policy, customActions, customScanner, localHosts: new Set(policy.localHosts), version } as Compiled
    c.snapshot = {
      version,
      enabled: policy.enabled,
      rulesetVersion: rulesetVersion(version),
      localityOf: (provider) => localityWith(c, provider),
      redactText: (text, opts) => redactTextWith(c, text, opts),
      redactValue: (value, opts) => redactValueWith(c, value, opts),
    }
    return c
  }

  // Swapped as one reference (synchronously), so no call can observe a
  // half-applied policy.
  let compiled = compile(store.current().policy, store.current().version)

  function redactText(text: string, opts: { locality: Locality }): RedactResult {
    return redactTextWith(compiled, text, opts)
  }

  /**
   * Reports one tool-output digest: warn for warn-class values, info for
   * masked ones; with audit on, ONE 'eyas.privacy.egress' event (never a
   * value); and the counts go to the turn's composition for the context
   * inspector (turnId is the composition id when the turn recorded one).
   */
  function reportToolOutput(digest: ToolOutputDigest, c: Compiled): void {
    const { matches, ...summary } = digest
    if (matches.some((m) => m.action === 'warn')) {
      logger.warn(summary, 'Privacy: warn-class values in a tool result sent past the model gateway')
    }
    if (matches.some((m) => m.action !== 'warn')) {
      logger.info(summary, 'Privacy: masked values in a tool result sent past the model gateway')
    }
    if (c.policy.audit) {
      const event = toolOutputEventOf(digest)
      if (event) bus?.emit(PRIVACY_EGRESS_EVENT, event)
    }
    const turnId = digest.turnId
    if (turnId && getRecorder) {
      // Off the call path, like the gateway's attach: the answer goes out first.
      queueMicrotask(() => {
        try {
          getRecorder()?.attachToolEgress?.(turnId, digest)
        } catch (err) {
          logger.warn({ err: err instanceof Error ? err.message : String(err), turnId }, 'Privacy: tool-result egress not attached to the composition')
        }
      })
    }
  }

  function redactToolOutput<T>(toolName: string, output: T, ctx: ToolOutputContext): RedactToolOutputResult<T> {
    // One compiled policy for the whole value: a swap mid-walk cannot mix two.
    const c = compiled
    const r = redactValueWith(c, output, { locality: 'remote' })
    if (c.policy.enabled) countEgress(r.matches)
    if (r.matches.length === 0) return { value: r.value, digest: null }
    const byType: Record<string, number> = {}
    let masked = 0
    for (const m of r.matches) {
      byType[m.type] = (byType[m.type] ?? 0) + 1
      if (isMasked(m)) masked++
    }
    const digest: ToolOutputDigest = {
      transport: ctx.transport,
      toolName,
      ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
      ...(ctx.runId ? { runId: ctx.runId } : {}),
      ...(ctx.agentId ? { agentId: ctx.agentId } : {}),
      ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
      rulesetVersion: c.snapshot.rulesetVersion,
      masked,
      warned: r.matches.length - masked,
      byType,
      matches: r.matches.map((m) => ({ type: m.type, action: m.action, scanner: m.scanner, confidence: m.confidence })),
    }
    reportToolOutput(digest, c)
    return { value: r.value, digest }
  }

  function checkInbound(text: string, opts: { localities: readonly Locality[] }): InboundVerdict {
    if (typeof text !== 'string' || !text) return { blocked: false, types: [], maskedText: text }
    let matches: ClassifiedMatch[]
    try {
      matches = classify(text, compiled)
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Privacy: inbound scan failed')
      matches = []
    }
    if (compiled.policy.enabled) {
      counters.inbound.checked++
      for (const m of matches) bump(counters.byScanner, m.scanner)
    }
    const blockMatches = matches.filter((m) => m.action === 'block')
    const types = [...new Set(blockMatches.map((m) => m.type))]
    const remote = opts.localities.length === 0 || opts.localities.includes('remote')
    return {
      blocked: types.length > 0 && remote,
      types,
      maskedText: applyMasks(text, blockMatches, () => true),
    }
  }

  function preview(text: string): ScanPreview {
    // One compiled policy for the whole answer; nothing here is counted.
    const c = compiled
    const r = redactTextWith(c, text, { locality: 'remote' })
    const types = [...new Set(r.matches.filter((m) => m.action === 'block').map((m) => m.type))]
    return {
      enabled: c.policy.enabled,
      rulesetVersion: c.snapshot.rulesetVersion,
      matches: r.matches,
      egressText: r.text,
      inbound: { refused: types.length > 0, types },
    }
  }

  function swap(next: PrivacyPolicy, version: number, source: PolicySource, userId?: string | null): void {
    const before = compiled.policy
    compiled = compile(next, version)
    bus?.emit('eyas.privacy.policy.updated', {
      version,
      source,
      rulesetVersion: rulesetVersion(version),
      changedTypes: changedTypes(before, next),
      ...(userId ? { userId } : {}),
    })
    logger.info({ version, source }, 'Privacy: policy applied')
  }

  return {
    policy: () => compiled.policy,

    state() {
      const s = store.current()
      return {
        version: s.version,
        source: s.source,
        seedError: s.seedError,
        updatedAt: s.updatedAt,
        rulesetVersion: rulesetVersion(compiled.version),
      }
    },

    rulesetVersion: () => rulesetVersion(compiled.version),
    localityOf: (provider) => localityWith(compiled, provider),
    redactText,
    redactValue: (value, opts) => redactValueWith(compiled, value, opts),
    redactToolOutput,
    checkInbound,
    preview,
    maskAtRest: (text) => redactText(text, { locality: 'remote' }).text,
    snapshot: () => compiled.snapshot,

    update(input, opts) {
      const parsed = PrivacyPolicySchema.safeParse(input)
      if (!parsed.success) throw new PrivacyPolicyValidationError(toPolicyIssues(parsed.error))
      const stored = store.save(parsed.data, 'ui')
      swap(stored.policy, stored.version, 'ui', opts?.userId)
      return stored.policy
    },

    reloadFromYaml() {
      const changed = store.syncFromYaml()
      if (changed) {
        const s = store.current()
        swap(s.policy, s.version, s.source)
      }
      return changed
    },

    recordEgress(digest) {
      if (digest.locality !== 'remote') return
      countEgress(digest.matches)
    },

    recordInboundOutcome(outcome) {
      counters.inbound[outcome]++
    },

    stats(): PrivacyStats {
      return {
        since: counters.since,
        egress: { ...counters.egress, byType: { ...counters.egress.byType } },
        inbound: { ...counters.inbound },
        byScanner: { ...counters.byScanner },
      }
    },
  }
}
