// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono, MiddlewareHandler } from 'hono'
import type { ChannelRouter } from './types.js'
import type { createChannelConfigService } from './channel-config-service.js'
import type { ChannelSetupService } from './channel-setup-service.js'
import { CHANNEL_CATALOG, getCatalogEntry } from './channel-catalog.js'
import { requirePermission } from '@modules/permissions/middleware.js'

export function createCommunicationRoutes(
  app: Hono,
  router: ChannelRouter,
  authenticate?: MiddlewareHandler,
  channelConfigService?: ReturnType<typeof createChannelConfigService>,
  channelHealth?: { get(channelId: string): { status: string; lastError?: string; fatalReason?: string } },
  setup?: ChannelSetupService,
): void {
  if (authenticate) {
    ;(app as any).use('/api/v1/communication/*', authenticate)
  }

  // ── Live router channels (connected adapters only) ──────────────────────
  ;(app as any).get('/api/v1/communication/channels', requirePermission('read', 'Communication'), async (c: any) => {
    // Prefer full setup catalog when available so the UI lists disconnected channels too.
    if (setup) {
      const channels = await setup.list()
      return c.json({ channels })
    }
    const channels = router.listChannels().map((ch) => ({
      id: ch.id,
      type: ch.type,
      name: ch.name,
      connected: ch.connected,
      health: channelHealth?.get(ch.id),
    }))
    return c.json({ channels })
  })

  // Setup readiness for dashboard recommendations
  ;(app as any).get('/api/v1/communication/setup/status', requirePermission('read', 'Communication'), async (c: any) => {
    if (!setup) {
      const connected = router.listChannels().filter((ch) => ch.connected)
      const anyBound = channelConfigService?.list().some((cfg) => cfg.agentId && connected.some((ch) => ch.id === cfg.channelId))
      return c.json({
        ready: !!anyBound,
        connectedCount: connected.length,
        boundConnectedCount: anyBound ? 1 : 0,
      })
    }
    const views = await setup.list()
    const connected = views.filter((v) => v.connected)
    const boundConnected = views.filter((v) => v.connected && v.agentId)
    return c.json({
      ready: await setup.isPrimaryCommReady(),
      connectedCount: connected.length,
      boundConnectedCount: boundConnected.length,
      channels: views.map((v) => ({
        id: v.id,
        status: v.status,
        connected: v.connected,
        agentId: v.agentId,
      })),
    })
  })

  // Create an extra instance of a catalog template (own secrets + agent)
  ;(app as any).post('/api/v1/communication/channels', requirePermission('manage', 'Communication'), async (c: any) => {
    if (!setup) return c.json({ error: 'Channel setup service unavailable' }, 503)
    const body = await c.req.json().catch(() => ({}))
    if (!body.templateId || !body.name) {
      return c.json({ error: 'templateId and name are required' }, 400)
    }
    try {
      const channel = await setup.createInstance({
        templateId: body.templateId,
        name: body.name,
        agentId: body.agentId,
        mode: body.mode,
        secrets: body.secrets,
      })
      return c.json({ channel }, 201)
    } catch (err: any) {
      return c.json({ error: err?.message ?? 'Create failed' }, 400)
    }
  })

  // Templates for the "Add channel" dialog
  ;(app as any).get('/api/v1/communication/channel-templates', requirePermission('read', 'Communication'), (c: any) => {
    return c.json({
      templates: CHANNEL_CATALOG.map((e) => ({
        id: e.id,
        type: e.type,
        name: e.name,
        description: e.description,
        setupIntro: e.setupIntro,
        setupSteps: e.setupSteps,
        secrets: e.secrets.map((s) => ({
          name: s.name,
          required: s.required,
          label: s.label,
          sensitive: s.sensitive !== false,
          hint: s.hint,
          placeholder: s.placeholder,
        })),
        supportsPairing: e.supportsPairing,
        webhookPaths: e.webhookPaths,
        dependencyNote: e.dependencyNote,
      })),
    })
  })

  // Configure secrets + agent binding + reconnect (no process restart)
  ;(app as any).post('/api/v1/communication/channels/:id/configure', requirePermission('manage', 'Communication'), async (c: any) => {
    if (!setup) return c.json({ error: 'Channel setup service unavailable' }, 503)
    const id = c.req.param('id')
    const body = await c.req.json().catch(() => ({}))
    try {
      const channel = await setup.configure({
        channelId: id,
        secrets: body.secrets,
        agentId: body.agentId,
        mode: body.mode,
        name: body.name,
        reconnect: body.reconnect !== false,
        bindPrimaryIfUnbound: body.bindPrimaryIfUnbound !== false,
      })
      return c.json({ channel })
    } catch (err: any) {
      return c.json({ error: err?.message ?? 'Configure failed' }, 400)
    }
  })

  // Reconnect after secrets were set elsewhere
  ;(app as any).post('/api/v1/communication/channels/:id/reconnect', requirePermission('manage', 'Communication'), async (c: any) => {
    if (!setup) return c.json({ error: 'Channel setup service unavailable' }, 503)
    const id = c.req.param('id')
    try {
      const channel = await setup.reconnect(id)
      return c.json({ channel })
    } catch (err: any) {
      return c.json({ error: err?.message ?? 'Reconnect failed' }, 400)
    }
  })

  // Delete a non-default multi-instance channel
  ;(app as any).delete('/api/v1/communication/channels/:id', requirePermission('manage', 'Communication'), async (c: any) => {
    if (!setup) return c.json({ error: 'Channel setup service unavailable' }, 503)
    const id = c.req.param('id')
    try {
      await setup.deleteInstance(id)
      return c.json({ ok: true })
    } catch (err: any) {
      return c.json({ error: err?.message ?? 'Delete failed' }, 400)
    }
  })

  // Get channel detail (catalog or live)
  ;(app as any).get('/api/v1/communication/channels/:id', requirePermission('read', 'Communication'), async (c: any) => {
    const id = c.req.param('id')
    if (setup) {
      const views = await setup.list()
      const view = views.find((v) => v.id === id)
      if (view) return c.json({ channel: view })
    }
    const channel = router.getChannel(id)
    if (!channel) return c.json({ error: 'Channel not found' }, 404)
    return c.json({
      id: channel.id,
      type: channel.type,
      name: channel.name,
      connected: channel.connected,
    })
  })

  // Send test message to a channel
  ;(app as any).post('/api/v1/communication/channels/:id/test', requirePermission('manage', 'Communication'), async (c: any) => {
    const id = c.req.param('id')
    const channel = router.getChannel(id) ?? router.listChannels().find((ch) => ch.type === id)
    if (!channel) return c.json({ error: 'Channel not found or not connected' }, 404)
    if (!channel.connected) return c.json({ error: 'Channel not connected' }, 400)

    try {
      const body = await c.req.json().catch(() => ({}))
      const target = body.target ?? 'test'
      await channel.send(target, { text: body.text ?? 'EYAS test message' })
      return c.json({ ok: true, message: 'Test message sent' })
    } catch (err: any) {
      return c.json({ error: err.message ?? 'Send failed' }, 500)
    }
  })

  // Channel config endpoints (agent binding) — keep for back-compat
  if (channelConfigService) {
    ;(app as any).get('/api/v1/channels', requirePermission('read', 'Communication'), (c: any) => {
      const configs = channelConfigService.list()
      return c.json({ channels: configs })
    })

    ;(app as any).patch('/api/v1/channels/:channelId', requirePermission('manage', 'Communication'), async (c: any) => {
      const channelId = c.req.param('channelId')
      const body = await c.req.json()
      const hasAgent = body.agentId !== undefined
      const hasMode = body.mode !== undefined

      if (!hasAgent && !hasMode) {
        return c.json({ error: 'agentId or mode is required' }, 400)
      }
      if (hasMode && body.mode !== 'managed' && body.mode !== 'autonomous') {
        return c.json({ error: "mode must be 'managed' or 'autonomous'" }, 400)
      }

      // Auto-create binding row for catalog channels that were never ensureChannel'd
      const catalog = getCatalogEntry(channelId)
      if (!channelConfigService.getByChannelId(channelId) && catalog) {
        channelConfigService.ensureChannel({
          channelType: catalog.type,
          channelId: catalog.id,
          name: catalog.name,
        })
      }

      if (!channelConfigService.getByChannelId(channelId)) {
        return c.json({ error: 'Channel config not found' }, 404)
      }

      if (hasAgent) channelConfigService.updateAgent(channelId, body.agentId)
      if (hasMode) channelConfigService.updateMode(channelId, body.mode)

      return c.json({ channel: channelConfigService.getByChannelId(channelId) })
    })
  }
}
