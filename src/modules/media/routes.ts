// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/media/routes.ts
//
// Created from onStart, never onRegister — see the api-auth-coverage contract.

import type { Hono } from 'hono'
import { z } from 'zod'
import { requirePermission } from '@modules/permissions/middleware'
import type { McpClient } from '@modules/communication/submodules/mcp-client/client.js'
import type { McpServerRecord } from '@modules/communication/submodules/mcp-client/types.js'
import { startMcpOAuth } from '@modules/communication/submodules/mcp-client/oauth-flow.js'
import type { SecretsRegistry } from '@modules/secrets/types.js'
import { assertBudget } from './budget.js'
import { resolveProviders } from './routing.js'
import {
  MEDIA_KINDS,
  type MediaGateway,
  type MediaJobStatus,
  type MediaKind,
  type MediaSettings,
} from './types.js'

const EMPTY_PROVIDER =
  'No media provider configured for this kind. Open /media and connect Magnific, Higgsfield, or fal.'

const TERMINAL: ReadonlySet<MediaJobStatus> = new Set(['completed', 'failed', 'cancelled'])
const WAIT_DEFAULT_MS = 180_000
const WAIT_MAX_MS = 600_000
const WAIT_POLL_MS = 2_000
const KIND_TUPLE = MEDIA_KINDS as unknown as [MediaKind, ...MediaKind[]]
const STATUS_TUPLE = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const

const kindRoutingSchema = z.object({
  defaultProviderId: z.string().nullable(),
  fallbackProviderId: z.string().nullable(),
  alsoRunOn: z.array(z.string()),
})

const settingsSchema = z.object({
  routing: z.object({
    image: kindRoutingSchema,
    video: kindRoutingSchema,
    audio: kindRoutingSchema,
    upscale: kindRoutingSchema,
    edit: kindRoutingSchema,
    '3d': kindRoutingSchema,
  }),
  budget: z.record(
    z.string(),
    z.object({
      dailyCredits: z.number().nullable(),
      monthlyCredits: z.number().nullable(),
    }),
  ),
  expertRawMcpTools: z.boolean(),
})

const generateSchema = z.object({
  kind: z.enum(KIND_TUPLE),
  prompt: z.string().optional().default(''),
  provider: z.string().optional(),
  providers: z.array(z.string()).optional(),
  model: z.string().optional(),
  documentId: z.string().optional(),
  imageUrl: z.string().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  conversationId: z.string().optional(),
  agentId: z.string().optional(),
})

const waitSchema = z.object({
  timeoutMs: z.number().positive().max(WAIT_MAX_MS).optional(),
})

const disconnectQuery = z.object({
  forget: z.enum(['0', '1']).optional(),
})

const OAUTH_REQUESTER = { userId: 'system', role: 'owner', trusted: true } as const
const OAUTH_PROVIDER_IDS = new Set(['magnific', 'higgsfield'])

export interface MediaRouteExtras {
  mcp?: Pick<McpClient, 'list' | 'get' | 'connect' | 'disconnect'>
  secrets?: Pick<SecretsRegistry, 'delete'>
  db?: { run: (q: unknown) => unknown }
  publicBaseUrl?: string
  startOAuth?: (serverId: string) => Promise<{ url: string }>
}

function findMcpServer(
  mcp: MediaRouteExtras['mcp'],
  providerId: string,
): McpServerRecord | undefined {
  if (!mcp) return undefined
  return mcp.list().find((s) => s.name === providerId) ?? mcp.get(providerId) ?? undefined
}

function isOAuthMediaProvider(id: string, mcp?: MediaRouteExtras['mcp']): boolean {
  const server = findMcpServer(mcp, id)
  if (server) return server.authType === 'oauth'
  return OAUTH_PROVIDER_IDS.has(id)
}

async function startProviderOAuth(
  id: string,
  extras?: MediaRouteExtras,
): Promise<string | null> {
  if (!extras?.mcp) return null
  const server = findMcpServer(extras.mcp, id)
  if (!server?.url || server.authType !== 'oauth') return null
  if (extras.startOAuth) {
    const { url } = await extras.startOAuth(server.id)
    return url
  }
  if (extras.db && extras.publicBaseUrl) {
    const { url } = await startMcpOAuth({
      server: { id: server.id, url: server.url },
      db: extras.db,
      publicBaseUrl: extras.publicBaseUrl,
    })
    return url
  }
  return null
}

async function forgetProviderSecrets(
  id: string,
  extras?: MediaRouteExtras,
): Promise<void> {
  if (!extras?.secrets) return
  const names: string[] = []
  const server = findMcpServer(extras.mcp, id)
  if (server) {
    names.push(`mcp-oauth-${server.id}-access`, `mcp-oauth-${server.id}-refresh`)
  }
  if (id === 'fal') names.push('fal-api-key')
  if (id === 'higgsfield') names.push('higgsfield-api-key', 'higgsfield-api-secret')
  for (const name of names) {
    try {
      await extras.secrets.delete(name, 'system', OAUTH_REQUESTER)
    } catch {
      /* secret may already be gone */
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function utcDayStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

function utcMonthStartIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

function configuredIds(gateway: MediaGateway): string[] {
  return gateway.listProviders().filter((p) => p.configured).map((p) => p.id)
}

function spentSince(gw: MediaGateway, providerId: string, sinceIso: string): number {
  const since = Date.parse(sinceIso)
  if (!Number.isFinite(since)) return 0
  let total = 0
  for (const job of gw.listJobs({ since })) {
    if (job.providerId === providerId && job.credits != null) total += job.credits
  }
  return total
}

function jobError(c: any, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  if (/not found/i.test(msg)) return c.json({ error: msg }, 404)
  if (msg.startsWith('budget:')) return c.json({ error: msg }, 429)
  return c.json({ error: msg }, 400)
}

export function createMediaRoutes(
  app: Hono,
  gw: MediaGateway,
  settings: { load(): MediaSettings; save(s: MediaSettings): void },
  extras?: MediaRouteExtras,
): void {
  app.get('/api/v1/media/providers', requirePermission('read', 'Media'), async (c) => {
    const listed = gw.listProviders()
    const providers = await Promise.all(
      listed.map(async (p) => {
        let balance = null
        if (p.configured) {
          try {
            const provider = gw.getProvider(p.id)
            balance = provider ? await provider.balance() : null
          } catch {
            balance = null
          }
        }
        return { ...p, balance }
      }),
    )
    return c.json({ providers })
  })

  app.post('/api/v1/media/providers/:id/connect', requirePermission('manage', 'Media'), async (c) => {
    const id = c.req.param('id')
    const provider = gw.getProvider(id)
    if (!provider) return c.json({ error: 'Provider not found' }, 404)
    const oauth = isOAuthMediaProvider(id, extras?.mcp)
    try {
      await provider.connect()
    } catch (err) {
      if (!oauth) return jobError(c, err)
    }
    try {
      const url = oauth ? await startProviderOAuth(id, extras) : null
      if (url) return c.json({ url })
    } catch (err) {
      return jobError(c, err)
    }
    const listed = gw.listProviders().find((p) => p.id === id)
    return c.json({ provider: listed ?? { id: provider.id, name: provider.name, capabilities: provider.capabilities, configured: provider.configured } })
  })

  app.post('/api/v1/media/providers/:id/disconnect', requirePermission('manage', 'Media'), async (c) => {
    const id = c.req.param('id')
    const parsed = disconnectQuery.safeParse({ forget: c.req.query('forget') })
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)
    const provider = gw.getProvider(id)
    if (!provider) return c.json({ error: 'Provider not found' }, 404)
    const forget = parsed.data.forget === '1'
    try {
      await provider.disconnect?.({ forget })
    } catch (err) {
      return jobError(c, err)
    }
    if (forget) await forgetProviderSecrets(id, extras)
    const listed = gw.listProviders().find((p) => p.id === id)
    return c.json({
      ok: true,
      forgotten: forget,
      provider: listed ?? {
        id: provider.id,
        name: provider.name,
        capabilities: provider.capabilities,
        configured: provider.configured,
      },
    })
  })

  app.get('/api/v1/media/settings', requirePermission('read', 'Media'), (c) => {
    return c.json(settings.load())
  })

  app.put('/api/v1/media/settings', requirePermission('manage', 'Media'), async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = settingsSchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)
    const previous = settings.load()
    settings.save(parsed.data)
    if (previous.expertRawMcpTools !== parsed.data.expertRawMcpTools && extras?.mcp) {
      for (const server of extras.mcp.list().filter((s) => s.ownedBy === 'media')) {
        try {
          await extras.mcp.connect(server.id)
        } catch {
          /* connect logs internally */
        }
      }
    }
    return c.json(settings.load())
  })

  app.get('/api/v1/media/catalog', requirePermission('read', 'Media'), async (c) => {
    const kindRaw = c.req.query('kind')
    const providerFilter = c.req.query('provider')
    let kind: MediaKind | undefined
    if (kindRaw) {
      if (!(MEDIA_KINDS as readonly string[]).includes(kindRaw)) {
        return c.json({ error: 'kind must be one of: ' + MEDIA_KINDS.join(', ') }, 400)
      }
      kind = kindRaw as MediaKind
    }

    let listed = gw.listProviders().filter((p) => p.configured)
    if (providerFilter) listed = listed.filter((p) => p.id === providerFilter)
    if (listed.length === 0) {
      return c.json({ providers: [], models: [], hint: EMPTY_PROVIDER })
    }

    const models = []
    for (const p of listed) {
      const provider = gw.getProvider(p.id)
      if (!provider) continue
      models.push(...(await provider.catalog(kind)))
    }
    return c.json({ providers: listed, models })
  })

  app.post('/api/v1/media/generate', requirePermission('create', 'Media'), async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = generateSchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)

    const { kind, prompt, provider, providers, model, documentId, imageUrl, options, conversationId, agentId } = parsed.data
    if (!prompt && !(kind === 'upscale' && (documentId || imageUrl))) {
      return c.json({ error: 'prompt is required' }, 400)
    }

    const ids = resolveProviders({
      kind,
      provider,
      providers,
      settings: settings.load(),
      configuredIds: configuredIds(gw),
    })
    if (ids.length === 0) return c.json({ error: EMPTY_PROVIDER }, 400)

    const current = settings.load()
    try {
      for (const providerId of ids) {
        assertBudget({
          providerId,
          settings: current,
          spentDaily: spentSince(gw, providerId, utcDayStartIso()),
          spentMonthly: spentSince(gw, providerId, utcMonthStartIso()),
        })
      }
    } catch (err) {
      return jobError(c, err)
    }

    const references: Array<{ url?: string; documentId?: string }> = []
    if (documentId) references.push({ documentId })
    if (imageUrl) references.push({ url: imageUrl })

    try {
      const jobs = await Promise.all(
        ids.map((providerId) =>
          gw.generate({
            providerId,
            kind,
            prompt,
            model,
            references: references.length > 0 ? references : undefined,
            options,
            conversationId,
            agentId,
            userId: c.get('userId') as string | undefined,
          }),
        ),
      )
      return c.json({ jobs }, 201)
    } catch (err) {
      return jobError(c, err)
    }
  })

  app.get('/api/v1/media/jobs', requirePermission('read', 'Media'), (c) => {
    const conversationId = c.req.query('conversationId') || undefined
    const statusRaw = c.req.query('status')
    let status: MediaJobStatus | undefined
    if (statusRaw) {
      if (!(STATUS_TUPLE as readonly string[]).includes(statusRaw)) {
        return c.json({ error: 'status must be one of: ' + STATUS_TUPLE.join(', ') }, 400)
      }
      status = statusRaw as MediaJobStatus
    }
    const limitRaw = c.req.query('limit')
    const limit = limitRaw && Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : undefined
    return c.json({ jobs: gw.listJobs({ conversationId, status, limit }) })
  })

  app.get('/api/v1/media/jobs/:id', requirePermission('read', 'Media'), async (c) => {
    try {
      const job = await gw.status(c.req.param('id'))
      return c.json({ job })
    } catch (err) {
      return jobError(c, err)
    }
  })

  app.post('/api/v1/media/jobs/:id/wait', requirePermission('create', 'Media'), async (c) => {
    const raw = await c.req.json().catch(() => ({}))
    const parsed = waitSchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'ValidationError', issues: parsed.error.issues }, 400)
    const timeoutMs = parsed.data.timeoutMs ?? WAIT_DEFAULT_MS
    const jobId = c.req.param('id')
    const started = Date.now()
    try {
      let job = await gw.status(jobId)
      while (!TERMINAL.has(job.status)) {
        const elapsed = Date.now() - started
        if (elapsed >= timeoutMs) {
          return c.json({ job, error: 'Timed out waiting for media job' }, 202)
        }
        await sleep(Math.min(WAIT_POLL_MS, timeoutMs - elapsed))
        job = await gw.status(jobId)
      }
      return c.json({ job })
    } catch (err) {
      return jobError(c, err)
    }
  })

  app.post('/api/v1/media/jobs/:id/cancel', requirePermission('create', 'Media'), async (c) => {
    try {
      await gw.cancel(c.req.param('id'))
      const job = await gw.status(c.req.param('id'))
      return c.json({ job })
    } catch (err) {
      return jobError(c, err)
    }
  })
}
