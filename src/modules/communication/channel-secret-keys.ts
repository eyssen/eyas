// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Maps (instanceId, field) → vault secret name.
// Default catalog instance ids keep the legacy global keys (telegram-bot-token,
// signal-cli-url, …) so existing installs keep working. Extra instances of the
// same type use a namespaced key: channel.<instanceId>.<field>.

import { CHANNEL_CATALOG } from './channel-catalog.js'

const DEFAULT_INSTANCE_IDS = new Set(CHANNEL_CATALOG.map((e) => e.id))

/** True when this id is a built-in catalog singleton (legacy secret names). */
export function isDefaultCatalogInstance(instanceId: string): boolean {
  return DEFAULT_INSTANCE_IDS.has(instanceId)
}

/**
 * Vault key for a channel credential field.
 * @param instanceId channel_configs.channel_id / router channel id
 * @param field catalog secret field name (e.g. telegram-bot-token)
 */
export function vaultSecretName(instanceId: string, field: string): string {
  if (isDefaultCatalogInstance(instanceId)) return field
  return `channel.${instanceId}.${field}`
}

/** Catalog template id used when this instance was created (stored in config JSON). */
export function templateIdFromConfig(config: Record<string, unknown> | undefined, instanceId: string, type: string): string {
  if (config && typeof config.templateId === 'string') return config.templateId
  if (isDefaultCatalogInstance(instanceId)) return instanceId
  // Extra instances: first catalog entry of this type
  return CHANNEL_CATALOG.find((e) => e.type === type)?.id ?? type
}
