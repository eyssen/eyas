// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { createCandidateBatchSchema, createCandidateSchema, MAX_CANDIDATES } from '@modules/memory/capture/candidate-schema'
import { CAPTURE_SYSTEM_PROMPT, buildCaptureUser } from '@modules/memory/capture/capture-prompt'
import { createMemoryCapture, type CaptureInput } from '@modules/memory/capture/index'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWikilinkService } from '@shared/wikilinks'
import { createNoteWriter } from '@modules/memory/capture/note-writer'
import type { CaptureConfig } from '@modules/memory/capture/capture-gate'

const ok = { kind: 'user', title: 'Language', summary: 'Answers in Hungarian', body: 'The owner works in Hungarian.' }

describe('candidate schema', () => {
  const schema = createCandidateBatchSchema({ allowProject: true })

  it('accepts a well-formed batch', () => {
    expect(schema.safeParse({ notes: [ok] }).success).toBe(true)
  })

  it('accepts an empty batch — "nothing worth keeping" is the common answer', () => {
    expect(schema.safeParse({ notes: [] }).success).toBe(true)
  })

  it('requires why and howToApply on feedback, and only on feedback', () => {
    // A rule without its reason is an anecdote; the reason is what lets a
    // later reader decide whether it still applies.
    const bare = { kind: 'feedback', title: 'Commits', summary: 'Never commit unless asked', body: 'xxx' }
    expect(schema.safeParse({ notes: [bare] }).success).toBe(false)
    expect(schema.safeParse({ notes: [{ ...bare, why: 'The owner decides what enters history', howToApply: 'Ask before every commit' }] }).success).toBe(true)
    expect(schema.safeParse({ notes: [ok] }).success).toBe(true)  // user needs neither
  })

  it('caps the batch', () => {
    const many = Array.from({ length: MAX_CANDIDATES + 1 }, (_, n) => ({ ...ok, title: `T${n}` }))
    expect(schema.safeParse({ notes: many }).success).toBe(false)
  })

  it('bounds every string, because the model chooses them', () => {
    expect(schema.safeParse({ notes: [{ ...ok, summary: 'x'.repeat(500) }] }).success).toBe(false)
    expect(schema.safeParse({ notes: [{ ...ok, body: 'x'.repeat(20_000) }] }).success).toBe(false)
  })
})

describe('project kind gating', () => {
  const project = { kind: 'project', title: 'Deploy rule', summary: 'Deploys need a green pipeline', body: 'xxx' }

  it('accepts project when the conversation has one', () => {
    expect(createCandidateBatchSchema({ allowProject: true }).safeParse({ notes: [project] }).success).toBe(true)
  })

  // F1.7 — a project note with no effective project used to sink the whole
  // note (dropped as unparsable/rejected-shape). The net under the prompt
  // rule downgrades it to `reference` instead, so the fact still reaches the
  // vault — just not scoped to a project that does not exist.
  it('downgrades project to reference when there is no effective project — the fact still reaches the vault', () => {
    const parsed = createCandidateBatchSchema({ allowProject: false }).safeParse({ notes: [project] })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.notes[0].kind).toBe('reference')
  })

  it('project notes need no why/howToApply — that discipline is feedback-only', () => {
    expect(createCandidateBatchSchema({ allowProject: true }).safeParse({ notes: [project] }).success).toBe(true)
  })
})

// F1.6 — one bad note in a batch must not sink its siblings. Live evidence:
// capture repro on conversation 01M141VEY1SJBWEQJP0QMH0T2K chose kind:
// "project" 5/15 times in a no-project conversation, and the batch refine
// dropped the whole reply as `unparsable` — losing the good note alongside it.

describe('single-note schema (per-note salvage)', () => {
  it('downgrades a project-kind note to reference under allowProject:false, and leaves it as project when allowed', () => {
    const asProject = { kind: 'project', title: 'Deploy rule', summary: 'Deploys need a green pipeline', body: 'xxx' }

    const closed = createCandidateSchema({ allowProject: false }).safeParse(asProject)
    expect(closed.success).toBe(true)
    expect(closed.success && closed.data.kind).toBe('reference')

    const open = createCandidateSchema({ allowProject: true }).safeParse(asProject)
    expect(open.success).toBe(true)
    expect(open.success && open.data.kind).toBe('project')
  })
})

describe('parseBatch salvage via the capture flow', () => {
  const LONG = 'Please always answer me in Hungarian, that is how I work.'
  let db: any, root: string, vault: any, indexer: any, writer: any
  let fakeComplete: any
  let logger: { warn: any; debug: any }
  let captureConfig: CaptureConfig
  let capture: (input: CaptureInput) => Promise<void>

  const runsFor = (conversationId: string) =>
    db.all(sql`SELECT notes_written, kinds, skipped_reason FROM memory_capture_runs
      WHERE conversation_id = ${conversationId} ORDER BY id ASC`) as any[]

  beforeEach(() => {
    db = createMemoryDb()
    createMemoryTables(db)

    root = mkdtempSync(join(tmpdir(), 'eyas-capture-salvage-'))
    vault = createVaultService(root)
    const wikilinks = createWikilinkService(db); wikilinks.init()
    indexer = createVaultIndexer(db, vault, wikilinks)
    writer = createNoteWriter({ db, vault, indexer })

    fakeComplete = vi.fn()
    logger = { warn: vi.fn(), debug: vi.fn() }
    captureConfig = { enabled: true, minUserChars: 40, maxPerConversation: 20, maxInputChars: 4_000 }
    capture = createMemoryCapture({ db, config: () => captureConfig, complete: fakeComplete, writer, logger })
  })

  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('writes both siblings — the project note downgrades to reference instead of sinking', async () => {
    fakeComplete.mockResolvedValueOnce(JSON.stringify({
      notes: [
        { kind: 'feedback', title: 'Commits', summary: 'Never commit unless asked', body: 'xxx', why: 'The owner decides what enters history', howToApply: 'Ask before every commit' },
        { kind: 'project', title: 'Deploy rule', summary: 'Deploys need a green pipeline', body: 'xxx' },
      ],
    }))
    await capture({ conversationId: 'salvage-1', projectId: null, userMessage: LONG, assistantMessage: 'reply' })
    const runs = runsFor('salvage-1')
    expect(runs[0].notes_written).toBe(2)
    expect(JSON.parse(runs[0].kinds)).toEqual(['feedback', 'reference'])
    expect(runs[0].skipped_reason).toBeNull()
  })

  // F1.7 — a project note under no-project no longer sinks: the schema
  // downgrades its kind to `reference` instead of rejecting it, so the fact
  // still reaches the vault. This REPLACES the F1.6 expectation that such a
  // batch recorded rejected-shape.
  it('writes a project-kind note as reference when the conversation has no project', async () => {
    fakeComplete.mockResolvedValueOnce(JSON.stringify({
      notes: [{ kind: 'project', title: 'Deploy rule', summary: 'Deploys need a green pipeline', body: 'xxx' }],
    }))
    await capture({ conversationId: 'salvage-2', projectId: null, userMessage: LONG, assistantMessage: 'reply' })
    const runs = runsFor('salvage-2')
    expect(runs[0].notes_written).toBe(1)
    expect(JSON.parse(runs[0].kinds)).toEqual(['reference'])
    expect(runs[0].skipped_reason).toBeNull()
  })

  it('records notes_written 0, skipped_reason rejected-shape when the only note is genuinely schema-invalid', async () => {
    // A feedback note without why/howToApply cannot be salvaged by any
    // downgrade — it is invalid regardless of project scope.
    fakeComplete.mockResolvedValueOnce(JSON.stringify({
      notes: [{ kind: 'feedback', title: 'Commits', summary: 'Never commit unless asked', body: 'xxx' }],
    }))
    await capture({ conversationId: 'salvage-4', projectId: null, userMessage: LONG, assistantMessage: 'reply' })
    const runs = runsFor('salvage-4')
    expect(runs[0].notes_written).toBe(0)
    expect(runs[0].skipped_reason).toBe('rejected-shape')
  })

  it('still records the healthy NULL-reason empty row for a clean {"notes":[]}', async () => {
    fakeComplete.mockResolvedValueOnce(JSON.stringify({ notes: [] }))
    await capture({ conversationId: 'salvage-3', projectId: null, userMessage: LONG, assistantMessage: 'reply' })
    const runs = runsFor('salvage-3')
    expect(runs[0].notes_written).toBe(0)
    expect(runs[0].skipped_reason).toBeNull()
  })
})

describe('the prompt rule guarding "project" kind', () => {
  it('tells the model project requires a PROJECT section, and names the alternative kinds', () => {
    expect(CAPTURE_SYSTEM_PROMPT).toContain('Use "project" ONLY when a PROJECT section is present')
  })
})

describe('domain kind gating', () => {
  const domain = { kind: 'domain', title: 'Shared tax groups', summary: 'Tax groups are shared across the type', body: 'xxx' }

  it('accepts domain when the conversation has a type', () => {
    expect(createCandidateBatchSchema({ allowProject: true, allowDomain: true }).safeParse({ notes: [domain] }).success).toBe(true)
  })

  it('downgrades domain to reference when there is no type — the fact still reaches the vault', () => {
    const parsed = createCandidateBatchSchema({ allowProject: true, allowDomain: false }).safeParse({ notes: [domain] })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.notes[0].kind).toBe('reference')
  })
})

describe('the prompt rule guarding "domain" kind', () => {
  it('tells the model domain requires a TYPE section, and how it differs from project', () => {
    expect(CAPTURE_SYSTEM_PROMPT).toContain('Use "domain" ONLY when a TYPE section is present')
    expect(CAPTURE_SYSTEM_PROMPT).toMatch(/TYPE section/i)
  })

  it('puts TYPE beside PROJECT in the extractor user prompt', () => {
    const user = buildCaptureUser('u', 'a', 1000, {
      project: { name: 'Alpha', description: 'Main' },
      type: { name: 'Type A' },
    })
    expect(user).toContain('TYPE:')
    expect(user).toContain('Type A')
    expect(user).toContain('PROJECT:')
    expect(user).toContain('Alpha')
  })
})
