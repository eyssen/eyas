// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Operator-facing multi-instance channel setup.
//
// Each row is a channel *instance* (channel_configs.channel_id = router id).
// Default catalog ids (telegram, signal, …) use legacy global secret names;
// extra instances of the same type use vault keys channel.<instanceId>.<field>
// and can each bind a different agent.

import { generateId } from '@shared/crypto.js'
import {
  CHANNEL_CATALOG,
  getCatalogEntry,
  listCatalogTypes,
  type ChannelCatalogEntry,
} from './channel-catalog.js'
import {
  isDefaultCatalogInstance,
  templateIdFromConfig,
  vaultSecretName,
} from './channel-secret-keys.js'
import type { ChannelRouter } from './types.js'
import type { createChannelConfigService } from './channel-config-service.js'

export type ChannelSetupStatus = 'not_configured' | 'configured' | 'connected' | 'error'

export interface ChannelSetupView {
  id: string
  type: string
  name: string
  description: string
  status: ChannelSetupStatus
  connected: boolean
  configured: boolean
  supportsPairing: boolean
  webhookPaths?: string[]
  dependencyNote?: string
  secrets: Array<{
    name: string
    required: boolean
    label: string
    sensitive: boolean
    hint?: string
    placeholder?: string
    present: boolean
    /** Actual vault key (may be namespaced for extra instances). */
    vaultKey: string
  }>
  agentId: string | null
  mode: 'managed' | 'autonomous'
  health?: { status: string; lastError?: string; fatalReason?: string }
  lastError?: string
  /** True for catalog defaults that cannot be deleted. */
  isDefault: boolean
  /** Catalog template this instance was created from. */
  templateId: string
  setupIntro?: string
  setupSteps?: string[]
}

export interface ChannelSetupServiceDeps {
  router: ChannelRouter
  channelConfigService: ReturnType<typeof createChannelConfigService>
  getSecret: (name: string) => Promise<string | undefined>
  setSecret: (name: string, value: string) => Promise<void>
  deleteSecret?: (name: string) => Promise<void>
  getHealth?: (channelId: string) => { status: string; lastError?: string; fatalReason?: string } | undefined
  reconnect: (input: {
    instanceId: string
    type: string
    name?: string
    config?: Record<string, unknown>
  }) => Promise<{ connected: boolean; error?: string }>
  resolvePrimaryAgentId?: () => string | null
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'ch'
}

export function createChannelSetupService(deps: ChannelSetupServiceDeps) {
  function templateFor(cfg: { channelId: string; channelType: string; config: Record<string, unknown> }): ChannelCatalogEntry {
    const tid = templateIdFromConfig(cfg.config, cfg.channelId, cfg.channelType)
    return getCatalogEntry(tid) ?? getCatalogEntry(cfg.channelType) ?? CHANNEL_CATALOG[0]!
  }

  async function buildView(row: {
    channelId: string
    channelType: string
    name: string
    agentId: string | null
    mode: 'managed' | 'autonomous'
    config: Record<string, unknown>
  }): Promise<ChannelSetupView> {
    const template = templateFor(row)
    const secretMeta = await Promise.all(
      template.secrets.map(async (s) => {
        const vaultKey = vaultSecretName(row.channelId, s.name)
        const v = await deps.getSecret(vaultKey)
        return {
          name: s.name,
          required: s.required,
          label: s.label,
          sensitive: s.sensitive !== false,
          hint: s.hint,
          placeholder: s.placeholder,
          present: !!(v && String(v).length > 0),
          vaultKey,
        }
      }),
    )
    const configured = secretMeta.filter((s) => s.required).every((s) => s.present)
    const live = deps.router.getChannel(row.channelId)
    const connected = !!live?.connected
    const health = deps.getHealth?.(row.channelId)

    let status: ChannelSetupStatus = 'not_configured'
    if (connected) status = 'connected'
    else if (configured) status = health?.status === 'fatal' ? 'error' : 'configured'

    return {
      id: row.channelId,
      type: row.channelType,
      name: row.name,
      description: template.description,
      status,
      connected,
      configured,
      supportsPairing: template.supportsPairing,
      webhookPaths: template.webhookPaths,
      dependencyNote: template.dependencyNote,
      secrets: secretMeta,
      agentId: row.agentId,
      mode: row.mode,
      health: health
        ? { status: health.status, lastError: health.lastError, fatalReason: health.fatalReason }
        : undefined,
      isDefault: isDefaultCatalogInstance(row.channelId),
      templateId: template.id,
      setupIntro: template.setupIntro,
      setupSteps: template.setupSteps,
    }
  }

  async function list(): Promise<ChannelSetupView[]> {
    const types = listCatalogTypes()
    // Ensure default catalog rows exist
    for (const entry of CHANNEL_CATALOG) {
      deps.channelConfigService.ensureChannel({
        channelType: entry.type,
        channelId: entry.id,
        name: entry.name,
      })
    }

    const rows = deps.channelConfigService.listByTypes(types as string[])
    const views = await Promise.all(
      rows.map((r) =>
        buildView({
          channelId: r.channelId,
          channelType: r.channelType,
          name: r.name,
          agentId: r.agentId,
          mode: r.mode,
          config: r.config,
        }),
      ),
    )
    // Defaults first (catalog order), then extra instances by name
    const order = new Map(CHANNEL_CATALOG.map((e, i) => [e.id, i]))
    views.sort((a, b) => {
      const ao = order.has(a.id) ? order.get(a.id)! : 1000
      const bo = order.has(b.id) ? order.get(b.id)! : 1000
      if (ao !== bo) return ao - bo
      if (a.type !== b.type) return a.type.localeCompare(b.type)
      return a.name.localeCompare(b.name)
    })
    return views
  }

  async function configure(input: {
    channelId: string
    secrets?: Record<string, string>
    agentId?: string | null
    mode?: 'managed' | 'autonomous'
    name?: string
    reconnect?: boolean
    bindPrimaryIfUnbound?: boolean
  }): Promise<ChannelSetupView> {
    let row = deps.channelConfigService.getByChannelId(input.channelId)
    if (!row) {
      const entry = getCatalogEntry(input.channelId)
      if (!entry) throw new Error(`Unknown channel instance: ${input.channelId}`)
      deps.channelConfigService.ensureChannel({
        channelType: entry.type,
        channelId: entry.id,
        name: entry.name,
      })
      row = deps.channelConfigService.getByChannelId(input.channelId)!
    }

    const template = templateFor({
      channelId: row.channelId,
      channelType: row.channelType,
      config: row.config,
    })

    if (input.secrets) {
      for (const [field, value] of Object.entries(input.secrets)) {
        if (value == null || value === '') continue
        const allowed = template.secrets.some((s) => s.name === field)
        if (!allowed) throw new Error(`Secret field ${field} is not used by ${template.id}`)
        await deps.setSecret(vaultSecretName(row.channelId, field), value)
      }
    }

    if (input.name?.trim()) {
      deps.channelConfigService.updateName(row.channelId, input.name.trim())
    }

    if (input.agentId !== undefined) {
      deps.channelConfigService.updateAgent(row.channelId, input.agentId)
    } else if (input.bindPrimaryIfUnbound !== false && !row.agentId) {
      const primary = deps.resolvePrimaryAgentId?.() ?? null
      if (primary) deps.channelConfigService.updateAgent(row.channelId, primary)
    }

    if (input.mode) {
      deps.channelConfigService.updateMode(row.channelId, input.mode)
    }

    row = deps.channelConfigService.getByChannelId(input.channelId)!

    if (input.reconnect !== false) {
      const result = await deps.reconnect({
        instanceId: row.channelId,
        type: row.channelType,
        name: row.name,
        config: row.config,
      })
      const view = await buildView({
        channelId: row.channelId,
        channelType: row.channelType,
        name: row.name,
        agentId: row.agentId,
        mode: row.mode,
        config: row.config,
      })
      if (result.error && !result.connected) {
        return { ...view, status: 'error', lastError: result.error }
      }
      return view
    }

    return buildView({
      channelId: row.channelId,
      channelType: row.channelType,
      name: row.name,
      agentId: row.agentId,
      mode: row.mode,
      config: row.config,
    })
  }

  async function reconnect(channelId: string): Promise<ChannelSetupView> {
    const row = deps.channelConfigService.getByChannelId(channelId)
    if (!row) throw new Error(`Unknown channel instance: ${channelId}`)
    const result = await deps.reconnect({
      instanceId: row.channelId,
      type: row.channelType,
      name: row.name,
      config: row.config,
    })
    const view = await buildView({
      channelId: row.channelId,
      channelType: row.channelType,
      name: row.name,
      agentId: row.agentId,
      mode: row.mode,
      config: row.config,
    })
    if (result.error && !result.connected) {
      return { ...view, status: 'error', lastError: result.error }
    }
    return view
  }

  /**
   * Create an extra instance of a catalog template (same type, own secrets + agent).
   * Default catalog ids are never re-created here — use configure on those.
   */
  async function createInstance(input: {
    templateId: string
    name: string
    agentId?: string | null
    mode?: 'managed' | 'autonomous'
    secrets?: Record<string, string>
  }): Promise<ChannelSetupView> {
    const template = getCatalogEntry(input.templateId)
    if (!template) throw new Error(`Unknown template: ${input.templateId}`)
    const name = input.name?.trim()
    if (!name) throw new Error('name is required')

    let instanceId = `${template.type}-${slugify(name)}`
    if (deps.channelConfigService.getByChannelId(instanceId) || isDefaultCatalogInstance(instanceId)) {
      instanceId = `${template.type}-${generateId().slice(0, 8)}`
    }

    const agentId =
      input.agentId !== undefined && input.agentId !== null
        ? input.agentId
        : (deps.resolvePrimaryAgentId?.() ?? null)

    deps.channelConfigService.createInstance({
      channelType: template.type,
      channelId: instanceId,
      name,
      agentId,
      mode: input.mode,
      config: { templateId: template.id },
    })

    if (input.secrets) {
      for (const [field, value] of Object.entries(input.secrets)) {
        if (!value) continue
        const allowed = template.secrets.some((s) => s.name === field)
        if (!allowed) throw new Error(`Secret field ${field} is not used by ${template.id}`)
        await deps.setSecret(vaultSecretName(instanceId, field), value)
      }
    }

    return configure({
      channelId: instanceId,
      agentId,
      mode: input.mode,
      reconnect: true,
      bindPrimaryIfUnbound: false,
    })
  }

  async function deleteInstance(channelId: string): Promise<{ ok: true }> {
    if (isDefaultCatalogInstance(channelId)) {
      throw new Error('Cannot delete the default catalog instance — clear credentials or disconnect instead')
    }
    const row = deps.channelConfigService.getByChannelId(channelId)
    if (!row) throw new Error(`Unknown channel instance: ${channelId}`)

    const template = templateFor({
      channelId: row.channelId,
      channelType: row.channelType,
      config: row.config,
    })

    try {
      deps.router.unregister(channelId)
    } catch {
      /* */
    }

    if (deps.deleteSecret) {
      for (const s of template.secrets) {
        try {
          await deps.deleteSecret(vaultSecretName(channelId, s.name))
        } catch {
          /* ignore missing */
        }
      }
    }

    deps.channelConfigService.deleteByChannelId(channelId)
    return { ok: true }
  }

  async function isPrimaryCommReady(): Promise<boolean> {
    const views = await list()
    return views.some((v) => v.connected && !!v.agentId)
  }

  return { list, configure, reconnect, createInstance, deleteInstance, isPrimaryCommReady }
}

export type ChannelSetupService = ReturnType<typeof createChannelSetupService>
