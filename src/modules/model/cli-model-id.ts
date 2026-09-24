// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Which model a CLI runs for an EYAS model id. EYAS names CLI models
// `<prefix><cli model>` (grok-cli-grok-4.6, claude-code-opus); the name the
// CLI itself takes comes from, in this order:
//   1. the persisted model_config metadata — realModelId, or the alias for
//      Claude Code, whose runtime resolves its aliases itself;
//   2. the id with the provider prefix stripped;
//   3. the id as given (a raw CLI model name such as 'claude-opus-4-8').
// The provider's default id means "the CLI's own default": no model is sent.
// Nothing here ever substitutes another model, so a restart, a missing
// catalog row or an unknown id can never turn into a silent run of the
// default while every surface reports the chosen one.

import { z } from 'zod'
import type { ModelConfigMetadata } from './provider-config-service.js'

/**
 * A model name a CLI may receive (it becomes a `--model` argument or a
 * session option). Starts with a letter or digit, so it can never read as a
 * flag; brackets allow Claude Code's context suffix ('opus[1m]').
 */
export const CliModelNameSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/@+[\]-]*$/)

/** Persisted metadata of one EYAS model id of this provider (null: nothing known). */
export type CliModelMetadataLookup = (eyasModelId: string) => Pick<ModelConfigMetadata, 'alias' | 'realModelId'> | null | undefined

export interface ResolveCliModelInput {
  /** The provider's EYAS id prefix, with its dash: 'grok-cli-'. */
  prefix: string
  /** The EYAS id that means the CLI's own default model ('grok-cli-default'). */
  defaultId?: string
  /** The requested EYAS model id (request.model). */
  eyasModelId: string | undefined
  /** Persisted model_config metadata for an id; a throwing lookup counts as "nothing known". */
  lookup?: CliModelMetadataLookup
  /** Which metadata field names the CLI's model: realModelId (default) or alias (Claude Code). */
  field?: 'realModelId' | 'alias'
}

export class CliModelIdError extends Error {
  constructor(readonly modelId: string, reason: string) {
    super(`Model '${modelId}' cannot be run by this CLI: ${reason}`)
    this.name = 'CliModelIdError'
  }
}

/**
 * The CLI model name for an EYAS model id, or undefined for "the CLI's own
 * default" (no id, or the provider's default id). Throws CliModelIdError for
 * an id that names no model (a bare prefix) or a name a CLI must not receive.
 */
export function resolveCliModel(input: ResolveCliModelInput): string | undefined {
  const id = input.eyasModelId?.trim()
  if (!id) return undefined
  if (input.defaultId && id === input.defaultId) return undefined

  const bare = input.prefix.replace(/-+$/, '')
  if (id === input.prefix || id === bare) throw new CliModelIdError(id, 'the id names no model')

  let persisted: string | undefined
  try {
    const metadata = input.lookup?.(id)
    const value = metadata?.[input.field ?? 'realModelId']
    if (typeof value === 'string' && value.trim()) persisted = value.trim()
  } catch {
    persisted = undefined
  }

  const name = persisted ?? (id.startsWith(input.prefix) ? id.slice(input.prefix.length) : id)
  if (!CliModelNameSchema.safeParse(name).success) throw new CliModelIdError(id, 'not a valid model name')
  return name
}

/** The catalog rows a runtime-verification check reads (a ProviderConfigService satisfies it). */
export interface RuntimeVerifiedCatalog {
  listModels(providerId: string): ReadonlyArray<{
    modelId: string
    enabled: boolean
    metadata?: Pick<ModelConfigMetadata, 'discoveredAt' | 'missingSince'> | null
  }>
}

/**
 * Did the CLI's own runtime discovery confirm this model id? True only for an
 * enabled row the latest successful discovery offered (it carries the
 * discovery timestamp and no missing flag). A seed row, a row a later
 * discovery no longer offered, a switched-off row or a failing catalog is
 * never verified — the caller then pins the CLI by provider only.
 */
export function isRuntimeVerifiedModel(catalog: RuntimeVerifiedCatalog, providerId: string, modelId: string): boolean {
  let row: ReturnType<RuntimeVerifiedCatalog['listModels']>[number] | undefined
  try {
    row = catalog.listModels(providerId).find((r) => r.modelId === modelId)
  } catch {
    return false
  }
  return !!row && row.enabled && !!row.metadata?.discoveredAt && !row.metadata.missingSince
}
