// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { sql } from 'drizzle-orm'
import { createSoulProposalApplier } from '../../../src/modules/forge/soul-proposal-applier.js'
import type { AgentWorkspace, WorkspaceFile } from '../../../src/modules/prompt-wizard/workspace-types.js'

function setupDb() {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  db.run(sql`CREATE TABLE forge_proposals (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    target_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    field TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    current_value TEXT NOT NULL,
    proposed_value TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    based_on_feedbacks INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    experiment_id TEXT,
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  )`)
  return db
}

// A valid SOUL.style.json where external does NOT match any preset by default
const validStyle = {
  version: 1 as const,
  preset: { internal: 'jarvis' as const, external: 'custom' as const },
  internal: {
    address: 'magázó' as const,
    tone: 'komoly' as const,
    verbosity: 'lényegre törő' as const,
    directness: 'direkt + udvarias' as const,
    humor: 'nincs' as const,
    emoji: 'soha' as const,
    blockedPhrases: [],
    signature: 'J.',
  },
  external: {
    address: 'magázó' as const,
    tone: 'kiegyensúlyozott' as const,
    verbosity: 'lényegre törő' as const,
    directness: 'direkt + udvarias' as const,
    humor: 'nincs' as const,
    emoji: 'soha' as const,
    blockedPhrases: [],
    signature: '',
  },
}

function file(name: string, body: string, exists = true): WorkspaceFile {
  return {
    name,
    path: `/fake/${name}`,
    exists,
    frontmatter: null,
    body,
    byteSize: body.length,
    truncated: false,
  }
}

function workspace(soulStyleBody: string | null): AgentWorkspace {
  return {
    agentId: 'jarvis',
    rootPath: '/fake',
    identity: file('IDENTITY.md', '# I'),
    soulMd: file('SOUL.md', '# S'),
    soulStyleJson:
      soulStyleBody === null
        ? file('SOUL.style.json', '', false)
        : file('SOUL.style.json', soulStyleBody, true),
    agentsMd: file('AGENTS.md', ''),
    toolsMd: file('TOOLS.md', ''),
    memoryMd: file('MEMORY.md', ''),
    dailyMemory: [],
  }
}

function seedProposal(
  db: ReturnType<typeof setupDb>,
  opts: {
    id: string
    target?: string
    targetId?: string
    scope?: string
    field?: string
    proposedValue?: unknown
    status?: string
  },
) {
  db.run(sql`INSERT INTO forge_proposals (
    id, target, target_id, scope, field,
    title, description, current_value, proposed_value,
    reasoning, confidence, based_on_feedbacks, status, created_at
  ) VALUES (
    ${opts.id},
    ${opts.target ?? 'soul'},
    ${opts.targetId ?? 'jarvis'},
    ${opts.scope ?? 'external'},
    ${opts.field ?? 'tone'},
    'title',
    'desc',
    '"old"',
    ${JSON.stringify(opts.proposedValue ?? 'baráti')},
    'reason',
    0.5,
    5,
    ${opts.status ?? 'pending'},
    '2026-04-26T00:00:00Z'
  )`)
}

describe('SoulProposalApplier', () => {
  let db: ReturnType<typeof setupDb>
  const fixedNow = new Date('2026-04-26T12:00:00Z')

  beforeEach(() => {
    db = setupDb()
  })

  it('apply happy path — saves style, invalidates loader, sets status=applied', async () => {
    seedProposal(db, { id: 'p-1', scope: 'external', field: 'tone', proposedValue: 'baráti' })

    const saveStyle = vi.fn().mockResolvedValue(undefined)
    const invalidate = vi.fn()
    const ws = workspace(JSON.stringify(validStyle))

    const applier = createSoulProposalApplier({
      db: db as never,
      workspaceLoader: {
        load: vi.fn().mockResolvedValue(ws),
        invalidate,
        invalidateAll: vi.fn(),
      },
      soulPipeline: { saveStyle, rerender: vi.fn() },
      agentName: vi.fn().mockResolvedValue('Jarvis'),
      now: () => fixedNow,
    })

    const result = await applier.apply('p-1')

    expect(result).toEqual({ ok: true })
    expect(saveStyle).toHaveBeenCalledOnce()
    expect(invalidate).toHaveBeenCalledWith('jarvis')

    interface Row { status: string; reviewed_at: string }
    const row = db.all<Row>(sql`SELECT status, reviewed_at FROM forge_proposals WHERE id = 'p-1'`)[0]
    expect(row.status).toBe('applied')
    expect(row.reviewed_at).toBe('2026-04-26T12:00:00.000Z')
  })

  it('apply non-soul fails — returns not a soul proposal', async () => {
    seedProposal(db, { id: 'p-2', target: 'skill' })

    const applier = createSoulProposalApplier({
      db: db as never,
      workspaceLoader: { load: vi.fn(), invalidate: vi.fn(), invalidateAll: vi.fn() },
      soulPipeline: { saveStyle: vi.fn(), rerender: vi.fn() },
      agentName: vi.fn(),
    })

    const result = await applier.apply('p-2')
    expect(result).toEqual({ ok: false, reason: 'not a soul proposal' })
  })

  it('apply already-applied fails — reason mentions status', async () => {
    seedProposal(db, { id: 'p-3', status: 'applied' })

    const applier = createSoulProposalApplier({
      db: db as never,
      workspaceLoader: { load: vi.fn(), invalidate: vi.fn(), invalidateAll: vi.fn() },
      soulPipeline: { saveStyle: vi.fn(), rerender: vi.fn() },
      agentName: vi.fn(),
    })

    const result = await applier.apply('p-3')
    expect(result).toMatchObject({ ok: false })
    if (!result.ok) {
      expect(result.reason).toMatch(/status is/)
    }
  })

  it('apply re-detects preset — when result matches jarvis preset, saved style has preset.external=jarvis', async () => {
    // The jarvis preset for external:
    // address='magázó', tone='komoly', verbosity='lényegre törő', directness='direkt + udvarias', humor='nincs', emoji='soha'
    // validStyle.external already has address/verbosity/directness/humor/emoji matching jarvis,
    // but tone='kiegyensúlyozott'. Proposing tone='komoly' makes it match jarvis fully.
    seedProposal(db, { id: 'p-4', scope: 'external', field: 'tone', proposedValue: 'komoly' })

    let capturedStyle: unknown
    const saveStyle = vi.fn().mockImplementation(async (_id, _name, style) => {
      capturedStyle = style
    })

    const applier = createSoulProposalApplier({
      db: db as never,
      workspaceLoader: {
        load: vi.fn().mockResolvedValue(workspace(JSON.stringify(validStyle))),
        invalidate: vi.fn(),
        invalidateAll: vi.fn(),
      },
      soulPipeline: { saveStyle, rerender: vi.fn() },
      agentName: vi.fn().mockResolvedValue('Jarvis'),
    })

    const result = await applier.apply('p-4')
    expect(result).toEqual({ ok: true })
    expect((capturedStyle as { preset: { external: string } }).preset.external).toBe('jarvis')
  })

  it('reject sets status=rejected and reviewed_at', async () => {
    seedProposal(db, { id: 'p-5' })

    const applier = createSoulProposalApplier({
      db: db as never,
      workspaceLoader: { load: vi.fn(), invalidate: vi.fn(), invalidateAll: vi.fn() },
      soulPipeline: { saveStyle: vi.fn(), rerender: vi.fn() },
      agentName: vi.fn(),
      now: () => fixedNow,
    })

    await applier.reject('p-5')

    interface Row { status: string; reviewed_at: string }
    const row = db.all<Row>(sql`SELECT status, reviewed_at FROM forge_proposals WHERE id = 'p-5'`)[0]
    expect(row.status).toBe('rejected')
    expect(row.reviewed_at).toBe('2026-04-26T12:00:00.000Z')
  })
})
