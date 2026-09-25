// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The privacy audit event. ONE 'eyas.privacy.egress' per model call (or per
// memory tool result sent past the gateway) in which something was masked or
// warned — with the conversation, run, agent, turn, the prompt sections and
// tool names it happened in, and counts per type. The audit module persists
// every 'eyas.*' event, so this becomes the audit action 'privacy.egress'
// with the conversation as its target. A detected value is never part of it.

import type { EgressDigest } from './egress-filter.js'
import type { Locality, OutboundTransport, ToolOutputDigest } from './service.js'

export const PRIVACY_EGRESS_EVENT = 'eyas.privacy.egress'

/** Where the value left EYAS: the model gateway, an embedder, or a transport around the gateway. */
export type EgressTransport = 'gateway' | 'embed' | OutboundTransport

/** Pseudo section key for system-prompt text outside every recorded section. */
export const UNATTRIBUTED_SECTION_KEY = 'unattributed'

export interface PrivacyEgressEvent {
  /** The audit entry's target: the conversation, when the call had one. */
  targetId: string | null
  conversationId: string | null
  runId: string | null
  agentId: string | null
  /** The context composition of the turn (gateway calls). */
  compositionId: string | null
  /** The answer turn of a bridged tool call — the composition id when the turn recorded one. */
  turnId: string | null
  /** Null for transports that do not know the model behind them (CLI bridges, external MCP, OpenCode). */
  providerId: string | null
  locality: Locality
  transport: EgressTransport
  rulesetVersion: string
  /** Values replaced by a placeholder. */
  masked: number
  /** Warn-class values left in the text. */
  warned: number
  /** Detections per type. */
  byType: Record<string, number>
  /** Recorded prompt sections with a detection ('unattributed': system text outside them). */
  sectionKeys: string[]
  /** Detections in the conversation history (messages and text blocks; embed: the embedded texts). */
  historyMatches: number
  /** Memory tools whose results had a detection. */
  toolNames: string[]
}

/** The event for one gateway or embed call, or null when nothing was detected (or the destination was local). */
export function egressEventOf(digest: EgressDigest): PrivacyEgressEvent | null {
  if (digest.locality !== 'remote' || digest.matches.length === 0) return null
  const masked = digest.matches.filter((m) => m.action !== 'warn').length
  const sectionKeys: string[] = []
  for (const s of digest.sections) {
    if ((s.spans.length > 0 || s.warned > 0) && !sectionKeys.includes(s.key)) sectionKeys.push(s.key)
  }
  if (digest.unattributed.masked + digest.unattributed.warned > 0) sectionKeys.push(UNATTRIBUTED_SECTION_KEY)
  const toolNames: string[] = []
  for (const t of digest.toolResults) {
    if (!toolNames.includes(t.toolName)) toolNames.push(t.toolName)
  }
  return {
    targetId: digest.conversationId ?? null,
    conversationId: digest.conversationId ?? null,
    runId: digest.runId ?? null,
    agentId: digest.agentId ?? null,
    compositionId: digest.compositionId ?? null,
    turnId: null,
    providerId: digest.providerId,
    locality: digest.locality,
    transport: digest.transport,
    rulesetVersion: digest.rulesetVersion,
    masked,
    warned: digest.matches.length - masked,
    byType: { ...digest.byType },
    sectionKeys,
    historyMatches: digest.messages.masked + digest.messages.warned,
    toolNames,
  }
}

/** The event for one memory tool result sent past the gateway, or null when nothing was detected. */
export function toolOutputEventOf(digest: ToolOutputDigest): PrivacyEgressEvent | null {
  if (digest.masked + digest.warned === 0) return null
  return {
    targetId: digest.conversationId ?? null,
    conversationId: digest.conversationId ?? null,
    runId: digest.runId ?? null,
    agentId: digest.agentId ?? null,
    compositionId: null,
    turnId: digest.turnId ?? null,
    providerId: null,
    // Every transport around the gateway is a remote destination.
    locality: 'remote',
    transport: digest.transport,
    rulesetVersion: digest.rulesetVersion,
    masked: digest.masked,
    warned: digest.warned,
    byType: { ...digest.byType },
    sectionKeys: [],
    historyMatches: 0,
    toolNames: [digest.toolName],
  }
}
