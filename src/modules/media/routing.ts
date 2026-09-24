// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { MediaKind, MediaSettings } from './types.js'
import { emptyMediaKindRouting } from './types.js'

export function defaultMediaSettings(): MediaSettings {
  return {
    routing: {
      image: emptyMediaKindRouting(),
      video: emptyMediaKindRouting(),
      audio: emptyMediaKindRouting(),
      upscale: emptyMediaKindRouting(),
      edit: emptyMediaKindRouting(),
      '3d': emptyMediaKindRouting(),
    },
    budget: {},
    expertRawMcpTools: false,
  }
}

export function suggestedProviderId(kind: MediaKind): string {
  switch (kind) {
    case 'upscale':
    case 'image':
    case 'edit':
      return 'magnific'
    case 'video':
      return 'higgsfield'
    case 'audio':
    case '3d':
      return 'fal'
  }
}

function pickConfigured(ids: string[], configured: Set<string>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (!id || !configured.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function resolveProviders(input: {
  kind: MediaKind
  provider?: string
  providers?: string[]
  settings: MediaSettings
  configuredIds: string[]
}): string[] {
  const configured = new Set(input.configuredIds)

  if (input.providers && input.providers.length > 0) {
    return pickConfigured(input.providers, configured)
  }

  if (input.provider) {
    return pickConfigured([input.provider], configured)
  }

  const routing = input.settings.routing[input.kind]
  const ordered: string[] = []

  if (routing.defaultProviderId) {
    if (configured.has(routing.defaultProviderId)) {
      ordered.push(routing.defaultProviderId)
    } else if (routing.fallbackProviderId && configured.has(routing.fallbackProviderId)) {
      ordered.push(routing.fallbackProviderId)
    }
  } else {
    const suggested = suggestedProviderId(input.kind)
    if (configured.has(suggested)) {
      ordered.push(suggested)
    }
  }

  for (const id of routing.alsoRunOn) {
    ordered.push(id)
  }

  const fromRouting = pickConfigured(ordered, configured)
  if (fromRouting.length > 0) return fromRouting

  if (input.configuredIds.length === 1) {
    return [input.configuredIds[0]!]
  }

  return []
}
