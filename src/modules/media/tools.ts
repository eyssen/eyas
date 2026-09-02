// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ToolContext, ToolImplementation, ToolResult } from '@modules/tools/types.js'
import { assertBudget } from './budget.js'
import { resolveProviders } from './routing.js'
import {
  MEDIA_KINDS,
  type MediaBalance,
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

const KIND_ENUM = [...MEDIA_KINDS]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorOf(err: unknown): ToolResult {
  return { error: err instanceof Error ? err.message : String(err) }
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

function parseKind(raw: unknown): MediaKind | undefined {
  if (typeof raw !== 'string') return undefined
  return (MEDIA_KINDS as readonly string[]).includes(raw) ? (raw as MediaKind) : undefined
}

function stringList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out = raw.filter((v): v is string => typeof v === 'string' && v.length > 0)
  return out.length > 0 ? out : undefined
}

function clampWaitTimeout(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n) || n <= 0) return WAIT_DEFAULT_MS
  return Math.min(n, WAIT_MAX_MS)
}

export function createMediaTools(deps: {
  getGateway: () => MediaGateway | undefined
  getSettings: () => MediaSettings
  sumCredits: (providerId: string, sinceIso: string) => number
}): ToolImplementation[] {
  return [
    {
      name: 'media_generate',
      description:
        'Generate, upscale, or edit media via a configured provider (Magnific, Higgsfield, or fal). Returns job id(s) immediately — call media_wait for a terminal result. Use media_catalog before inventing model ids.',
      category: 'custom',
      riskTier: 'yellow',
      inputSchema: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: KIND_ENUM,
            description: 'Media kind to generate',
          },
          prompt: {
            type: 'string',
            description: 'Generation prompt (required except upscale-from-ref)',
          },
          provider: {
            type: 'string',
            description: 'Pin a single provider: magnific | higgsfield | fal',
          },
          providers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Fan-out across these providers; overrides provider',
          },
          model: { type: 'string', description: 'Provider model id from media_catalog' },
          documentId: { type: 'string', description: 'Existing EYAS document as input' },
          imageUrl: { type: 'string', description: 'Reference image URL' },
          options: {
            type: 'object',
            properties: {
              aspect: { type: 'string' },
              durationSec: { type: 'number' },
              scale: { type: 'number', enum: [2, 4, 8, 16] },
              mode: { type: 'string', enum: ['creative', 'precision'] },
            },
          },
        },
        required: ['kind'],
      },
      execute: async (input, ctx) => {
        try {
          return await generate(deps, input, ctx)
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'media_wait',
      description:
        'Poll a media job until it is completed, failed, or cancelled. Returns the job including documentIds after ingest.',
      category: 'custom',
      riskTier: 'yellow',
      timeoutMs: WAIT_MAX_MS + 10_000,
      inputSchema: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'Job id from media_generate' },
          timeoutMs: {
            type: 'number',
            description: `Wait timeout in ms (default ${WAIT_DEFAULT_MS}, max ${WAIT_MAX_MS})`,
          },
        },
        required: ['jobId'],
      },
      execute: async (input) => {
        try {
          return await waitForJob(deps, input)
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'media_catalog',
      description:
        'List models from configured media providers. Call this before inventing model ids for media_generate.',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: KIND_ENUM, description: 'Filter models by kind' },
          provider: { type: 'string', description: 'Limit to one provider id' },
        },
      },
      execute: async (input) => {
        try {
          return await catalog(deps, input)
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'media_balance',
      description: 'Read remaining credits from every configured media provider.',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      execute: async () => {
        try {
          return await balance(deps)
        } catch (err) {
          return errorOf(err)
        }
      },
    },
    {
      name: 'media_history',
      description:
        'List local media jobs for this conversation (or recent jobs). Never the vendor dashboard.',
      category: 'custom',
      riskTier: 'green',
      inputSchema: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'Override conversation filter' },
          limit: { type: 'number', description: 'Max jobs to return' },
        },
      },
      execute: async (input, ctx) => {
        try {
          return await history(deps, input, ctx)
        } catch (err) {
          return errorOf(err)
        }
      },
    },
  ]
}

async function generate(
  deps: {
    getGateway: () => MediaGateway | undefined
    getSettings: () => MediaSettings
    sumCredits: (providerId: string, sinceIso: string) => number
  },
  input: Record<string, unknown>,
  ctx?: ToolContext,
): Promise<ToolResult> {
  const gateway = deps.getGateway()
  const kind = parseKind(input.kind)
  if (!kind) return { error: 'kind must be one of: ' + KIND_ENUM.join(', ') }

  const prompt = typeof input.prompt === 'string' ? input.prompt : ''
  const documentId = typeof input.documentId === 'string' ? input.documentId : undefined
  const imageUrl = typeof input.imageUrl === 'string' ? input.imageUrl : undefined
  if (!prompt && !(kind === 'upscale' && (documentId || imageUrl))) {
    return { error: 'prompt is required' }
  }

  if (!gateway) return { error: EMPTY_PROVIDER }

  const ids = resolveProviders({
    kind,
    provider: typeof input.provider === 'string' ? input.provider : undefined,
    providers: stringList(input.providers),
    settings: deps.getSettings(),
    configuredIds: configuredIds(gateway),
  })
  if (ids.length === 0) return { error: EMPTY_PROVIDER }

  const settings = deps.getSettings()
  for (const providerId of ids) {
    assertBudget({
      providerId,
      settings,
      spentDaily: deps.sumCredits(providerId, utcDayStartIso()),
      spentMonthly: deps.sumCredits(providerId, utcMonthStartIso()),
    })
  }

  const references: Array<{ url?: string; documentId?: string }> = []
  if (documentId) references.push({ documentId })
  if (imageUrl) references.push({ url: imageUrl })

  const options =
    input.options && typeof input.options === 'object' && !Array.isArray(input.options)
      ? (input.options as Record<string, unknown>)
      : undefined

  const jobs = await Promise.all(
    ids.map((providerId) =>
      gateway.generate({
        providerId,
        kind,
        prompt,
        model: typeof input.model === 'string' ? input.model : undefined,
        references: references.length > 0 ? references : undefined,
        options,
        conversationId: ctx?.conversationId,
        agentId: ctx?.agentId,
        userId: ctx?.userId,
      }),
    ),
  )
  return { jobs }
}

async function waitForJob(
  deps: { getGateway: () => MediaGateway | undefined },
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const gateway = deps.getGateway()
  if (!gateway) return { error: EMPTY_PROVIDER }

  const jobId = typeof input.jobId === 'string' ? input.jobId : ''
  if (!jobId) return { error: 'jobId is required' }

  const timeoutMs = clampWaitTimeout(input.timeoutMs)
  const started = Date.now()
  let job = await gateway.status(jobId)
  while (!TERMINAL.has(job.status)) {
    const elapsed = Date.now() - started
    if (elapsed >= timeoutMs) {
      return { job, error: 'Timed out waiting for media job' }
    }
    await sleep(Math.min(WAIT_POLL_MS, timeoutMs - elapsed))
    job = await gateway.status(jobId)
  }
  return { job }
}

async function catalog(
  deps: { getGateway: () => MediaGateway | undefined },
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const gateway = deps.getGateway()
  const kind = input.kind !== undefined ? parseKind(input.kind) : undefined
  if (input.kind !== undefined && !kind) {
    return { error: 'kind must be one of: ' + KIND_ENUM.join(', ') }
  }

  const empty = { providers: [], models: [], hint: EMPTY_PROVIDER }
  if (!gateway) return empty

  let listed = gateway.listProviders().filter((p) => p.configured)
  if (typeof input.provider === 'string' && input.provider) {
    listed = listed.filter((p) => p.id === input.provider)
  }
  if (listed.length === 0) return empty

  const models = []
  for (const p of listed) {
    const provider = gateway.getProvider(p.id)
    if (!provider) continue
    models.push(...(await provider.catalog(kind)))
  }
  return { providers: listed, models }
}

async function balance(deps: { getGateway: () => MediaGateway | undefined }): Promise<ToolResult> {
  const gateway = deps.getGateway()
  if (!gateway) return { balances: [] }

  const balances: MediaBalance[] = []
  for (const p of gateway.listProviders().filter((x) => x.configured)) {
    const provider = gateway.getProvider(p.id)
    if (!provider?.balance) {
      balances.push({ providerId: p.id, credits: null, unit: 'credits' })
      continue
    }
    const row = await provider.balance()
    balances.push(row ?? { providerId: p.id, credits: null, unit: 'credits' })
  }
  return { balances }
}

function history(
  deps: { getGateway: () => MediaGateway | undefined },
  input: Record<string, unknown>,
  ctx?: ToolContext,
): ToolResult {
  const gateway = deps.getGateway()
  if (!gateway) return { jobs: [] }

  const conversationId =
    typeof input.conversationId === 'string' && input.conversationId
      ? input.conversationId
      : ctx?.conversationId
  const limit = typeof input.limit === 'number' && Number.isFinite(input.limit) ? input.limit : undefined
  return { jobs: gateway.listJobs({ conversationId, limit }) }
}
