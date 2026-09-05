// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The capture path, end to end: the gate's verdicts, the prompt the extractor
// actually sees, the run row every outcome leaves behind — and BOTH call sites,
// because an extractor nothing calls is the same feature as no extractor at all.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { createMemoryDb, createTestDb, insertTestOwner } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWikilinkService } from '@shared/wikilinks'
import { createNoteWriter } from '@modules/memory/capture/note-writer'
import { createMemoryCapture, type CaptureInput } from '@modules/memory/capture/index'
import { CAPTURE_SYSTEM_PROMPT } from '@modules/memory/capture/capture-prompt'
import { MAX_CANDIDATES, createCandidateBatchSchema } from '@modules/memory/capture/candidate-schema'
import type { CaptureConfig } from '@modules/memory/capture/capture-gate'
import { runConversation } from '@modules/agent/conversation-runner'
import { createRunSupervisor, ensureRunSupervisionSchema } from '@modules/agent/run-supervisor'
import { ensureAgentPlansSchema } from '@modules/agent/plan-store'
import { createConversationRoutes } from '@modules/conversations/routes'
import { createConversationService } from '@modules/conversations/conversation-service'
import { createModelGateway } from '@modules/model/gateway'
import { createProviderConfigService } from '@modules/model/provider-config-service'
import { errorHandler } from '@core/http/middleware/error-handler'
import { buildAbilityForRole } from '@modules/permissions/roles'
import { createPermissionRegistry } from '@modules/permissions/registry'
import type { AIProvider, ModelRequest, StreamEvent } from '@modules/model/types'

/** Comfortably over the 40-character default gate. */
const LONG = 'Please always answer me in Hungarian, that is how I work.'

const USER_BATCH = JSON.stringify({
  notes: [{ kind: 'user', title: 'Working language', summary: 'Answers in Hungarian', body: 'The owner works in Hungarian.' }],
})

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
  db.run(sql`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT)`)
  db.run(sql`INSERT INTO projects (id, name, description) VALUES ('p1', 'Apollo', 'The billing rewrite')`)

  root = mkdtempSync(join(tmpdir(), 'eyas-capture-'))
  vault = createVaultService(root)
  const wikilinks = createWikilinkService(db); wikilinks.init()
  indexer = createVaultIndexer(db, vault, wikilinks)
  writer = createNoteWriter({ db, vault, indexer })

  fakeComplete = vi.fn().mockResolvedValue(USER_BATCH)
  logger = { warn: vi.fn(), debug: vi.fn() }
  captureConfig = { enabled: true, minUserChars: 40, maxPerConversation: 20, maxInputChars: 4_000 }
  capture = createMemoryCapture({ db, config: () => captureConfig, complete: fakeComplete, writer, logger })
})

afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('the extractor', () => {
  it('writes a note and a run row for a qualifying turn', async () => {
    await capture({ conversationId: 'c1', projectId: null, userMessage: LONG, assistantMessage: 'Rendben.' })

    expect(fakeComplete).toHaveBeenCalledTimes(1)
    expect(vault.listFiles().filter((f: string) => f.endsWith('.md'))).toHaveLength(1)
    const runs = runsFor('c1')
    expect(runs).toHaveLength(1)
    expect(runs[0].notes_written).toBe(1)
    expect(runs[0].skipped_reason).toBeNull()
  })

  it('records a too-short turn as a skip and spends no model call', async () => {
    await capture({ conversationId: 'c2', projectId: null, userMessage: 'ok', assistantMessage: 'Rendben.' })

    expect(fakeComplete).not.toHaveBeenCalled()
    const runs = runsFor('c2')
    expect(runs[0].skipped_reason).toBe('too-short')
    expect(runs[0].notes_written).toBe(0)
    expect(runs[0].kinds).toBeNull()
  })

  it('swallows a throwing extractor — the reply is already delivered', async () => {
    fakeComplete.mockRejectedValueOnce(new Error('model on fire'))
    await expect(capture({ conversationId: 'c3', projectId: null, userMessage: LONG, assistantMessage: 'r' }))
      .resolves.toBeUndefined()
    expect(logger.warn).toHaveBeenCalled()
    // Every outcome writes a row. An unreachable model is the single most
    // measurable way this feature dies; without a row it is also the most
    // invisible.
    expect(runsFor('c3')[0].skipped_reason).toBe('error')
    expect(runsFor('c3')[0].notes_written).toBe(0)
  })

  it('attributes an error row to the model that answered, when the throw came AFTER the call', async () => {
    // A model DID answer here, so the row must say which one — the whole point
    // of the column is that an outcome is traceable to a model. Only a call that
    // failed before returning leaves it null (the test below).
    // The injection is a log sink that fails mid-run: the per-note warn throws,
    // which is one of the few ways to reach the outer catch after a successful
    // completion without faking the parser or the schema.
    const throwOnce = { warn: vi.fn().mockImplementationOnce(() => { throw new Error('log sink down') }), debug: vi.fn() }
    const brokenWriter = { write: vi.fn().mockRejectedValue(new Error('vault read-only')) }
    const complete = vi.fn().mockResolvedValue({ text: USER_BATCH, provider: 'openai/gpt-5-mini' })
    const cap = createMemoryCapture({ db, config: () => captureConfig, complete, writer: brokenWriter as any, logger: throwOnce })

    await expect(cap({ conversationId: 'c28', projectId: null, userMessage: LONG, assistantMessage: 'r' })).resolves.toBeUndefined()
    const runs = db.all(sql`SELECT skipped_reason, provider FROM memory_capture_runs WHERE conversation_id = 'c28'`) as any[]
    expect(runs[0].skipped_reason).toBe('error')
    expect(runs[0].provider).toBe('openai/gpt-5-mini')
  })

  it('records an error row when the vault cannot be written', async () => {
    const brokenWriter = { write: vi.fn().mockRejectedValue(new Error('vault read-only')) }
    const brokenCapture = createMemoryCapture({ db, config: () => captureConfig, complete: fakeComplete, writer: brokenWriter as any, logger })
    // A write that fails for every note is still a run that spent its call:
    // it is counted, and the per-note failures are logged.
    await brokenCapture({ conversationId: 'c11', projectId: null, userMessage: LONG, assistantMessage: 'r' })
    const runs = runsFor('c11')
    expect(runs).toHaveLength(1)
    expect(runs[0].notes_written).toBe(0)
    expect(JSON.parse(runs[0].kinds)).toEqual([])
    // `notes_written 0, kinds []` alone reads exactly like the healthy empty
    // batch that is this feature's most common correct answer. A batch that
    // HAD notes and wrote none of them is an unwritable vault, and has to say so.
    expect(runs[0].skipped_reason).toBe('error')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('leaves a genuinely empty batch as a healthy run, not an error', async () => {
    // {"notes":[]} is the common and correct answer. It must stay
    // distinguishable from a batch whose every write failed.
    fakeComplete.mockResolvedValueOnce(JSON.stringify({ notes: [] }))
    await capture({ conversationId: 'c14', projectId: null, userMessage: LONG, assistantMessage: 'r' })
    const runs = runsFor('c14')
    expect(runs[0].notes_written).toBe(0)
    expect(JSON.parse(runs[0].kinds)).toEqual([])
    expect(runs[0].skipped_reason).toBeNull()
  })

  it('counts what a partial batch did write when a later note throws', async () => {
    fakeComplete.mockResolvedValueOnce(JSON.stringify({
      notes: [
        { kind: 'user', title: 'Working language', summary: 'Answers in Hungarian', body: 'Hungarian.' },
        { kind: 'reference', title: 'Docs home', summary: 'Docs live at the wiki', body: 'The wiki.' },
      ],
    }))
    let n = 0
    const flakyWriter = {
      write: vi.fn(async () => {
        n++
        if (n === 2) throw new Error('disk full')
        return { action: 'created' as const, path: 'semantic/working-language.md' }
      }),
    }
    const flakyCapture = createMemoryCapture({ db, config: () => captureConfig, complete: fakeComplete, writer: flakyWriter as any, logger })
    await flakyCapture({ conversationId: 'c12', projectId: null, userMessage: LONG, assistantMessage: 'r' })

    const runs = runsFor('c12')
    // The first note IS on disk — discarding the whole batch's count would
    // under-report what the vault holds. A partial batch is NOT an error row:
    // it wrote something, and its kinds say what.
    expect(runs[0].notes_written).toBe(1)
    expect(JSON.parse(runs[0].kinds)).toEqual(['user'])
    expect(runs[0].skipped_reason).toBeNull()
  })

  it('lets an errored run spend the cap', async () => {
    // A capture that keeps failing is exactly what the runaway guard is for.
    for (let i = 0; i < 20; i++) {
      db.run(sql`INSERT INTO memory_capture_runs (conversation_id, notes_written, skipped_reason) VALUES ('c13', 0, 'error')`)
    }
    await capture({ conversationId: 'c13', projectId: null, userMessage: LONG, assistantMessage: 'r' })
    expect(fakeComplete).not.toHaveBeenCalled()
    expect(runsFor('c13').at(-1).skipped_reason).toBe('cap-reached')
  })

  it('spends nothing at all when the switch is off', async () => {
    captureConfig.enabled = false
    await capture({ conversationId: 'c4', projectId: null, userMessage: LONG, assistantMessage: 'r' })

    expect(fakeComplete).not.toHaveBeenCalled()
    // A disabled feature is not a measurement: it writes no row either.
    expect(runsFor('c4')).toHaveLength(0)
  })

  it('stops the twenty-first extraction in one conversation', async () => {
    // Rows with no skipped_reason are runs that actually spent a model call.
    for (let i = 0; i < 20; i++) {
      db.run(sql`INSERT INTO memory_capture_runs (conversation_id, notes_written) VALUES ('c5', 1)`)
    }
    await capture({ conversationId: 'c5', projectId: null, userMessage: LONG, assistantMessage: 'r' })

    expect(fakeComplete).not.toHaveBeenCalled()
    expect(runsFor('c5').at(-1).skipped_reason).toBe('cap-reached')
  })

  it('does not let twenty short turns spend the budget', async () => {
    // The cap guards MODEL SPEND. Twenty "ok"s reach no model, so the next
    // fact-rich turn must still be extracted — that pattern is exactly what
    // this feature was built for.
    for (let i = 0; i < 20; i++) {
      await capture({ conversationId: 'c10', projectId: null, userMessage: 'ok', assistantMessage: 'r' })
    }
    expect(fakeComplete).not.toHaveBeenCalled()

    await capture({ conversationId: 'c10', projectId: null, userMessage: LONG, assistantMessage: 'r' })
    expect(fakeComplete).toHaveBeenCalledTimes(1)
    expect(runsFor('c10').at(-1).skipped_reason).toBeNull()
  })

  it('clips both messages before the model sees them', async () => {
    captureConfig.maxInputChars = 60
    await capture({ conversationId: 'c6', projectId: null, userMessage: 'y'.repeat(400), assistantMessage: 'z'.repeat(400) })

    const user: string = fakeComplete.mock.calls[0][0].user
    expect(user).toContain('[clipped]')
    expect(user).not.toContain('y'.repeat(61))
    expect(user).not.toContain('z'.repeat(61))
  })

  it('carries the do-not-save rules into the system prompt', async () => {
    await capture({ conversationId: 'c7', projectId: null, userMessage: LONG, assistantMessage: 'r' })
    const system: string = fakeComplete.mock.calls[0][0].system
    expect(system).toMatch(/Do NOT save/i)
    expect(system).toMatch(/repository already records/i)
  })

  // ── F1 deltas ─────────────────────────────────────────────────────────────

  it('offers project kind and the project context only when there is an effective project', async () => {
    await capture({ conversationId: 'c1', projectId: 'p1', userMessage: LONG, assistantMessage: 'reply' })
    expect(fakeComplete.mock.calls[0][0].user).toContain('PROJECT:')
    expect(fakeComplete.mock.calls[0][0].user).toContain('Apollo')

    await capture({ conversationId: 'c2', projectId: 'general-general', userMessage: LONG, assistantMessage: 'reply' })
    expect(fakeComplete.mock.calls[1][0].user).not.toContain('PROJECT:')
  })

  it('announces the project even when its row cannot be read', async () => {
    // The schema's allowProject gate keys off the effective project id, not off
    // this lookup. If the announcement went missing while the kind stayed open,
    // the model would be offered a kind the prompt tells it not to use.
    db.run(sql`DROP TABLE projects`)
    await capture({ conversationId: 'c8', projectId: 'p1', userMessage: LONG, assistantMessage: 'reply' })
    expect(fakeComplete.mock.calls[0][0].user).toContain('PROJECT:')
  })

  it('offers domain kind and the TYPE section only when the project has a type', async () => {
    db.run(sql`ALTER TABLE projects ADD COLUMN type_id TEXT`)
    db.run(sql`CREATE TABLE IF NOT EXISTS project_types (id TEXT PRIMARY KEY, name TEXT NOT NULL)`)
    db.run(sql`INSERT INTO project_types (id, name) VALUES ('type-a', 'Type A')`)
    db.run(sql`UPDATE projects SET type_id = 'type-a' WHERE id = 'p1'`)

    await capture({ conversationId: 'c-type', projectId: 'p1', userMessage: LONG, assistantMessage: 'reply' })
    const withType: string = fakeComplete.mock.calls[0][0].user
    expect(withType).toContain('TYPE:')
    expect(withType).toContain('Type A')
    expect(withType).toContain('PROJECT:')

    await capture({ conversationId: 'c-none', projectId: 'general-general', userMessage: LONG, assistantMessage: 'reply' })
    expect(fakeComplete.mock.calls[1][0].user).not.toContain('TYPE:')
  })

  it('writes a domain note into the type folder when the extractor files one', async () => {
    db.run(sql`ALTER TABLE projects ADD COLUMN type_id TEXT`)
    db.run(sql`CREATE TABLE IF NOT EXISTS project_types (id TEXT PRIMARY KEY, name TEXT NOT NULL)`)
    db.run(sql`INSERT INTO project_types (id, name) VALUES ('type-a', 'Type A')`)
    db.run(sql`UPDATE projects SET type_id = 'type-a' WHERE id = 'p1'`)

    fakeComplete.mockResolvedValueOnce(JSON.stringify({
      notes: [{ kind: 'domain', title: 'Shared tax groups', summary: 'Tax groups are shared across the type', body: 'Shared across sibling projects.' }],
    }))
    await capture({ conversationId: 'c-domain', projectId: 'p1', userMessage: LONG, assistantMessage: 'reply' })

    expect(vault.exists('project-types/type-a/shared-tax-groups.md')).toBe(true)
    const runs = runsFor('c-domain')
    expect(JSON.parse(runs[0].kinds)).toEqual(['domain'])
  })

  it('does not announce TYPE when the project row has no type_id', async () => {
    await capture({ conversationId: 'c-notype', projectId: 'p1', userMessage: LONG, assistantMessage: 'reply' })
    expect(fakeComplete.mock.calls[0][0].user).toContain('PROJECT:')
    expect(fakeComplete.mock.calls[0][0].user).not.toContain('TYPE:')
  })

  it('downgrades a project note returned for a projectless conversation to reference, instead of dropping it', async () => {
    // F1.7: the schema no longer rejects a project-kind note under no-project —
    // it downgrades the kind to `reference` so the fact still reaches the
    // vault. This replaces the F1.6 expectation of a rejected-shape row.
    fakeComplete.mockResolvedValueOnce(JSON.stringify({ notes: [{ kind: 'project', title: 'Rule', summary: 'A rule scoped to a project', body: 'xxx' }] }))
    await capture({ conversationId: 'c3', projectId: null, userMessage: LONG, assistantMessage: 'reply' })
    const runs = db.all(sql`SELECT skipped_reason, notes_written, kinds FROM memory_capture_runs WHERE conversation_id = 'c3'`) as any[]
    expect(runs[0].skipped_reason).toBeNull()
    expect(runs[0].notes_written).toBe(1)
    expect(JSON.parse(runs[0].kinds)).toEqual(['reference'])
  })

  it('records which kinds were written', async () => {
    // `body` is 3+ chars on purpose: the candidate schema's floor. A shorter
    // one is a schema rejection, which is a different outcome (rejected-shape).
    fakeComplete.mockResolvedValueOnce(JSON.stringify({ notes: [{ kind: 'user', title: 'Lang', summary: 'Hungarian', body: 'Hungarian.' }] }))
    await capture({ conversationId: 'c4', projectId: null, userMessage: LONG, assistantMessage: 'reply' })
    const runs = db.all(sql`SELECT kinds FROM memory_capture_runs WHERE conversation_id = 'c4'`) as any[]
    expect(JSON.parse(runs[0].kinds)).toEqual(['user'])
  })

  it('feeds the existing index one-liners into the prompt', async () => {
    db.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, kind, summary, file_hash, indexed_at)
      VALUES ('semantic/u.md', 'Language', 'semantic', '[]', 'b', 'user', 'Answers in Hungarian', 'h', ${new Date().toISOString()})`)
    await capture({ conversationId: 'c5', projectId: null, userMessage: LONG, assistantMessage: 'reply' })
    expect(fakeComplete.mock.calls.at(-1)![0].user).toContain('Answers in Hungarian')
  })

  it('leaves a not-JSON reply as an unparsable run row, never a retry', async () => {
    fakeComplete.mockResolvedValueOnce('I am afraid I cannot do that.')
    await capture({ conversationId: 'c9', projectId: null, userMessage: LONG, assistantMessage: 'reply' })
    expect(fakeComplete).toHaveBeenCalledTimes(1)
    expect(runsFor('c9')[0].skipped_reason).toBe('unparsable')
  })

  // ── F1.1: replies from a model that is not answering in a JSON envelope ────

  it('unwraps a markdown fence', async () => {
    fakeComplete.mockResolvedValueOnce('```json\n' + USER_BATCH + '\n```')
    await capture({ conversationId: 'c15', projectId: null, userMessage: LONG, assistantMessage: 'r' })
    expect(runsFor('c15')[0].notes_written).toBe(1)
  })

  it('finds the object a chatty model buried in prose', async () => {
    // What an agentic CLI actually returns: it narrates, then answers.
    fakeComplete.mockResolvedValueOnce(`I read the exchange and found one durable fact.\n\n${USER_BATCH}\n\nLet me know if you want more.`)
    await capture({ conversationId: 'c16', projectId: null, userMessage: LONG, assistantMessage: 'r' })
    const runs = runsFor('c16')
    expect(runs[0].notes_written).toBe(1)
    expect(runs[0].skipped_reason).toBeNull()
  })

  it('survives an odd quote in the narration before the object', async () => {
    // M9. "here's what I found" leaves one unmatched apostrophe — and a
    // straight quote in prose leaves an unmatched `"`. A scanner that tracked
    // strings outside the object would swallow the batch that follows.
    fakeComplete.mockResolvedValueOnce(`Here is the one durable fact I found (the owner's "working language:\n${USER_BATCH}`)
    await capture({ conversationId: 'c21', projectId: null, userMessage: LONG, assistantMessage: 'r' })
    expect(runsFor('c21')[0].notes_written).toBe(1)
  })

  it('is not fooled by braces inside the JSON\'s own strings', async () => {
    const withBraces = JSON.stringify({
      notes: [{ kind: 'user', title: 'Brace', summary: 'Writes {} in prose', body: 'The owner writes "}" and "{" a lot.' }],
    })
    fakeComplete.mockResolvedValueOnce(`Sure:\n${withBraces}\ndone`)
    await capture({ conversationId: 'c17', projectId: null, userMessage: LONG, assistantMessage: 'r' })
    expect(runsFor('c17')[0].notes_written).toBe(1)
  })

  it('still records a reply with no object at all as unparsable', async () => {
    fakeComplete.mockResolvedValueOnce('I have finished reviewing the code and made no changes.')
    await capture({ conversationId: 'c18', projectId: null, userMessage: LONG, assistantMessage: 'r' })
    expect(runsFor('c18')[0].skipped_reason).toBe('unparsable')
  })

  it('names the reply\'s length and head in the unusable-output warning', async () => {
    // Tonight's diagnosis had a warn with only a conversation id: whether the
    // extractor answered in prose, in a fence, or not at all was unknowable
    // without re-running it.
    fakeComplete.mockResolvedValueOnce(`I'll go ahead and refactor the module first. ${'x'.repeat(500)}`)
    await capture({ conversationId: 'c19', projectId: null, userMessage: LONG, assistantMessage: 'r' })

    const call = logger.warn.mock.calls.find((c: any[]) => String(c[1]).includes('unusable extractor output'))
    expect(call, 'the unparsable path must warn').toBeTruthy()
    expect(call![0].replyChars).toBeGreaterThan(500)
    expect(call![0].replyHead).toContain("I'll go ahead and refactor")
    // A clipped head, not the whole reply — this goes to the log on every
    // failing turn.
    expect(call![0].replyHead.length).toBeLessThanOrEqual(220)
  })

  it('demands the bare object in the system prompt, for models that would rather chat', async () => {
    await capture({ conversationId: 'c20', projectId: null, userMessage: LONG, assistantMessage: 'r' })
    const system: string = fakeComplete.mock.calls[0][0].system
    expect(system).toMatch(/nothing else/i)
    expect(system).toMatch(/no (commentary|markdown|tool)/i)
  })

  // ── F1.2: the reply's claims about memory are not evidence ────────────────

  it('tells the extractor to judge coverage against EXISTING NOTES, not the reply\'s claims', async () => {
    // Live run #3: the assistant answered "I've saved that to memory" — it had
    // not (tool_executions 0, episodic_memories 0) — and the extractor honoured
    // the do-not-restate rule against a claim instead of against its own
    // EXISTING NOTES section, which was empty. A healthy-empty batch on a
    // fact-dense turn. We cannot assert what a model concludes; we pin that the
    // instruction is delivered.
    await capture({
      conversationId: 'c22',
      projectId: null,
      userMessage: 'From now on always answer me in Hungarian, that is how I work.',
      assistantMessage: 'Rendben — I have already saved that to memory with save_memory, so it is recorded.',
    })
    const system: string = fakeComplete.mock.calls[0][0].system
    expect(system).toMatch(/EXISTING NOTES/)
    expect(system).toMatch(/false by definition/i)
    expect(system).toMatch(/MUST be returned, even when the reply claims it is already stored/i)

    // …and the section that rule points at must EXIST on a fresh vault, saying
    // plainly that nothing is covered. Omitting it left the model judging
    // coverage against a section it could not see — which is the live-failure
    // condition exactly: an empty vault and a reply claiming a save.
    const user: string = fakeComplete.mock.calls[0][0].user
    expect(user).toContain('EXISTING NOTES (do not restate any of these):')
    expect(user).toContain('(none)')
  })

  it('carries the ground-truth rule in the exported constant', () => {
    // The deterministic half of the same check, independent of any call path.
    expect(CAPTURE_SYSTEM_PROMPT).toMatch(/Coverage is judged ONLY/)
    // \s+ across the wrap: the prompt's line breaks are part of its shipped
    // text, and a regex that assumes one line would fail on a reflow rather
    // than on the rule going missing.
    expect(CAPTURE_SYSTEM_PROMPT).toMatch(/already saved, recorded or\s+known is false by definition/i)
    // The USER MESSAGE is the source of facts; the reply is only context. A
    // reply-sourced fact is how a false "already saved" claim became a vote.
    expect(CAPTURE_SYSTEM_PROMPT).toMatch(/Extract facts stated by the USER MESSAGE/)
    expect(CAPTURE_SYSTEM_PROMPT).toMatch(/never a source of coverage/)
  })

  it('states the schema limits that decide whether a batch survives', () => {
    // A live CLI reply returned a 199-character summary; the schema dropped the
    // whole batch and the row read 'unparsable'. A limit the model is never
    // told is a limit it cannot respect.
    expect(CAPTURE_SYSTEM_PROMPT).toMatch(/At most 2 notes/)
    expect(CAPTURE_SYSTEM_PROMPT).toMatch(/summary 140/)
    expect(CAPTURE_SYSTEM_PROMPT).toMatch(/gets the whole batch dropped/)
  })

  it('states limits the schema actually enforces, so the prompt cannot lie', () => {
    // A prompt that quotes a limit is only useful while the number is true; a
    // schema change that left this text behind would teach the model a bound
    // that drops its batch. The count comes from the constant, and 140 is
    // checked against the schema itself rather than asserted twice.
    expect(CAPTURE_SYSTEM_PROMPT).toContain(`At most ${MAX_CANDIDATES} notes`)
    const schema = createCandidateBatchSchema({ allowProject: false })
    const note = (summaryLength: number) => ({
      notes: [{ kind: 'user', title: 'Title', summary: 's'.repeat(summaryLength), body: 'body' }],
    })
    expect(schema.safeParse(note(140)).success).toBe(true)
    expect(schema.safeParse(note(141)).success).toBe(false)
  })

  it('no longer calls the empty batch the common and correct answer', () => {
    // That absolute was an empty-bias on exactly the borderline inputs this
    // feature exists for: it made "return nothing" the sanctioned answer.
    expect(CAPTURE_SYSTEM_PROMPT).not.toMatch(/That is the common and correct answer/)
    expect(CAPTURE_SYSTEM_PROMPT).toMatch(/common for ordinary task turns/)
    expect(CAPTURE_SYSTEM_PROMPT).toMatch(/It is WRONG when the USER MESSAGE states a durable fact/)
  })

  // ── F1.2: which model produced this outcome ───────────────────────────────

  it('records the provider that answered on the run row', async () => {
    fakeComplete.mockResolvedValueOnce({ text: USER_BATCH, provider: 'openai/gpt-5-mini' })
    await capture({ conversationId: 'c23', projectId: null, userMessage: LONG, assistantMessage: 'r' })
    const runs = db.all(sql`SELECT provider, notes_written FROM memory_capture_runs WHERE conversation_id = 'c23'`) as any[]
    expect(runs[0].provider).toBe('openai/gpt-5-mini')
    expect(runs[0].notes_written).toBe(1)
  })

  it('records the provider on an unparsable run too — that is the row worth attributing', async () => {
    fakeComplete.mockResolvedValueOnce({ text: 'I refuse.', provider: 'grok-cli/gateway-fallback' })
    await capture({ conversationId: 'c24', projectId: null, userMessage: LONG, assistantMessage: 'r' })
    const runs = db.all(sql`SELECT provider, skipped_reason FROM memory_capture_runs WHERE conversation_id = 'c24'`) as any[]
    expect(runs[0].skipped_reason).toBe('unparsable')
    expect(runs[0].provider).toBe('grok-cli/gateway-fallback')
  })

  it('leaves the provider null when no model was called', async () => {
    // A gate skip spends nothing, so there is nothing to attribute; an errored
    // call may have failed before any provider answered.
    await capture({ conversationId: 'c25', projectId: null, userMessage: 'ok', assistantMessage: 'r' })
    fakeComplete.mockRejectedValueOnce(new Error('model on fire'))
    await capture({ conversationId: 'c26', projectId: null, userMessage: LONG, assistantMessage: 'r' })
    const skip = db.all(sql`SELECT provider FROM memory_capture_runs WHERE conversation_id = 'c25'`) as any[]
    const err = db.all(sql`SELECT provider FROM memory_capture_runs WHERE conversation_id = 'c26'`) as any[]
    expect(skip[0].provider).toBeNull()
    expect(err[0].provider).toBeNull()
  })

  it('still accepts a plain string reply, provider unknown', async () => {
    // The completion callback is injectable; a caller that returns just text is
    // a valid caller, and every pre-F1.2 test is one.
    fakeComplete.mockResolvedValueOnce(USER_BATCH)
    await capture({ conversationId: 'c27', projectId: null, userMessage: LONG, assistantMessage: 'r' })
    const runs = db.all(sql`SELECT provider, notes_written FROM memory_capture_runs WHERE conversation_id = 'c27'`) as any[]
    expect(runs[0].notes_written).toBe(1)
    expect(runs[0].provider).toBeNull()
  })
})

// ── The background call site ────────────────────────────────────────────────

describe('the background call site', () => {
  let bgDb: any
  let deps: any
  let memoryCapture: any

  beforeEach(() => {
    bgDb = createMemoryDb()
    bgDb.run(sql`CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle',
      mode TEXT NOT NULL DEFAULT 'simple', agent_id TEXT, project_id TEXT,
      goal_description TEXT, provider_id TEXT, model_id TEXT, stage_id TEXT,
      team_session_id TEXT, thinking TEXT NOT NULL DEFAULT 'off', thinking_budget INTEGER,
      effort TEXT, orchestration TEXT, working_directories TEXT,
      tokens_used INTEGER NOT NULL DEFAULT 0, total_cost_usd REAL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`)
    bgDb.run(sql`CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL,
      role TEXT NOT NULL, content TEXT, created_at TEXT NOT NULL
    )`)
    bgDb.run(sql`CREATE TABLE IF NOT EXISTS autonomy_approvals (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT)`)
    ensureRunSupervisionSchema(bgDb)
    ensureAgentPlansSchema(bgDb)
    createMemoryTables(bgDb)

    const now = new Date().toISOString()
    bgDb.run(sql`INSERT INTO conversations (id, title, status, mode, agent_id, project_id, goal_description, created_at, updated_at)
      VALUES ('conv-1', 'C', 'waiting', 'autonomous', 'agent-1', 'p1', 'do the thing', ${now}, ${now})`)
    bgDb.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, created_at)
      VALUES ('conv-1', 'user', 'first ask', '2026-08-27T10:00:00Z'),
             ('conv-1', 'assistant', 'first answer', '2026-08-27T10:00:01Z'),
             ('conv-1', 'user', 'the standing instruction', '2026-08-27T10:00:02Z'),
             ('conv-1', 'assistant', 'the final answer', '2026-08-27T10:00:03Z')`)

    memoryCapture = vi.fn().mockResolvedValue(undefined)
    let n = 0
    deps = {
      db: bgDb,
      agentRunner: {
        run: vi.fn(() => ({ async *[Symbol.asyncIterator]() { yield { type: 'turn_complete', tokensUsed: 1 } } })),
      },
      agentRegistry: {
        get: vi.fn().mockReturnValue({ id: 'agent-1', enabled: true, systemPrompt: 'base prompt', tools: ['t'], maxTurns: 4, model: 'm' }),
        isWithinBudget: vi.fn().mockReturnValue(true),
        addTokenUsage: vi.fn(),
      },
      toolRegistry: { toToolDefinitions: vi.fn().mockReturnValue([{ name: 't' }]) },
      supervisor: createRunSupervisor({ db: bgDb }),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      generateId: () => `run-${++n}`,
      memoryCapture,
    }
  })

  it('captures the finished exchange from the store the runner already wrote', async () => {
    await runConversation('conv-1', deps)

    expect(memoryCapture).toHaveBeenCalledTimes(1)
    expect(memoryCapture.mock.calls[0][0]).toEqual({
      conversationId: 'conv-1',
      projectId: 'p1',
      userMessage: 'the standing instruction',
      assistantMessage: 'the final answer',
    })
  })

  it('falls back to the goal and the run\'s last output when nothing was stored', async () => {
    // runConversation never writes conversation_messages, so an autonomous card
    // has no stored exchange. Reading only the table captured ('', '') — one
    // junk skip row per run and never a note.
    bgDb.run(sql`DELETE FROM conversation_messages WHERE conversation_id = 'conv-1'`)
    deps.eventStore = {
      append: vi.fn().mockResolvedValue(undefined),
      getByTypes: vi.fn().mockResolvedValue([
        { payload: { response: { content: 'an early thought' } } },
        { payload: { response: { content: 'what the run concluded' } } },
      ]),
    }

    await runConversation('conv-1', deps)

    expect(memoryCapture).toHaveBeenCalledTimes(1)
    expect(memoryCapture.mock.calls[0][0]).toEqual({
      conversationId: 'conv-1',
      projectId: 'p1',
      // The LAST output, not the joined transcript: capture clips from the
      // head, so a join would feed the extractor the run's opening moves.
      userMessage: 'do the thing',
      assistantMessage: 'what the run concluded',
    })
  })

  it('does not call capture at all when there is nothing to capture', async () => {
    bgDb.run(sql`DELETE FROM conversation_messages WHERE conversation_id = 'conv-1'`)
    await runConversation('conv-1', deps)
    expect(memoryCapture).not.toHaveBeenCalled()
  })

  it('completes the run when capture rejects', async () => {
    memoryCapture.mockRejectedValueOnce(new Error('vault on fire'))
    await expect(runConversation('conv-1', deps)).resolves.toMatchObject({ ran: true })
  })

  it('runs unchanged with no capture wired at all', async () => {
    delete deps.memoryCapture
    await expect(runConversation('conv-1', deps)).resolves.toMatchObject({ ran: true })
  })
})

// ── The interactive call site ───────────────────────────────────────────────

const interactiveDb = createTestDb('capture-wiring')

function makeAbility() {
  const reg = createPermissionRegistry()
  reg.registerSubject('Conversation', {
    actions: ['read', 'update', 'create', 'delete'],
    defaults: { admin: ['read', 'update', 'create', 'delete'], owner: ['read', 'update', 'create', 'delete'], user: ['read'], agent: [], guest: [] },
  })
  reg.registerSubject('ConversationMessage', {
    actions: ['read', 'create'],
    defaults: { admin: ['read', 'create'], owner: ['read', 'create'], user: ['read'], agent: [], guest: [] },
  })
  return buildAbilityForRole('owner', reg)
}

describe('the interactive call site', () => {
  let app: Hono
  let conversationId: string
  let chatSvc: ReturnType<typeof createConversationService>

  async function mount(
    getMemoryCapture?: () => ((input: CaptureInput) => Promise<void>) | undefined,
    getMemoryIndex?: (opts?: { projectId?: string | null }) => { content: string; paths: string[] } | null,
  ) {
    const idb = interactiveDb.open()
    const userId = await insertTestOwner(idb, `owner-${Date.now()}-${Math.floor(performance.now())}`)

    const provider: AIProvider = {
      id: 'p1', name: 'p1',
      async listModels() { return [] },
      async complete() { throw new Error('unused') },
      async *stream(_request: ModelRequest): AsyncIterable<StreamEvent> {
        yield { type: 'text', text: 'the delivered reply' }
        yield {
          type: 'done',
          response: {
            id: 'r1', provider: 'p1', model: 'm1',
            content: [{ type: 'text', text: 'the delivered reply' }],
            stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1 },
          },
        }
      },
    }
    const gateway = createModelGateway()
    gateway.registerProvider(provider)

    const chatService = createConversationService(idb)
    chatSvc = chatService
    conversationId = chatService.create({ userId, title: 'T', providerId: 'p1', modelId: 'm1', projectId: 'p1' }).id

    const ability = makeAbility()
    app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c: any, next: any) => { c.set('ability', ability); c.set('userId', userId); await next() })

    createConversationRoutes(
      app as any, chatService, gateway, createProviderConfigService(idb),
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, undefined, undefined,
      undefined,          // getDesigns
      getMemoryIndex,
      undefined,          // skillDecisions
      getMemoryCapture,   // the parameter under test
    )
  }

  async function send(): Promise<void> {
    const res = await app.request(`/api/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'the standing instruction', provider: 'p1', model: 'm1' }),
    })
    expect(res.status).toBe(200)
    await res.text()
  }

  it('captures the delivered exchange, with the conversation\'s raw project', async () => {
    const spy = vi.fn().mockResolvedValue(undefined)
    await mount(() => spy)
    await send()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0]).toEqual({
      conversationId,
      projectId: 'p1',
      userMessage: 'the standing instruction',
      assistantMessage: 'the delivered reply',
    })
  })

  it('falls back to the stored user message on a resume, which carries no content', async () => {
    // A resume re-runs a turn a skill proposal stopped: its user message is
    // already stored and the body deliberately carries none. Reading only the
    // body gated exactly these substantive turns away as too-short.
    const spy = vi.fn().mockResolvedValue(undefined)
    await mount(() => spy)
    chatSvc.addMessage(conversationId, { role: 'user', content: 'the stored standing instruction' })

    const res = await app.request(`/api/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: true, provider: 'p1', model: 'm1' }),
    })
    expect(res.status).toBe(200)
    await res.text()

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0].userMessage).toBe('the stored standing instruction')
    expect(spy.mock.calls[0][0].assistantMessage).toBe('the delivered reply')
  })

  it('answers the turn when capture rejects', async () => {
    const spy = vi.fn().mockRejectedValue(new Error('vault on fire'))
    await mount(() => spy)
    await expect(send()).resolves.toBeUndefined()
  })

  it('answers the turn when no capture is wired', async () => {
    await mount(undefined)
    await expect(send()).resolves.toBeUndefined()
  })

  // Capture's sibling on the read side. The wiring lambda shipped once in this
  // same phase as the ZERO-ARG form `() => ctx.memoryIndex?.()`, which
  // type-checks perfectly and silently drops the projectId the route resolves —
  // so no `project` note could ever rank into an interactive prompt, and no
  // test noticed. It was hand-repaired; these two are what stop it coming back.
  it('passes the conversation\'s effective project to the memory index accessor', async () => {
    const spy = vi.fn().mockReturnValue(null)
    await mount(undefined, spy)
    await send()
    expect(spy).toHaveBeenCalled()
    expect(spy.mock.calls[0][0]).toEqual({ projectId: 'p1' })
  })
})

describe('the memory index wiring', () => {
  it('forwards its argument, rather than being a zero-arg lambda', async () => {
    // The behavioural test above proves the ROUTE passes the options; only the
    // module wiring decides whether they survive the trip, and TypeScript
    // cannot see the difference (a zero-arg lambda satisfies the type).
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve(process.cwd(), 'src/modules/conversations/index.ts'), 'utf-8')
    const line = source.split('\n').find((l) => l.includes('memoryIndex?.('))
    expect(line, 'conversations/index.ts must still wire ctx.memoryIndex').toBeTruthy()

    const forwarded = line!.match(/\((\w+)\)\s*=>[^=]*memoryIndex\?\.\((\w+)\)/)
    expect(forwarded, `the memoryIndex wiring must forward its argument, got: ${line?.trim()}`).toBeTruthy()
    expect(forwarded![1]).toBe(forwarded![2])
  })
})
