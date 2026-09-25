// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// K10 (R2B-ENG-06) — the memory an OpenCode task sends is sized for the window
// of the model OpenCode runs, by the same budgetForWindow every other prompt
// path uses (the assembler's delivery profile): memory.index.budgetChars at the
// 100k baseline, more on a larger window, less on a smaller one. The window
// comes from OpenCode's own model list; when it is unknown (no model chosen, a
// model the list does not name or gives no limit for, no list) the baseline
// applies, as for an unresolved delivery profile.

import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import {
  createDeveloperAgent,
  opencodeModelWindow,
  recallBudgetForWindow,
  type OpencodeSecurityGate,
} from '@modules/opencode/developer-agent'
import type { OpencodeClient } from '@modules/opencode/opencode-client'
import type { OpencodeModelCatalog, OpencodeModelRef } from '@modules/opencode/types'
import type { MemoryRecall, MemoryRecallInput, RecallResult } from '@modules/memory/v2/assemble'
import { createPromptAssembler } from '@modules/prompt-wizard/assembler'
import { unresolvedDeliveryProfile } from '@modules/prompt-wizard/delivery-profile'
import { BASELINE_WINDOW, DEFAULT_MEMORY_RECALL_CHARS, SCALE_MAX, budgetForWindow, tokensToChars } from '@modules/prompt-wizard/token-budget'

const logger = pino({ level: 'silent' })
const BASELINE_CHARS = 3_000
const BLOCK = '<eyas-memory>\n- (gs:g1) Harbor ledger closes on Fridays\n</eyas-memory>'

/** A model per window, all under one provider. */
function catalogOf(models: Array<{ id: string; contextWindow?: number; variants?: string[] }>): OpencodeModelCatalog {
  return {
    providers: [{
      id: 'vendor',
      name: 'Vendor',
      models: models.map((m) => ({
        id: m.id,
        name: m.id,
        variants: (m.variants ?? []).map((id) => ({ id, level: null })),
        ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
      })),
    }],
    defaults: {},
  }
}

function fakeServer(catalog: OpencodeModelCatalog | Error) {
  const prompts: Array<Parameters<OpencodeClient['prompt']>[1]> = []
  const catalogReads: Array<string | null> = []
  const make = (directory: string | null): OpencodeClient => ({
    baseUrl: 'http://127.0.0.1:1',
    directory,
    forDirectory: (dir) => make(dir),
    health: async () => ({ healthy: true, version: '1.18.29' }),
    createSession: async () => ({ id: 'ses_own' }),
    prompt: async (_sid, body) => {
      prompts.push(body)
      return { text: 'done' }
    },
    listProviders: async () => {
      catalogReads.push(directory)
      if (catalog instanceof Error) throw catalog
      return catalog
    },
    abort: async () => undefined,
    diff: async () => [],
    replyPermission: async () => undefined,
    deleteSession: async () => undefined,
    subscribeEvents: (signal, onEvent) => {
      onEvent({ type: 'server.connected', properties: {} })
      return new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()))
    },
  })
  return { client: make(null), prompts, catalogReads }
}

const allowAll: OpencodeSecurityGate = { validateToolCall: async () => ({ decision: 'allow', reason: 'test', riskTier: 'green' }) }

function recording(): { recall: MemoryRecall; calls: MemoryRecallInput[] } {
  const calls: MemoryRecallInput[] = []
  const recall: MemoryRecall = async (input) => {
    calls.push(input)
    return { content: BLOCK, ids: ['gs:g1'], standing: [], retrieved: ['gs:g1'], expanded: [], dropped: 0, chars: BLOCK.length, tokens: 10, budgetChars: input.budgetChars }
  }
  return { recall, calls }
}

/** What the prompt assembler hands the recall service for a resolved model with this window (every other path). */
async function assemblerRecallChars(contextWindow: number, baselineChars: number): Promise<number | null> {
  const seen: number[] = []
  const assembler = createPromptAssembler({
    workspaceLoader: { load: async () => { throw new Error('not needed for a turn') }, invalidate: () => {}, invalidateAll: () => {} },
    projectContextLoader: { cascade: async () => ({ projectAgents: null, projectTypeAgents: null, projectId: null, projectTypeId: null }) },
    resolveSkillsFor: async () => [],
    resolveToolsFor: async () => [],
    resolveTeamContext: async () => null,
    resolveMemoryContext: async () => null,
    resolveActiveVoice: async () => { throw new Error('not needed for a turn') },
    resolveRuntime: () => ({ channel: 'owner_dm', os: 'linux' }),
    resolveClock: () => ({ date: '2031-02-03', time: '04:05' }),
    resolveMasterSections: async () => ({ identity: 'identity', coreRules: 'rules', personality: 'personality' }),
    resolveDeliveryProfile: (target) => ({ ...unresolvedDeliveryProfile(target), contextWindow, resolved: true, windowSource: 'catalog' }),
    resolveMemoryRecallChars: () => baselineChars,
    resolveRecall: async (input) => {
      seen.push(input.budgetChars)
      return null as unknown as RecallResult
    },
  })
  const turn = await assembler.buildTurnOnly({ conversationId: 'conv-oc', turnText: 'close the harbor ledger', target: { providerId: 'vendor', modelId: 'm' } })
  return seen[0] ?? (turn.delivery.recall?.withheld === 'no-budget' ? 0 : null)
}

describe('OpenCode task — recalled memory sized for the model\'s window (K10)', () => {
  let root: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-oc-window-')))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function agentFor(server: ReturnType<typeof fakeServer>, recall: MemoryRecall | undefined, opts: { baseline?: number; log?: import('pino').Logger } = {}) {
    return createDeveloperAgent({
      getClient: async () => server.client,
      getSecurityGate: () => allowAll,
      getRecall: () => recall,
      recallBudgetChars: () => opts.baseline,
      resolveCwd: () => root,
      logger: opts.log ?? logger,
      eventStreamWaitMs: 50,
    })
  }

  const task = (model: OpencodeModelRef | null, variant: string | null = null) => ({
    prompt: 'close the harbor ledger', conversationId: 'conv-oc', userId: 'u1', model, variant,
  })

  it('(+) the recall cap equals what the prompt assembler gives any other model with the same window', async () => {
    const windows = [16_000, 32_000, 64_000, 100_000, 128_000, 200_000, 400_000, 1_000_000]
    const server = fakeServer(catalogOf(windows.map((w) => ({ id: `m-${w}`, contextWindow: w }))))
    for (const w of windows) {
      const { recall, calls } = recording()
      const result = await agentFor(server, recall, { baseline: BASELINE_CHARS }).run(task({ providerID: 'vendor', modelID: `m-${w}` }))
      expect(result.ok).toBe(true)
      const expected = await assemblerRecallChars(w, BASELINE_CHARS)
      expect(expected, `the assembler recalls at ${w}`).toBeGreaterThan(0)
      expect(calls[0]?.budgetChars, `window ${w}`).toBe(expected)
    }
  })

  it('(+) a large window gets more memory: up to SCALE_MAX × memory.index.budgetChars from 250k up', async () => {
    const server = fakeServer(catalogOf([{ id: 'wide', contextWindow: 1_000_000 }, { id: 'mid', contextWindow: 200_000 }]))
    const wide = recording()
    const mid = recording()
    await agentFor(server, wide.recall, { baseline: BASELINE_CHARS }).run(task({ providerID: 'vendor', modelID: 'wide' }))
    await agentFor(server, mid.recall, { baseline: BASELINE_CHARS }).run(task({ providerID: 'vendor', modelID: 'mid' }))
    expect(wide.calls[0]!.budgetChars).toBe(BASELINE_CHARS * SCALE_MAX)
    expect(mid.calls[0]!.budgetChars).toBeGreaterThan(BASELINE_CHARS)
    expect(mid.calls[0]!.budgetChars).toBeLessThan(wide.calls[0]!.budgetChars)
    // The block still rides as the prompt's system text.
    expect(server.prompts.every((p) => p.system === BLOCK)).toBe(true)
  })

  it('(−) a small window gets less than memory.index.budgetChars', async () => {
    const server = fakeServer(catalogOf([{ id: 'small', contextWindow: 16_000 }]))
    const { recall, calls } = recording()
    await agentFor(server, recall, { baseline: BASELINE_CHARS }).run(task({ providerID: 'vendor', modelID: 'small' }))
    expect(calls[0]!.budgetChars).toBeGreaterThan(0)
    expect(calls[0]!.budgetChars).toBeLessThan(BASELINE_CHARS)
  })

  it('(−) a window with no room for memory sends none, as the assembler withholds it', async () => {
    const server = fakeServer(catalogOf([{ id: 'tiny', contextWindow: 4_000 }]))
    const { recall, calls } = recording()
    const result = await agentFor(server, recall, { baseline: BASELINE_CHARS }).run(task({ providerID: 'vendor', modelID: 'tiny' }))
    expect(await assemblerRecallChars(4_000, BASELINE_CHARS)).toBe(0)
    expect(result.ok).toBe(true)
    expect(calls).toEqual([])
    expect(server.prompts[0]!.system).toBeUndefined()
  })

  it('(−) no model chosen: OpenCode\'s own default is unknown, so the baseline applies and no model list is read', async () => {
    const server = fakeServer(catalogOf([{ id: 'wide', contextWindow: 1_000_000 }]))
    const { recall, calls } = recording()
    await agentFor(server, recall, { baseline: BASELINE_CHARS }).run(task(null))
    expect(calls[0]!.budgetChars).toBe(BASELINE_CHARS)
    expect(server.catalogReads).toEqual([])
  })

  it('(−) a model the list does not name, or names without a limit, gets the baseline', async () => {
    const server = fakeServer(catalogOf([{ id: 'nolimit' }]))
    for (const modelID of ['nolimit', 'unlisted']) {
      const { recall, calls } = recording()
      await agentFor(server, recall, { baseline: BASELINE_CHARS }).run(task({ providerID: 'vendor', modelID }))
      expect(calls[0]!.budgetChars, modelID).toBe(BASELINE_CHARS)
    }
  })

  it('(−) an unreadable model list: the baseline, a warning, and the task still runs', async () => {
    const server = fakeServer(new Error('OpenCode /config/providers failed (500)'))
    const warn = vi.fn()
    const log = { warn, info: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: () => log } as unknown as import('pino').Logger
    const { recall, calls } = recording()
    const result = await agentFor(server, recall, { baseline: BASELINE_CHARS, log }).run(task({ providerID: 'vendor', modelID: 'wide' }))
    expect(result.ok).toBe(true)
    expect(calls[0]!.budgetChars).toBe(BASELINE_CHARS)
    expect(server.prompts[0]!.system).toBe(BLOCK)
    expect(warn).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/model list unavailable — recalled memory sized for the baseline window/))
  })

  it('(+) one read of the model list serves both the variant check and the window', async () => {
    const server = fakeServer(catalogOf([{ id: 'wide', contextWindow: 1_000_000, variants: ['high'] }]))
    const { recall, calls } = recording()
    const result = await agentFor(server, recall, { baseline: BASELINE_CHARS }).run(task({ providerID: 'vendor', modelID: 'wide' }, 'high'))
    expect(server.catalogReads).toEqual([root])
    expect(server.prompts[0]).toMatchObject({ model: { providerID: 'vendor', modelID: 'wide' }, variant: 'high' })
    expect(result.effective).toEqual({ model: { providerID: 'vendor', modelID: 'wide' }, variant: 'high' })
    expect(calls[0]!.budgetChars).toBe(BASELINE_CHARS * SCALE_MAX)
  })

  it('(−) without a recall service a model with no variant still reads no model list', async () => {
    const server = fakeServer(catalogOf([{ id: 'wide', contextWindow: 1_000_000 }]))
    await agentFor(server, undefined, { baseline: BASELINE_CHARS }).run(task({ providerID: 'vendor', modelID: 'wide' }))
    expect(server.catalogReads).toEqual([])
    expect(server.prompts[0]!.system).toBeUndefined()
  })

  it('(−) no configured size: the shipped default is the baseline that scales', async () => {
    const server = fakeServer(catalogOf([{ id: 'wide', contextWindow: 1_000_000 }]))
    const unset = recording()
    const noModel = recording()
    await agentFor(server, unset.recall).run(task({ providerID: 'vendor', modelID: 'wide' }))
    await agentFor(server, noModel.recall).run(task(null))
    expect(unset.calls[0]!.budgetChars).toBe(DEFAULT_MEMORY_RECALL_CHARS * SCALE_MAX)
    expect(noModel.calls[0]!.budgetChars).toBe(DEFAULT_MEMORY_RECALL_CHARS)
  })
})

describe('recallBudgetForWindow / opencodeModelWindow (K10)', () => {
  it('(+) is budgetForWindow\'s memoryRecall section in characters', () => {
    for (const w of [8_000, 50_000, BASELINE_WINDOW, 175_000, 250_000, 2_000_000]) {
      expect(recallBudgetForWindow(w, BASELINE_CHARS), `window ${w}`).toBe(tokensToChars(budgetForWindow(w, { memoryRecallChars: BASELINE_CHARS }).memoryRecall))
    }
  })

  it('(−) an unknown window is the baseline window', () => {
    expect(recallBudgetForWindow(null, BASELINE_CHARS)).toBe(BASELINE_CHARS)
    expect(recallBudgetForWindow(null, undefined)).toBe(DEFAULT_MEMORY_RECALL_CHARS)
  })

  it('(+) reads the chosen model\'s window from the list; (−) null without a model, a list, or a limit', () => {
    const catalog = catalogOf([{ id: 'wide', contextWindow: 1_000_000 }, { id: 'nolimit' }])
    expect(opencodeModelWindow(catalog, { providerID: 'vendor', modelID: 'wide' })).toBe(1_000_000)
    expect(opencodeModelWindow(catalog, { providerID: 'vendor', modelID: 'nolimit' })).toBeNull()
    expect(opencodeModelWindow(catalog, { providerID: 'other', modelID: 'wide' })).toBeNull()
    expect(opencodeModelWindow(catalog, null)).toBeNull()
    expect(opencodeModelWindow(null, { providerID: 'vendor', modelID: 'wide' })).toBeNull()
  })
})
