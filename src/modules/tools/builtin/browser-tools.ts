// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { mkdtemp, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { resolveInstance } from '@core/instance.js'
import type { ToolContext, ToolImplementation } from '../types.js'
import { createBrowserSessionManager, type BrowserTarget } from './browser-session.js'
import { resolveToolPath } from './path-utils.js'
import { workspaceFromContext } from '../working-directories.js'
import {
  cacheableActions,
  createActionCacheStore,
  originFromUrl,
  publicCacheEntry,
  resolveActionCachePath,
  type CacheableAction,
} from './browser-action-cache.js'
import { generateTotp } from './totp.js'
import { readOsKeychainPassword } from '@modules/secrets/providers/os-keychain.js'

export interface BrowserToolsDeps {
  getDocuments?: () => any
  dataDir?: string
  getVaultBasePath?: () => string | null | undefined
  getSecrets?: () => { get(name: string, scope: string): Promise<string | null> } | null | undefined
  readOsKeychain?: (service: string, account?: string) => Promise<string | null>
  /** Test seam: skip Playwright launch. */
  launch?: () => Promise<{ browser: any; context: any; page: any }>
  persistProfile?: boolean
}

const targetSchema = z.object({
  index: z.number().int().positive().optional(),
  selector: z.string().min(1).optional(),
  snapshotId: z.string().min(1).optional(),
  intent: z.string().min(1).max(200).optional(),
})

function asTarget(input: Record<string, unknown>): BrowserTarget {
  return {
    selector: typeof input.selector === 'string' ? input.selector : undefined,
    index: typeof input.index === 'number' ? input.index : undefined,
    snapshotId: typeof input.snapshotId === 'string' ? input.snapshotId : undefined,
  }
}

function err(err: unknown): { error: string } {
  return { error: err instanceof Error ? err.message : String(err) }
}

async function streamToBuffer(data: ReadableStream): Promise<Buffer> {
  const reader = data.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    chunks.push(value)
  }
  return Buffer.concat(chunks, total)
}

async function documentBytes(docs: any, documentId: string): Promise<{ filename: string; file: Buffer }> {
  if (!docs?.download) throw new Error('Documents module cannot download files')
  const rec = typeof docs.getById === 'function' ? docs.getById(documentId) : null
  const dl = await docs.download(documentId)
  if (!dl) throw new Error(`Document not found: ${documentId}`)
  const file = await streamToBuffer(dl.data)
  const filename = rec?.filename || dl.meta?.filename || `document-${documentId}`
  return { filename, file }
}

function resolveUploadPaths(paths: string[], ctx?: ToolContext): string[] {
  const ws = workspaceFromContext(ctx)
  if (!ws.ok) throw new Error(ws.error)
  return paths.map((p) => {
    const resolved = resolveToolPath(p, ws.primary, ws.roots)
    if (!resolved.ok) throw new Error(resolved.error)
    return resolved.absolute
  })
}

export function createBrowserTools(deps: BrowserToolsDeps = {}): ToolImplementation[] {
  const getDocuments = deps.getDocuments
  const dataDir = deps.dataDir ?? resolveInstance({ ensureDirs: false }).dataDir
  const browser = createBrowserSessionManager({
    maxSessionDurationMs: 300_000, // 5 minutes
    headless: true,
    screenshotDir: 'data/screenshots',
    dataDir,
    persistProfile: deps.persistProfile ?? true,
    getDocuments: () => getDocuments?.() ?? null,
    launch: deps.launch,
  })

  function cacheStore(ctx?: ToolContext) {
    return createActionCacheStore({
      path: resolveActionCachePath({
        dataDir,
        vaultBasePath: deps.getVaultBasePath?.() ?? null,
        projectId: ctx?.projectId ?? null,
      }),
    })
  }

  async function captureForIntent(
    input: Record<string, unknown>,
  ): Promise<{ origin: string; locator: Awaited<ReturnType<typeof browser.durableLocator>> } | { error: string } | null> {
    if (typeof input.intent !== 'string' || !input.intent.trim()) return null
    try {
      const { origin } = await browser.currentUrl()
      const locator = await browser.durableLocator(asTarget(input))
      return { origin, locator }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }

  async function commitIntent(
    ctx: ToolContext | undefined,
    input: Record<string, unknown>,
    action: CacheableAction,
    captured: Awaited<ReturnType<typeof captureForIntent>>,
  ): Promise<Record<string, unknown>> {
    if (!captured) return {}
    if ('error' in captured) return { remembered: false, rememberError: captured.error }
    try {
      const entry = await cacheStore(ctx).remember({
        origin: captured.origin,
        intent: input.intent as string,
        action,
        locator: captured.locator,
      })
      return { remembered: true, cache: publicCacheEntry(entry) }
    } catch (e) {
      return { remembered: false, rememberError: e instanceof Error ? e.message : String(e) }
    }
  }

  async function resolveTotpSecret(name: string, scope: string, account?: string): Promise<string> {
    const secrets = deps.getSecrets?.()
    if (secrets?.get) {
      const fromVault = await secrets.get(name, scope)
      if (fromVault) return fromVault
    }
    const readKeychain = deps.readOsKeychain ?? readOsKeychainPassword
    const fromKc = await readKeychain(name, account)
    if (fromKc) return fromKc
    const prefixed = await readKeychain(`eyas-totp-${name}`, account)
    if (prefixed) return prefixed
    throw new Error(
      `TOTP secret not found. Store "${name}" in Secrets (scope ${scope}) or macOS Keychain (service "${name}" or "eyas-totp-${name}").`,
    )
  }

  return [
    {
      name: 'browser_navigate',
      description:
        'Navigate to a URL in the browser. Returns page title and current URL. Use for research, web scraping, form filling.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
        },
        required: ['url'],
      },
      validator: z.object({ url: z.string().min(1) }),
      execute: async (input) => {
        try {
          return await browser.navigate(input.url as string)
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_click',
      description:
        'Click an element on the current page. Prefer `index` from the last browser_snapshot interactive list. CSS `selector` is the fallback. Indexes die on navigation — snapshot again.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          index: {
            type: 'number',
            description: '1-based interactive index from the last browser_snapshot',
          },
          selector: {
            type: 'string',
            description: 'CSS selector (only if you have no index)',
          },
          snapshotId: {
            type: 'string',
            description: 'Optional snapshotId from browser_snapshot to prove the index is still valid',
          },
          intent: {
            type: 'string',
            description:
              'Optional phrase to remember a durable locator (not the index) for browser_replay on the next run. Never stores fill values.',
          },
        },
      },
      validator: targetSchema,
      execute: async (input, ctx) => {
        try {
          const captured = await captureForIntent(input)
          const result = await browser.click(asTarget(input))
          return { ...result, ...(await commitIntent(ctx, input, 'click', captured)) }
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_fill',
      description:
        'Fill an input on the current page. Prefer `index` from the last browser_snapshot. CSS `selector` is the fallback. Indexes die on navigation.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          index: {
            type: 'number',
            description: '1-based interactive index from the last browser_snapshot',
          },
          selector: {
            type: 'string',
            description: 'CSS selector of input element',
          },
          snapshotId: { type: 'string', description: 'Optional snapshotId from browser_snapshot' },
          value: { type: 'string', description: 'Value to fill. For 2FA, pass the code from browser_totp — never the seed.' },
          intent: {
            type: 'string',
            description: 'Optional phrase to remember the field locator. The filled value is never cached.',
          },
        },
        required: ['value'],
      },
      validator: targetSchema.extend({ value: z.string() }),
      execute: async (input, ctx) => {
        try {
          const captured = await captureForIntent(input)
          const result = await browser.fill(asTarget(input), input.value as string)
          return { ...result, ...(await commitIntent(ctx, input, 'fill', captured)) }
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_screenshot',
      description: 'Take a screenshot of the current page. Returns base64 PNG.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        try {
          return await browser.screenshot()
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_get_content',
      description: 'Get the text content of the current page (first 5000 chars).',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        try {
          return await browser.getContent()
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_snapshot',
      description:
        'Token-efficient accessibility tree plus a numbered interactive list. Prefer click/fill/hover/select by those indexes over CSS or screenshots. Indexes are invalid after navigation — snapshot again. Returns snapshotId.',
      category: 'browser',
      riskTier: 'yellow',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          maxChars: { type: 'number', description: 'Max snapshot characters (default 12000)' },
        },
      },
      execute: async (input) => {
        try {
          return await browser.snapshot((input.maxChars as number) ?? 12_000)
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_tabs',
      description:
        'List, open, switch, or close tabs in the headless Playwright session. action=list|open|switch|close. Cannot close the last tab (use browser_close).',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'open', 'switch', 'close'] },
          id: { type: 'number', description: 'Tab id for switch/close' },
          url: { type: 'string', description: 'URL for action=open' },
        },
        required: ['action'],
      },
      validator: z.object({
        action: z.enum(['list', 'open', 'switch', 'close']),
        id: z.number().int().positive().optional(),
        url: z.string().min(1).optional(),
      }),
      execute: async (input) => {
        try {
          const action = input.action as string
          if (action === 'list') return await browser.tabs()
          if (action === 'open') return await browser.openTab(input.url as string | undefined)
          if (action === 'switch') {
            if (typeof input.id !== 'number') throw new Error('action=switch requires id')
            return await browser.switchTab(input.id)
          }
          if (typeof input.id !== 'number') throw new Error('action=close requires id')
          return await browser.closeTab(input.id)
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_back',
      description: 'Go back in the active tab history. Invalidates snapshot indexes.',
      category: 'browser',
      riskTier: 'yellow',
      requiresApproval: true,
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        try {
          return await browser.back()
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_wait',
      description:
        'Wait for a selector/index, a URL, a load state, or a timeout. kind=selector|url|load|timeout. Max 30s (10s for timeout kind).',
      category: 'browser',
      riskTier: 'yellow',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['selector', 'timeout', 'url', 'load'] },
          selector: { type: 'string' },
          index: { type: 'number' },
          snapshotId: { type: 'string' },
          url: { type: 'string' },
          timeoutMs: { type: 'number' },
          loadState: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle'] },
        },
        required: ['kind'],
      },
      validator: z.object({
        kind: z.enum(['selector', 'timeout', 'url', 'load']),
        selector: z.string().min(1).optional(),
        index: z.number().int().positive().optional(),
        snapshotId: z.string().min(1).optional(),
        url: z.string().optional(),
        timeoutMs: z.number().nonnegative().optional(),
        loadState: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
      }),
      execute: async (input) => {
        try {
          return await browser.wait({
            kind: input.kind as 'selector' | 'timeout' | 'url' | 'load',
            selector: input.selector as string | undefined,
            index: input.index as number | undefined,
            snapshotId: input.snapshotId as string | undefined,
            url: input.url as string | undefined,
            timeoutMs: input.timeoutMs as number | undefined,
            loadState: input.loadState as 'load' | 'domcontentloaded' | 'networkidle' | undefined,
          })
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_hover',
      description: 'Hover an element. Prefer index from the last browser_snapshot.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          index: { type: 'number' },
          selector: { type: 'string' },
          snapshotId: { type: 'string' },
          intent: { type: 'string', description: 'Optional phrase to remember this locator for browser_replay' },
        },
      },
      validator: targetSchema,
      execute: async (input, ctx) => {
        try {
          const captured = await captureForIntent(input)
          const result = await browser.hover(asTarget(input))
          return { ...result, ...(await commitIntent(ctx, input, 'hover', captured)) }
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_select',
      description: 'Select option(s) on a <select>. Prefer index from the last browser_snapshot. values is a string or array of option values/labels.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          index: { type: 'number' },
          selector: { type: 'string' },
          snapshotId: { type: 'string' },
          values: {
            oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
            description: 'Option value or label, or a list',
          },
          intent: { type: 'string', description: 'Optional phrase to remember this locator for browser_replay' },
        },
        required: ['values'],
      },
      validator: targetSchema.extend({
        values: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
      }),
      execute: async (input, ctx) => {
        try {
          const captured = await captureForIntent(input)
          const result = await browser.select(asTarget(input), input.values as string | string[])
          return { ...result, ...(await commitIntent(ctx, input, 'select', captured)) }
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_dialog',
      description:
        'Arm the next window.alert/confirm/prompt in the headless session. action=accept|dismiss. Call this BEFORE the click that opens the dialog.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['accept', 'dismiss'] },
          promptText: { type: 'string', description: 'Text to type into a prompt() dialog' },
        },
        required: ['action'],
      },
      validator: z.object({
        action: z.enum(['accept', 'dismiss']),
        promptText: z.string().optional(),
      }),
      execute: async (input) => {
        try {
          return browser.armDialog(input.action as 'accept' | 'dismiss', input.promptText as string | undefined)
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_upload',
      description:
        'Set files on a file input. Prefer index from the last snapshot. paths are jailed to the workspace. documentIds pull from Documents.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          index: { type: 'number' },
          selector: { type: 'string' },
          snapshotId: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative file paths' },
          documentIds: { type: 'array', items: { type: 'string' }, description: 'Documents to upload' },
        },
      },
      validator: targetSchema.extend({
        paths: z.array(z.string().min(1)).max(8).optional(),
        documentIds: z.array(z.string().min(1)).max(8).optional(),
      }),
      execute: async (input, ctx) => {
        const temps: string[] = []
        try {
          const files: string[] = []
          const paths = Array.isArray(input.paths) ? (input.paths as string[]) : []
          if (paths.length) files.push(...resolveUploadPaths(paths, ctx))
          const ids = Array.isArray(input.documentIds) ? (input.documentIds as string[]) : []
          if (ids.length) {
            const docs = getDocuments?.()
            if (!docs) throw new Error('Documents module not ready')
            const dir = await mkdtemp(join(tmpdir(), 'eyas-upload-'))
            for (const id of ids) {
              const { filename, file } = await documentBytes(docs, id)
              const dest = join(dir, filename.replace(/[/\\]/g, '_'))
              await writeFile(dest, file)
              temps.push(dest)
              files.push(dest)
            }
          }
          if (!files.length) throw new Error('upload requires paths and/or documentIds')
          return await browser.upload(asTarget(input), files)
        } catch (e) {
          return err(e)
        } finally {
          for (const p of temps) {
            try {
              await unlink(p)
            } catch {
              /* ignore */
            }
          }
        }
      },
    },
    {
      name: 'browser_evaluate',
      description:
        'Run a JavaScript expression in the page (not in Node). Returns a JSON-serialized result, capped at 50k characters. Red, approval required.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'JavaScript expression to evaluate in the page' },
        },
        required: ['expression'],
      },
      validator: z.object({ expression: z.string().min(1).max(20_000) }),
      execute: async (input) => {
        try {
          return await browser.evaluate(input.expression as string)
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_download',
      description:
        'Wait for a browser download and ingest it into Documents (linked to this conversation). Optionally click index/selector first to trigger it.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          index: { type: 'number' },
          selector: { type: 'string' },
          snapshotId: { type: 'string' },
          timeoutMs: { type: 'number' },
        },
      },
      validator: targetSchema.extend({ timeoutMs: z.number().nonnegative().optional() }).partial(),
      execute: async (input, ctx?: ToolContext) => {
        try {
          const hasTarget =
            (typeof input.selector === 'string' && input.selector.length > 0) ||
            typeof input.index === 'number'
          return await browser.download(hasTarget ? asTarget(input) : undefined, {
            timeoutMs: input.timeoutMs as number | undefined,
            conversationId: ctx?.conversationId,
            userId: ctx?.userId,
          })
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_storage',
      description:
        'Save or load Playwright storageState (cookies + origins) for the EYAS-owned browser profile. Never the daily Chrome profile. action=save|load.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['save', 'load'] },
          path: { type: 'string', description: 'Optional override path under the instance data dir' },
        },
        required: ['action'],
      },
      validator: z.object({
        action: z.enum(['save', 'load']),
        path: z.string().min(1).optional(),
      }),
      execute: async (input) => {
        try {
          if (input.action === 'save') return await browser.saveStorageState(input.path as string | undefined)
          return await browser.loadStorageState(input.path as string | undefined)
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_replay',
      description:
        'Replay a cached locator from a previous successful click/fill (Stagehand-style, no LLM). Looks up intent on the current origin. Fill still needs value (e.g. from browser_totp). Red — it clicks.',
      category: 'browser',
      riskTier: 'red',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          intent: { type: 'string', description: 'Same phrase used when the locator was remembered' },
          value: { type: 'string', description: 'Required when the cached action is fill' },
          values: {
            oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
            description: 'Required when the cached action is select',
          },
        },
        required: ['intent'],
      },
      validator: z.object({
        intent: z.string().min(1).max(200),
        value: z.string().optional(),
        values: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
      }),
      execute: async (input, ctx) => {
        try {
          const { origin } = await browser.currentUrl()
          const store = cacheStore(ctx)
          const entry = await store.lookup(origin, input.intent as string)
          if (!entry) {
            return {
              error: `No cached locator for intent "${input.intent}" on ${origin}. Snapshot and act with intent once, then replay.`,
            }
          }
          try {
            const result = await browser.actByLocator(entry.action, entry.locator, {
              value: input.value as string | undefined,
              values: input.values as string | string[] | undefined,
            })
            await store.hit(entry.id)
            return { ...result, replayed: true, cache: publicCacheEntry({ ...entry, hits: entry.hits + 1 }) }
          } catch (e) {
            await store.miss(entry.id)
            return {
              error: `${e instanceof Error ? e.message : String(e)}. Cached locator missed — call browser_snapshot and act with intent again.`,
              replayed: false,
              cache: publicCacheEntry({ ...entry, misses: entry.misses + 1 }),
            }
          }
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_action_cache',
      description:
        'List, remember, or forget durable locators (JSON in the project or vault). Remember extracts a locator without clicking. Never stores secrets or fill values.',
      category: 'browser',
      riskTier: 'yellow',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'remember', 'forget'] },
          intent: { type: 'string' },
          index: { type: 'number' },
          selector: { type: 'string' },
          snapshotId: { type: 'string' },
          act: { type: 'string', enum: [...cacheableActions], description: 'Cached verb for remember (default click)' },
          origin: { type: 'string', description: 'Optional origin filter for list/forget' },
        },
        required: ['action'],
      },
      validator: z.object({
        action: z.enum(['list', 'remember', 'forget']),
        intent: z.string().min(1).max(200).optional(),
        index: z.number().int().positive().optional(),
        selector: z.string().min(1).optional(),
        snapshotId: z.string().min(1).optional(),
        act: z.enum(cacheableActions).optional(),
        origin: z.string().min(1).optional(),
      }),
      execute: async (input, ctx) => {
        try {
          const store = cacheStore(ctx)
          if (input.action === 'list') {
            const origin = typeof input.origin === 'string' ? originFromUrl(input.origin) : undefined
            const entries = await store.list(origin)
            return { path: store.path, entries: entries.map(publicCacheEntry) }
          }
          if (input.action === 'forget') {
            if (typeof input.intent !== 'string') throw new Error('forget requires intent')
            const origin = typeof input.origin === 'string' ? originFromUrl(input.origin) : undefined
            const result = await store.forget({ intent: input.intent, origin })
            return { path: store.path, ...result }
          }
          if (typeof input.intent !== 'string') throw new Error('remember requires intent')
          const { origin } = await browser.currentUrl()
          const locator = await browser.durableLocator(asTarget(input))
          const entry = await store.remember({
            origin,
            intent: input.intent,
            action: (input.act as CacheableAction | undefined) ?? 'click',
            locator,
          })
          return { remembered: true, path: store.path, cache: publicCacheEntry(entry) }
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_totp',
      description:
        'Generate a TOTP code from a seed in Secrets (or macOS Keychain). Pass the code to browser_fill. Never returns the seed. Yellow.',
      category: 'browser',
      riskTier: 'yellow',
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Secret name in Secrets, or Keychain service (also tries eyas-totp-<name>)' },
          scope: { type: 'string', description: 'Secrets scope (default system)' },
          account: { type: 'string', description: 'Optional Keychain account (-a)' },
        },
        required: ['name'],
      },
      validator: z.object({
        name: z.string().min(1).max(200),
        scope: z.string().min(1).max(80).optional(),
        account: z.string().min(1).max(200).optional(),
      }),
      execute: async (input) => {
        try {
          const secret = await resolveTotpSecret(
            input.name as string,
            (input.scope as string | undefined) ?? 'system',
            input.account as string | undefined,
          )
          const totp = generateTotp(secret)
          return {
            code: totp.code,
            digits: totp.digits,
            periodSeconds: totp.periodSeconds,
            remainingSeconds: totp.remainingSeconds,
            hint: 'Pass code to browser_fill. Do not store it in the action cache.',
          }
        } catch (e) {
          return err(e)
        }
      },
    },
    {
      name: 'browser_close',
      description: 'Close the browser session. The EYAS-owned profile (cookies) is kept on disk.',
      category: 'browser',
      riskTier: 'yellow',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        await browser.close()
        return { closed: true }
      },
    },
  ]
}
