// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Egress slot: the one place inside the raw model gateway where a request is
// transformed on its way out to a provider. The gateway applies the installed
// filter on EVERY attempt, right after it resolved which provider answers —
// the first attempt, the same-provider retry and the tier-fallback hop are
// each filtered for the provider they actually reach, and a gateway reference
// captured before the filter was installed still goes through it. embed() is
// filtered the same way. The privacy module installs its filter here; nothing
// wraps ctx.model for this any more.

import type { AIProvider, EmbedRequest, ModelRequest } from './types.js'

/**
 * A transformation applied to outgoing model traffic.
 *
 * Contract (every co-editor of gateway.ts relies on it):
 * - Pure and synchronous: it never calls a model or does I/O on the hot path.
 * - It receives the RAW attempt — never its own earlier output — so a retry
 *   or a fallback hop is never filtered twice.
 * - It returns the SAME object when nothing changed. Otherwise it returns a
 *   shallow copy that spreads every field it does not touch (metadata, tools,
 *   signal, effort and any field added later), so no other contract is lost.
 * - It never mutates its input.
 * - A throw fails the call: the request is never sent unfiltered.
 */
export interface EgressFilter {
  request(req: ModelRequest, provider: AIProvider): ModelRequest
  embed(req: EmbedRequest, provider: AIProvider): EmbedRequest
}

/** Holds at most one EgressFilter. A second concurrent install is a bug, not a chain. */
export interface EgressSlot {
  /** Installs the filter; returns its uninstall function. Throws while another filter is installed. */
  install(filter: EgressFilter): () => void
  /** The installed filter, or undefined for a byte-identical passthrough. */
  current(): EgressFilter | undefined
}

export function createEgressSlot(): EgressSlot {
  let installed: EgressFilter | undefined
  return {
    install(filter) {
      if (installed) {
        throw new Error('An egress filter is already installed: the model gateway has exactly one egress slot')
      }
      installed = filter
      return () => {
        // Uninstalling twice, or after someone else replaced it, is a no-op.
        if (installed === filter) installed = undefined
      }
    },
    current: () => installed,
  }
}

/** Applies the slot's filter to one request attempt bound for `provider`. */
export function applyRequestEgress(slot: EgressSlot | undefined, req: ModelRequest, provider: AIProvider): ModelRequest {
  const filter = slot?.current()
  if (!filter) return req
  const out = filter.request(req, provider)
  // Fail closed: a filter bug must never turn into an unfiltered send.
  if (!out || typeof out !== 'object') throw new TypeError(`Egress filter returned no request for provider '${provider.id}'`)
  return out
}

/** Applies the slot's filter to an embedding request bound for `provider`. */
export function applyEmbedEgress(slot: EgressSlot | undefined, req: EmbedRequest, provider: AIProvider): EmbedRequest {
  const filter = slot?.current()
  if (!filter) return req
  const out = filter.embed(req, provider)
  if (!out || typeof out !== 'object') throw new TypeError(`Egress filter returned no embed request for provider '${provider.id}'`)
  return out
}
