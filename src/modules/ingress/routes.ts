// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { IngressProvider } from './types.js'
import { publicIngressStatus } from './types.js'
import {
  INGRESS_TOKEN_SECRET,
  loadIngressSettings,
  resolveIngressCredentials,
  saveIngressSettings,
} from './settings-store.js'
import { assertTunnelToken } from './tunnel-token.js'

export function createIngressRoutes(
  app: Hono,
  provider: IngressProvider,
  getSecret?: (key: string) => Promise<string | null>,
  setSecret?: (key: string, value: string) => Promise<void>,
): void {
  app.get('/api/v1/ingress/settings', requirePermission('read', 'Ingress'), async (c) => {
    return c.json(await publicSettings(getSecret))
  })

  app.put('/api/v1/ingress/settings', requirePermission('manage', 'Ingress'), async (c) => {
    const body = await c.req.json().catch(() => ({})) as { hostname?: string; token?: string }
    const current = loadIngressSettings()
    const hostname = typeof body.hostname === 'string' ? body.hostname : current.hostname
    try {
      saveIngressSettings({ hostname })
    } catch (err: any) {
      throw new HTTPException(400, { message: err.message ?? 'Invalid hostname' })
    }
    const token = typeof body.token === 'string' ? body.token : ''
    if (token.trim()) {
      if (!setSecret) {
        throw new HTTPException(500, { message: 'Secrets vault is not available' })
      }
      try {
        await setSecret(INGRESS_TOKEN_SECRET, assertTunnelToken(token))
      } catch (err: any) {
        throw new HTTPException(400, { message: err.message ?? 'Invalid tunnel token' })
      }
    }
    return c.json(await publicSettings(getSecret))
  })

  app.post('/api/v1/ingress/start', requirePermission('manage', 'Ingress'), async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}))
      const creds = await resolveIngressCredentials(
        { token: body.token, hostname: body.hostname },
        getSecret,
      )
      if (body.hostname || body.token) {
        saveIngressSettings({ hostname: creds.hostname })
        if (body.token?.trim() && setSecret) {
          await setSecret(INGRESS_TOKEN_SECRET, assertTunnelToken(body.token))
        }
      }
      const status = await provider.start(creds)
      return c.json({
        message: 'Ingress tunnel started',
        ...publicIngressStatus(status),
        ...(await publicSettings(getSecret)),
      })
    } catch (err: any) {
      throw new HTTPException(500, { message: err.message ?? 'Failed to start ingress' })
    }
  })

  app.post('/api/v1/ingress/stop', requirePermission('manage', 'Ingress'), async (c) => {
    await provider.stop()
    return c.json({
      message: 'Ingress tunnel stopped',
      ...publicIngressStatus(provider.getStatus()),
      ...(await publicSettings(getSecret)),
    })
  })

  app.get('/api/v1/ingress/status', requirePermission('read', 'Ingress'), async (c) => {
    const saved = await publicSettings(getSecret)
    const live = publicIngressStatus(provider.getStatus())
    return c.json({
      ...live,
      hostname: live.hostname || saved.hostname,
      tokenConfigured: saved.tokenConfigured,
    })
  })
}

async function publicSettings(
  getSecret?: (key: string) => Promise<string | null>,
): Promise<{ hostname: string; tokenConfigured: boolean }> {
  const saved = loadIngressSettings()
  const token = getSecret ? await getSecret(INGRESS_TOKEN_SECRET) : null
  return {
    hostname: saved.hostname,
    tokenConfigured: Boolean(token),
  }
}
