// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The privacy egress filter: installed into the raw model gateway's egress
// slot (model/egress.ts), so it sees every attempt of every call — the first
// try, the same-provider retry and the tier-fallback hop, each for the
// provider it actually reaches — plus embed(). Nothing wraps ctx.model for
// privacy any more, so a gateway reference captured before the privacy
// module started (the decision engine's triage) is masked too.
//
// Contract: EYAS data is stored raw and masked on its way to a REMOTE
// destination by the PrivacyService's one mask function. A local destination
// (loopback or a declared local host) and a disabled policy get the request
// unchanged. Masking never blocks and never throws on a match.
//
// What is scanned for a remote destination:
// - The system prompt, section by section. The sections recorded for the
//   turn (context recorder, metadata.compositionId) are located in order in
//   request.system. EYAS-generated sections (identity, rules, runtime,
//   folders, inventories, orchestration directive) are sent as they are;
//   every other located section is scanned on its own; any text that cannot
//   be attributed to a section is scanned as 'unattributed' (fail closed).
// - Every string message and every text block of the history.
// - tool_result blocks of memory-bearing tools (ToolImplementation.memoryBearing):
//   a JSON result has its string leaves masked (keys, numbers and structure
//   intact); any other result is masked as text. Workspace tool results
//   (files, shell, browser, documents, code search) stay raw.
// Never touched: tool_use inputs, images, thinking blocks and any other block.
//
// Every call with the policy on yields a value-free digest (EgressDigest):
// the privacy module turns one with a detection into the single audit event
// 'eyas.privacy.egress', and the filter attaches it to the turn's composition
// (context recorder attachEgress, after the call) so the context inspector
// shows what the model actually received.

import type { EgressFilter } from '@modules/model/egress.js'
import type { AIProvider, ContentBlock, EmbedRequest, ModelMessage, ModelRequest, ModelRequestMetadata } from '@modules/model/types.js'
import type { ClassifiedMatch, Locality, PolicySnapshot, PrivacyService, ToolOutputDigest } from './service.js'

/**
 * Sections EYAS builds itself (never user or memory content). They are sent
 * as they are, so the model always reads its identity, rules, clock, folders
 * and tool inventory verbatim. Everything else — memory, persona files,
 * project context, skills, designs — is scanned.
 */
export const SYSTEM_GENERATED_SECTION_KEYS: ReadonlySet<string> = new Set([
  'core-identity',
  'core-rules',
  'runtime',
  'working-directories',
  'available-tools',
  'available-skills',
  'available-agents',
  'orchestration-directive',
])

/** A masked span: offsets relative to the section's recorded content, and the type. */
export type EgressSpan = [start: number, end: number, type: string]

export interface EgressSectionDigest {
  ord: number
  key: string
  /** False: the section was not found in the system prompt, so its text was scanned as unattributed. */
  located: boolean
  /** True: an EYAS-generated section, sent without scanning. */
  skipped: boolean
  /** Masked spans within the section. */
  spans: EgressSpan[]
  /** Warn-class detections left in the section text. */
  warned: number
}

export interface EgressCounts {
  masked: number
  warned: number
}

/** One detection, without its value. */
export interface EgressMatchSummary {
  type: string
  action: ClassifiedMatch['action']
  scanner: string
  confidence: number
}

/**
 * What one egress did — for the operator's audit (one 'eyas.privacy.egress'
 * event when something was detected) and the context inspector (attached to
 * the turn's composition). It never carries a detected value. A local
 * destination gets a digest too, with nothing scanned, so the inspector can
 * say the prompt went out unmasked on purpose.
 */
export interface EgressDigest {
  transport: 'gateway' | 'embed'
  /** 'local': sent as it is (loopback or a declared local host); nothing below was scanned. */
  locality: Locality
  providerId: string
  rulesetVersion: string
  compositionId?: string
  conversationId?: string
  runId?: string
  agentId?: string
  /** Every recorded section, in prompt order (empty without a composition record). */
  sections: EgressSectionDigest[]
  /** System-prompt text outside every located section. */
  unattributed: EgressCounts
  /** String messages and text blocks of the history (embed: the embedded texts). */
  messages: EgressCounts
  /** Memory-bearing tool results. */
  toolResults: Array<EgressCounts & { toolName: string }>
  /** Keys of the EYAS-generated sections that were sent without scanning. */
  skippedKeys: string[]
  /** Detections per type (masked and warned). */
  byType: Record<string, number>
  matches: EgressMatchSummary[]
}

/** The sections of a recorded composition — the context recorder satisfies this. */
export interface SectionSource {
  sectionsFor(compositionId: string | null | undefined): ReadonlyArray<{ ord: number; key: string; content: string }> | null
}

/**
 * The context recorder as the privacy module uses it: it answers a turn's
 * sections, and takes back what the egress did to them (the inspector's
 * 'as sent to the model' view). The attach calls are optional so a recorder
 * without them (a test fake, an older build) only loses the attribution.
 */
export interface EgressRecorder extends SectionSource {
  /** One gateway call's digest (the last call of a turn wins). */
  attachEgress?(compositionId: string, digest: EgressDigest): void
  /** A memory tool result masked on a CLI bridge during the turn (PrivacyService.redactToolOutput). */
  attachToolEgress?(compositionId: string, digest: ToolOutputDigest): void
}

/** Tool lookup — the tool registry satisfies this. */
export interface ToolLookup {
  get(name: string): { memoryBearing?: boolean } | undefined
}

/**
 * The tool registry published on the module context by the tools module, read
 * per call. Privacy only looks tools up; it registers none, so it does not
 * depend on the tools module's start order.
 */
export function toolLookupOf(ctx: unknown): ToolLookup | undefined {
  return (ctx as { tools?: { registry?: ToolLookup } } | null)?.tools?.registry
}

/** The context recorder published by the observability module, read per call. */
export function egressRecorderOf(ctx: unknown): EgressRecorder | undefined {
  return (ctx as { contextRecorder?: EgressRecorder } | null)?.contextRecorder
}

export interface EgressFilterDeps {
  service: PrivacyService
  /** Resolved per call: the tool registry appears in the tools module's onRegister. */
  getToolRegistry: () => ToolLookup | undefined
  /** Resolved per call: the recorder appears in the observability module's onStart. */
  getRecorder: () => EgressRecorder | undefined
  /**
   * Receives the digest of every call with the policy enabled — remote scans
   * and local pass-throughs. Its failure never fails the call.
   */
  onDigest?: (digest: EgressDigest) => void
  logger: { debug(obj: unknown, msg?: string): void }
}

/** How many runs keep their pinned policy (least recently used goes first). */
const PINNED_RUNS = 128

const REMOTE = { locality: 'remote' } as const

const isMaskedMatch = (m: ClassifiedMatch) => m.action === 'mask' || m.action === 'block'

function locate(system: string, content: string, from: number): { start: number; end: number } | null {
  if (!content) return null
  let at = system.indexOf(content, from)
  if (at >= 0) return { start: at, end: at + content.length }
  // The last section of a prompt part loses its trailing blank line when the
  // parts are joined; the section text itself is unchanged.
  const trimmed = content.trimEnd()
  if (trimmed && trimmed !== content) {
    at = system.indexOf(trimmed, from)
    if (at >= 0) return { start: at, end: at + trimmed.length }
  }
  return null
}

export function createEgressFilter(deps: EgressFilterDeps): EgressFilter {
  const { service } = deps
  // One policy per turn: a tool loop masks its history identically on every
  // iteration even when the policy is swapped mid-run, so bytes already sent
  // (and the reasoning a provider keyed on them) never change under it.
  const pins = new Map<string, PolicySnapshot>()

  function snapshotFor(meta: ModelRequestMetadata | undefined): PolicySnapshot {
    const key = meta?.compositionId ?? meta?.runId
    if (!key) return service.snapshot()
    const hit = pins.get(key)
    if (hit) {
      pins.delete(key)
      pins.set(key, hit)
      return hit
    }
    const snap = service.snapshot()
    pins.set(key, snap)
    while (pins.size > PINNED_RUNS) {
      const oldest = pins.keys().next().value
      if (oldest === undefined) break
      pins.delete(oldest)
    }
    return snap
  }

  function newDigest(
    transport: EgressDigest['transport'],
    locality: Locality,
    provider: AIProvider,
    snap: PolicySnapshot,
    meta?: ModelRequestMetadata,
  ): EgressDigest {
    return {
      transport,
      locality,
      providerId: provider.id,
      rulesetVersion: snap.rulesetVersion,
      ...(meta?.compositionId ? { compositionId: meta.compositionId } : {}),
      ...(meta?.conversationId ? { conversationId: meta.conversationId } : {}),
      ...(meta?.runId ? { runId: meta.runId } : {}),
      ...(meta?.agentId ? { agentId: meta.agentId } : {}),
      sections: [],
      unattributed: { masked: 0, warned: 0 },
      messages: { masked: 0, warned: 0 },
      toolResults: [],
      skippedKeys: [],
      byType: {},
      matches: [],
    }
  }

  /** Records `matches` in the digest and adds them to `counts`. */
  function tally(digest: EgressDigest, counts: EgressCounts, matches: readonly ClassifiedMatch[]): void {
    for (const m of matches) {
      if (isMaskedMatch(m)) counts.masked++
      else counts.warned++
      digest.byType[m.type] = (digest.byType[m.type] ?? 0) + 1
      digest.matches.push({ type: m.type, action: m.action, scanner: m.scanner, confidence: m.confidence })
    }
  }

  function report(digest: EgressDigest): void {
    // Post-privacy attribution for the context inspector, off the call path:
    // the write happens after the request is on its way, and its failure is
    // only logged.
    const compositionId = digest.compositionId
    if (compositionId) {
      queueMicrotask(() => {
        try {
          deps.getRecorder()?.attachEgress?.(compositionId, digest)
        } catch (err) {
          deps.logger.debug({ err: err instanceof Error ? err.message : String(err) }, 'Privacy: egress not attached to the composition')
        }
      })
    }
    if (!deps.onDigest) return
    try {
      deps.onDigest(digest)
    } catch (err) {
      deps.logger.debug({ err: err instanceof Error ? err.message : String(err) }, 'Privacy: egress digest consumer failed')
    }
  }

  function scanSystem(system: string, snap: PolicySnapshot, digest: EgressDigest, compositionId: string | undefined): string {
    const sections = compositionId ? deps.getRecorder()?.sectionsFor(compositionId) ?? null : null
    const pieces: string[] = []
    let cursor = 0

    const scanUnattributed = (text: string) => {
      if (!text.trim()) {
        pieces.push(text)
        return
      }
      const r = snap.redactText(text, REMOTE)
      tally(digest, digest.unattributed, r.matches)
      pieces.push(r.text)
    }

    for (const section of sections ?? []) {
      const found = locate(system, section.content, cursor)
      if (!found) {
        // Its text, wherever it is, is scanned with the unattributed rest.
        digest.sections.push({ ord: section.ord, key: section.key, located: false, skipped: false, spans: [], warned: 0 })
        continue
      }
      scanUnattributed(system.slice(cursor, found.start))
      const text = system.slice(found.start, found.end)
      if (SYSTEM_GENERATED_SECTION_KEYS.has(section.key)) {
        pieces.push(text)
        digest.sections.push({ ord: section.ord, key: section.key, located: true, skipped: true, spans: [], warned: 0 })
        if (!digest.skippedKeys.includes(section.key)) digest.skippedKeys.push(section.key)
      } else {
        const r = snap.redactText(text, REMOTE)
        const counts = { masked: 0, warned: 0 }
        tally(digest, counts, r.matches)
        pieces.push(r.text)
        digest.sections.push({
          ord: section.ord,
          key: section.key,
          located: true,
          skipped: false,
          spans: r.matches.filter(isMaskedMatch).map((m): EgressSpan => [m.start, m.end, m.type]),
          warned: counts.warned,
        })
      }
      cursor = found.end
    }
    scanUnattributed(system.slice(cursor))
    return pieces.join('')
  }

  function toolNamesOf(messages: readonly ModelMessage[]): Map<string, string> {
    const names = new Map<string, string>()
    for (const message of messages) {
      if (!Array.isArray(message.content)) continue
      for (const block of message.content) {
        if (block?.type === 'tool_use' && typeof block.id === 'string') names.set(block.id, block.name)
      }
    }
    return names
  }

  function isMemoryBearing(toolName: string | undefined): boolean {
    if (!toolName) return false
    return deps.getToolRegistry()?.get(toolName)?.memoryBearing === true
  }

  /** Masks a memory tool's result; returns the same value when nothing changed. */
  function maskToolResult(content: unknown, snap: PolicySnapshot, counts: EgressCounts, digest: EgressDigest): unknown {
    if (typeof content === 'string') {
      const head = content.trimStart()[0]
      if (head === '{' || head === '[') {
        let parsed: unknown
        try {
          parsed = JSON.parse(content)
        } catch {
          parsed = undefined
        }
        if (parsed !== null && typeof parsed === 'object') {
          const r = snap.redactValue(parsed, REMOTE)
          tally(digest, counts, r.matches)
          // Unchanged → the original bytes; changed → the same compact JSON the
          // tool loop produced, with only the masked leaves different.
          return r.value === parsed ? content : JSON.stringify(r.value)
        }
      }
      // 'Error: …' strings and plain-text results.
      const r = snap.redactText(content, REMOTE)
      tally(digest, counts, r.matches)
      return r.text
    }
    if (content !== null && typeof content === 'object') {
      const r = snap.redactValue(content, REMOTE)
      tally(digest, counts, r.matches)
      return r.value
    }
    return content
  }

  function scanMessages(messages: ModelMessage[], snap: PolicySnapshot, digest: EgressDigest): ModelMessage[] {
    const toolNames = toolNamesOf(messages)
    let changed = false
    const out = messages.map((message) => {
      if (typeof message.content === 'string') {
        const r = snap.redactText(message.content, REMOTE)
        tally(digest, digest.messages, r.matches)
        if (r.text === message.content) return message
        changed = true
        return { ...message, content: r.text }
      }
      if (!Array.isArray(message.content)) return message

      let blocksChanged = false
      const content = message.content.map((block): ContentBlock => {
        if (block?.type === 'text' && typeof block.text === 'string') {
          const r = snap.redactText(block.text, REMOTE)
          tally(digest, digest.messages, r.matches)
          if (r.text === block.text) return block
          blocksChanged = true
          return { ...block, text: r.text }
        }
        if (block?.type === 'tool_result') {
          const toolName = toolNames.get(block.toolUseId)
          if (!toolName || !isMemoryBearing(toolName)) return block
          const counts = { masked: 0, warned: 0 }
          const masked = maskToolResult(block.content, snap, counts, digest)
          if (counts.masked > 0 || counts.warned > 0) digest.toolResults.push({ toolName, ...counts })
          if (masked === block.content) return block
          blocksChanged = true
          return { ...block, content: masked as string }
        }
        // tool_use inputs, images, thinking and every other block: untouched.
        return block
      })
      if (!blocksChanged) return message
      changed = true
      return { ...message, content }
    })
    return changed ? out : messages
  }

  return {
    request(req: ModelRequest, provider: AIProvider): ModelRequest {
      const snap = snapshotFor(req.metadata)
      if (!snap.enabled) return req
      if (snap.localityOf(provider) === 'local') {
        report(newDigest('gateway', 'local', provider, snap, req.metadata))
        return req
      }

      const digest = newDigest('gateway', 'remote', provider, snap, req.metadata)
      const system = typeof req.system === 'string' && req.system
        ? scanSystem(req.system, snap, digest, req.metadata?.compositionId)
        : req.system
      const messages = Array.isArray(req.messages) ? scanMessages(req.messages, snap, digest) : req.messages
      report(digest)

      if (system === req.system && messages === req.messages) return req
      // Spread-preserving (egress.ts contract): every field this filter does
      // not touch — metadata, tools, effort, signal — keeps its reference.
      return {
        ...req,
        ...(system !== req.system ? { system } : {}),
        ...(messages !== req.messages ? { messages } : {}),
      }
    },

    embed(req: EmbedRequest, provider: AIProvider): EmbedRequest {
      const snap = service.snapshot()
      if (!snap.enabled || snap.localityOf(provider) === 'local' || !Array.isArray(req.texts)) return req

      const digest = newDigest('embed', 'remote', provider, snap)
      let changed = false
      const texts = req.texts.map((text) => {
        const r = snap.redactText(text, REMOTE)
        tally(digest, digest.messages, r.matches)
        if (r.text !== text) changed = true
        return r.text
      })
      report(digest)
      return changed ? { ...req, texts } : req
    },
  }
}
