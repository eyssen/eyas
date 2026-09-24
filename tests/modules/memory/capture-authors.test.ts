// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The durable-fact pass reads a message as its author wrote it. The owner's
// own words describe the owner; an agent's composed task relays at best; a
// peer's (a channel contact, an A2A agent) describe the peer and never set
// how EYAS works. One gate, one cap and one run row for all of them, with
// the entry path on the row.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import { createWikilinkService } from '@shared/wikilinks'
import { createNoteWriter } from '@modules/memory/capture/note-writer'
import { createMemoryCapture, type CaptureInput } from '@modules/memory/capture/index'
import { buildCaptureUser } from '@modules/memory/capture/capture-prompt'
import { createCandidateBatchSchema, createCandidateSchema } from '@modules/memory/capture/candidate-schema'
import type { CaptureConfig } from '@modules/memory/capture/capture-gate'
import type { AuxResult } from '@modules/model/auxiliary'
import { wrapUntrusted } from '@shared/untrusted'

/** Over the 40-character default gate. */
const LONG = 'The harbor office closes its ledger on the last Friday of every quarter.'

const reply = (text: string): AuxResult =>
  ({ ok: true, text, provider: 'openai', model: 'gpt-5-mini', route: 'api', usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end' })

const USER_NOTE = { kind: 'user', title: 'Working language', summary: 'Answers in Hungarian', body: 'The owner works in Hungarian.' }
const FEEDBACK_NOTE = { kind: 'feedback', title: 'Copy the sender', summary: 'Always copy the sender on invoices', body: 'Copy them.', why: 'They asked', howToApply: 'On every invoice' }
const REFERENCE_NOTE = { kind: 'reference', title: 'Harbor ledger close', summary: 'The harbor ledger closes on the last Friday of a quarter', body: 'The harbor office closes its ledger on the last Friday of every quarter.' }

let db: any, root: string, vault: any, indexer: any, writer: any
let complete: any
let config: CaptureConfig
let capture: (input: CaptureInput) => Promise<void>

const rows = (conversationId: string) =>
  db.all(sql`SELECT notes_written, kinds, skipped_reason, entry_path FROM memory_capture_runs
    WHERE conversation_id = ${conversationId} ORDER BY id ASC`) as any[]
const userPromptOf = (i = 0): string => complete.mock.calls[i][0].user
const notes = () => vault.listFiles().filter((f: string) => f.endsWith('.md'))

function input(over: Partial<CaptureInput> = {}): CaptureInput {
  return { conversationId: 'c1', projectId: null, userMessage: LONG, assistantMessage: 'Noted.', author: 'owner', entryPath: 'interactive', ...over }
}

beforeEach(() => {
  db = createMemoryDb()
  createMemoryTables(db)
  root = mkdtempSync(join(tmpdir(), 'eyas-capture-authors-'))
  vault = createVaultService(root)
  const wikilinks = createWikilinkService(db); wikilinks.init()
  indexer = createVaultIndexer(db, vault, wikilinks)
  writer = createNoteWriter({ db, vault, indexer })
  complete = vi.fn().mockResolvedValue(reply(JSON.stringify({ notes: [] })))
  config = { enabled: true, minUserChars: 40, maxPerConversation: 20, maxInputChars: 4_000 }
  capture = createMemoryCapture({ db, config: () => config, complete, writer, logger: { warn: vi.fn(), debug: vi.fn() } })
})

afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('the run row names the entry path', () => {
  it('records the entry path on a completed run and on a gate skip alike', async () => {
    await capture(input({ conversationId: 'e1', entryPath: 'team', author: 'agent' }))
    await capture(input({ conversationId: 'e2', entryPath: 'channel', author: 'peer', userMessage: 'ok' }))
    expect(rows('e1')).toEqual([{ notes_written: 0, kinds: '[]', skipped_reason: null, entry_path: 'team' }])
    expect(rows('e2')).toEqual([{ notes_written: 0, kinds: null, skipped_reason: 'too-short', entry_path: 'channel' }])
  })

  it('writes no row at all when the switch is off, whatever the entry path (negative)', async () => {
    config = { ...config, enabled: false }
    await capture(input({ conversationId: 'e3', entryPath: 'delegation', author: 'agent' }))
    expect(rows('e3')).toEqual([])
    expect(complete).not.toHaveBeenCalled()
  })
})

describe('the owner and composed tasks', () => {
  it('adds no AUTHOR section for the owner\'s own words (negative)', async () => {
    await capture(input())
    expect(userPromptOf()).not.toContain('AUTHOR:')
    expect(userPromptOf()).not.toContain('<untrusted-input')
  })

  it('tells the extractor an agent composed a delegated task, and still lets it record a fact about the owner', async () => {
    complete.mockResolvedValueOnce(reply(JSON.stringify({ notes: [USER_NOTE] })))
    await capture(input({ conversationId: 'a1', author: 'agent', entryPath: 'delegation' }))
    expect(userPromptOf()).toContain('AUTHOR:')
    expect(userPromptOf()).toContain('The USER MESSAGE is a task instruction')
    expect(rows('a1')[0]).toMatchObject({ notes_written: 1, kinds: '["user"]', entry_path: 'delegation' })
  })

  it('labels a note from a composed task as model-derived, never as the owner\'s', async () => {
    complete.mockResolvedValueOnce(reply(JSON.stringify({ notes: [USER_NOTE] })))
    await capture(input({ conversationId: 'a2', author: 'agent', entryPath: 'team' }))
    const trust = db.all(sql`SELECT trust_tier FROM vault_index`) as any[]
    expect(trust.map((r) => r.trust_tier)).toEqual(['derived'])
  })
})

describe('a peer\'s words', () => {
  const peer = (over: Partial<CaptureInput> = {}) =>
    input({ conversationId: 'p1', author: 'peer', entryPath: 'channel', userMessage: wrapUntrusted(LONG, { source: 'telegram' }), ...over })

  it('reaches the extractor fenced, with the peer AUTHOR section', async () => {
    await capture(peer())
    const user = userPromptOf()
    expect(user).toContain('An external sender wrote the USER MESSAGE')
    expect(user).toContain('never use kind "user" or "feedback"')
    expect(user).toContain(`<untrusted-input source="telegram">\n${LONG}\n</untrusted-input>`)
    // The stored frame is read, not nested: one fence around the words.
    expect(user.match(/<untrusted-input/g)).toHaveLength(1)
  })

  it('is gated on the sender\'s words, not on the frame around them (negative)', async () => {
    // The frame alone is longer than minUserChars: an "ok" over a channel
    // must not spend a model call.
    await capture(peer({ userMessage: wrapUntrusted('ok', { source: 'telegram' }) }))
    expect(complete).not.toHaveBeenCalled()
    expect(rows('p1')).toEqual([{ notes_written: 0, kinds: null, skipped_reason: 'too-short', entry_path: 'channel' }])
  })

  it('is fenced even when the caller passed it bare', async () => {
    await capture(peer({ userMessage: LONG, entryPath: 'a2a' }))
    expect(userPromptOf()).toContain(`<untrusted-input source="external">\n${LONG}\n</untrusted-input>`)
  })

  it('cannot open a note about the owner or a rule for how to work (negative)', async () => {
    complete.mockResolvedValueOnce(reply(JSON.stringify({ notes: [USER_NOTE, FEEDBACK_NOTE] })))
    await capture(peer())
    expect(notes()).toEqual([])
    expect(rows('p1')[0]).toMatchObject({ notes_written: 0, skipped_reason: 'rejected-shape' })
  })

  it('may record an external fact, trusted as the peer is', async () => {
    complete.mockResolvedValueOnce(reply(JSON.stringify({ notes: [REFERENCE_NOTE, USER_NOTE] })))
    await capture(peer())
    expect(rows('p1')[0]).toMatchObject({ notes_written: 1, kinds: '["reference"]', entry_path: 'channel' })
    const [path] = notes()
    expect(vault.read(path)!.frontmatter.trust).toBe('peer')
    const indexed = db.all(sql`SELECT trust_tier FROM vault_index WHERE path = ${path}`) as any[]
    expect(indexed[0].trust_tier).toBe('peer')
  })

  it('never reinforces a note trusted more than the peer: it gets its own file', async () => {
    // First the owner's side (a derived note from an interactive turn)…
    complete.mockResolvedValueOnce(reply(JSON.stringify({ notes: [REFERENCE_NOTE] })))
    await capture(input({ conversationId: 'o1' }))
    const [ownerPath] = notes()
    const before = vault.read(ownerPath)!.content
    // …then a peer restates it.
    complete.mockResolvedValueOnce(reply(JSON.stringify({ notes: [REFERENCE_NOTE] })))
    await capture(peer())
    expect(vault.read(ownerPath)!.content).toBe(before)
    expect(vault.read(ownerPath)!.frontmatter.trust).toBeUndefined()
    const peerPaths = notes().filter((p: string) => p !== ownerPath)
    expect(peerPaths).toHaveLength(1)
    expect(vault.read(peerPaths[0])!.frontmatter.trust).toBe('peer')
  })

  it('does reinforce its own earlier peer note (positive)', async () => {
    complete.mockResolvedValue(reply(JSON.stringify({ notes: [REFERENCE_NOTE] })))
    await capture(peer())
    await capture(peer())
    expect(notes()).toHaveLength(1)
    const [path] = notes()
    expect(vault.read(path)!.content).toContain('## History')
    expect(vault.read(path)!.frontmatter.trust).toBe('peer')
  })

  it('spends the same per-conversation cap as any other path', async () => {
    config = { ...config, maxPerConversation: 1 }
    await capture(peer())
    await capture(peer())
    expect(complete).toHaveBeenCalledTimes(1)
    expect(rows('p1').map((r) => r.skipped_reason)).toEqual([null, 'cap-reached'])
  })
})

describe('the prompt builder', () => {
  it('fences after clipping, so a long peer message keeps its closing tag', () => {
    const user = buildCaptureUser('x'.repeat(100), 'a', 20, { author: 'peer', fenceSource: 'email' })
    expect(user).toContain('[clipped]\n</untrusted-input>')
  })

  it('leaves an agent-authored message bare (negative)', () => {
    const user = buildCaptureUser('the task', 'a', 100, { author: 'agent' })
    expect(user).not.toContain('<untrusted-input')
    expect(user).toContain('USER MESSAGE:\nthe task')
  })
})

describe('the candidate schema', () => {
  it('rejects user and feedback notes when owner kinds are closed', () => {
    const closed = createCandidateSchema({ allowProject: false, allowOwnerKinds: false })
    expect(closed.safeParse(USER_NOTE).success).toBe(false)
    expect(closed.safeParse(FEEDBACK_NOTE).success).toBe(false)
    expect(closed.safeParse(REFERENCE_NOTE).success).toBe(true)
  })

  it('keeps them open by default (positive)', () => {
    const batch = createCandidateBatchSchema({ allowProject: false })
    expect(batch.safeParse({ notes: [USER_NOTE, FEEDBACK_NOTE] }).success).toBe(true)
  })
})
