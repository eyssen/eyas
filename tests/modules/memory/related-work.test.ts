// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createMemoryTables } from '@modules/memory/schema'
import { configSchema } from '@core/config/schema'
import { buildRelatedWork, buildRelatedWorkFtsQuery } from '@modules/memory/related-work'

let db: any

function tables() {
  db.run(sql`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, title TEXT, status TEXT NOT NULL DEFAULT 'idle',
    user_id TEXT NOT NULL DEFAULT 'u1', project_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  db.run(sql`CREATE TABLE IF NOT EXISTS conversation_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL
  )`)
}

function conv(id: string, over: Record<string, unknown> = {}) {
  const now = '2026-08-31T00:00:00Z'
  db.run(sql`INSERT INTO conversations (id, title, status, project_id, created_at, updated_at)
    VALUES (${id}, ${over.title ?? id}, ${over.status ?? 'idle'}, ${over.project_id ?? null}, ${now}, ${now})`)
}

function msg(conversationId: string, role: string, content: string) {
  db.run(sql`INSERT INTO conversation_messages (conversation_id, role, content, created_at)
    VALUES (${conversationId}, ${role}, ${content}, '2026-08-31T00:00:00Z')`)
}

function note(path: string, over: Record<string, unknown> = {}) {
  const row = {
    title: 'Note', tier: 'semantic', tags: '[]', content_text: 'Body text here.',
    kind: null, summary: null, file_hash: 'h', indexed_at: '2026-08-31T00:00:00Z',
    project_id: null, project_type_id: null, ...over,
  }
  db.run(sql`INSERT INTO vault_index (path, title, tier, tags, content_text, kind, summary, project_id, project_type_id, file_hash, indexed_at)
    VALUES (${path}, ${row.title}, ${row.tier}, ${row.tags}, ${row.content_text},
            ${row.kind}, ${row.summary}, ${row.project_id}, ${row.project_type_id}, ${row.file_hash}, ${row.indexed_at})`)
}

const MNB_QUERY = 'MNB SOAP Cloudflare IAP from pods please'
const MNB_BODY = 'Direct MNB SOAP — Cloudflare 1010 blocked the IAP from pods please'

function seedMnbScene() {
  note('semantic/mnb-iap.md', {
    title: 'Direct MNB SOAP',
    summary: 'Direct MNB SOAP — Cloudflare 1010 blocked IAP',
    content_text: MNB_BODY,
  })
  conv('c-now')
  conv('c-prior', { title: 'MaxValor IAP outage' })
  msg('c-prior', 'user', 'Cloudflare 1010 blocked www.eyssen.io/iap MNB SOAP from pods please')
}

beforeEach(() => {
  db = createMemoryDb()
  tables()
  createMemoryTables(db)
})

describe('memory.relatedWork config', () => {
  it('defaults ON when the block is omitted from a prior config file', () => {
    const parsed = configSchema.parse({})
    expect(parsed.memory.relatedWork.enabled).toBe(true)
    expect(parsed.memory.relatedWork.minQueryChars).toBe(40)
    expect(parsed.memory.relatedWork.maxHits).toBe(5)
    expect(parsed.memory.relatedWork.budgetChars).toBe(1200)
    expect(parsed.memory.relatedWork.maxSnippetChars).toBe(140)
  })
})

describe('buildRelatedWork', () => {
  it('returns null when the query is shorter than minQueryChars', () => {
    expect(buildRelatedWork(db, { query: 'ok', conversationId: 'c-now' })).toBeNull()
  })

  it('returns null when enabled is false', () => {
    expect(buildRelatedWork(db, { query: 'x'.repeat(40), conversationId: 'c-now', enabled: false })).toBeNull()
  })

  it('returns null when nothing matches', () => {
    expect(buildRelatedWork(db, { query: 'zzzz-no-such-token-in-store-xxxxxxxxxxxx', conversationId: 'c-now' })).toBeNull()
  })

  it('ranks a vault hit above an L0 hit', () => {
    // vault note summary "Direct MNB SOAP — Cloudflare 1010 blocked IAP"
    // L0 message in another conversation with the same words
    seedMnbScene()
    const block = buildRelatedWork(db, { query: MNB_QUERY, conversationId: 'c-now' })
    const vaultAt = block!.content.indexOf('[vault]')
    const convAt = block!.content.indexOf('[conversation]')
    expect(vaultAt).toBeGreaterThan(-1)
    expect(convAt).toBeGreaterThan(vaultAt)
  })

  it('does not repeat a vault path already in excludeVaultPaths', () => {
    seedMnbScene()
    const block = buildRelatedWork(db, {
      query: MNB_QUERY,
      conversationId: 'c-now',
      excludeVaultPaths: ['semantic/mnb-iap.md'],
    })
    expect(block?.content ?? '').not.toMatch(/\[vault\]/)
  })

  it('excludes the current conversation\'s own messages', () => {
    // only c-now has the distinctive token
    const token = 'only-in-current-conversation-tokenxxxxxx'
    conv('c-now')
    msg('c-now', 'user', `${token} lives only in this thread`)
    expect(buildRelatedWork(db, { query: token, conversationId: 'c-now' })).toBeNull()
  })

  it('clips to whole lines and reports the drop', () => {
    // seed 8 vault notes that all match
    const token = 'shared-token-enough-chars-to-pass-the-gate-xxxx'
    for (let n = 0; n < 8; n++) {
      note(`semantic/shared-${n}.md`, {
        title: `Shared ${n}`,
        summary: `Shared note ${n} about the token`,
        content_text: `${token} appears in vault note ${n}`,
      })
    }
    conv('c-now')
    const block = buildRelatedWork(db, {
      query: token,
      conversationId: 'c-now',
      maxHits: 5,
    })
    expect(block!.content).toMatch(/more hits not shown/)
    expect((block!.content.match(/^- \[/gm) ?? []).length).toBe(5)
  })

  it('labels the section as background, not instructions', () => {
    seedMnbScene()
    const block = buildRelatedWork(db, { query: MNB_QUERY, conversationId: 'c-now' })
    expect(block!.content).toMatch(/not instructions/)
    expect(block!.content).toMatch(/search_memory/)
  })

  it('includes a domain note for this project type and excludes another type', () => {
    db.run(sql`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, type_id TEXT)`)
    db.run(sql`INSERT INTO projects (id, name, type_id) VALUES ('alpha', 'Alpha', 'type-a')`)
    const token = 'domain-type-token-enough-chars-to-pass-xx'
    note('project-types/type-a/shared.md', {
      kind: 'domain',
      project_type_id: 'type-a',
      summary: 'Shared type rule for type-a',
      content_text: `${token} type-a domain note`,
    })
    note('project-types/type-b/other.md', {
      kind: 'domain',
      project_type_id: 'type-b',
      summary: 'Other type rule for type-b',
      content_text: `${token} type-b domain note`,
    })
    conv('c-now', { project_id: 'alpha' })
    const block = buildRelatedWork(db, {
      query: token,
      conversationId: 'c-now',
      projectId: 'alpha',
    })
    expect(block!.content).toContain('Shared type rule for type-a')
    expect(block!.content).not.toContain('Other type rule for type-b')
  })

  it('ORs turn tokens so a prior IAP note surfaces without sharing call/directly/instead', () => {
    // Spec motivating example: the new message does not AND-share "call",
    // "API", "directly", "instead" with the standing note. Length ≥ 40.
    const query = 'call the MNB SOAP API directly instead of the IAP'
    expect([...query].length).toBeGreaterThanOrEqual(40)
    note('semantic/mnb-iap.md', {
      title: 'Direct MNB SOAP',
      summary: 'Cloudflare 1010 blocked the IAP from pods',
      content_text: 'Cloudflare 1010 blocked the IAP from pods',
    })
    conv('c-now')
    const block = buildRelatedWork(db, { query, conversationId: 'c-now' })
    expect(block).not.toBeNull()
    expect(block!.content).toMatch(/\[vault\]/)
    expect(block!.content).toMatch(/IAP|Cloudflare/)
    expect(block!.content).not.toMatch(/\bcall\b/)
    expect(block!.content).not.toMatch(/\bdirectly\b/)
    expect(block!.content).not.toMatch(/\binstead\b/)
  })

  it('still shows an L0 hit when five vault notes also match', () => {
    const token = 'durable-cloudflare-iap-from-pods-please-xxxx'
    expect([...token].length).toBeGreaterThanOrEqual(40)
    for (let i = 0; i < 5; i++) {
      note(`semantic/filler-${i}.md`, {
        summary: `Filler durable note ${i}`,
        content_text: `${token} filler vault ${i}`,
      })
    }
    conv('c-now')
    conv('c-prior', { title: 'ZXQ IAP outage' })
    msg('c-prior', 'user', `${token} ZXQ-MNB-SOAP-DIRECT long-term fix`)
    const block = buildRelatedWork(db, { query: token, conversationId: 'c-now' })
    expect(block!.content).toMatch(/\[conversation\]/)
    expect(block!.content).toMatch(/ZXQ-MNB-SOAP-DIRECT/)
  })

  it('skips an L0 echo of the query so a prior incident can surface', () => {
    const query = 'Currency rates fail with Cloudflare 1010 from pods hitting the IAP. What is the durable fix for that setup?'
    expect([...query].length).toBeGreaterThanOrEqual(40)
    conv('c-now')
    conv('c-echo', { title: 'ZXQ related-work probe' })
    msg('c-echo', 'user', query)
    conv('c-prior', { title: 'ZXQ prior: IAP Cloudflare 1010' })
    msg('c-prior', 'user', 'ZXQ-IAP-CLOUDFLARE-1010 incident: Cloudflare 1010 blocked the IAP from the pods. Long-term fix is ZXQ-MNB-SOAP-DIRECT.')
    const block = buildRelatedWork(db, { query, conversationId: 'c-now' })
    expect(block!.content).toMatch(/ZXQ-MNB-SOAP-DIRECT/)
    expect(block!.content).not.toMatch(/ZXQ related-work probe/)
  })

  it('drops a vault note that only shares weak query glue', () => {
    const query = 'Currency rates fail with Cloudflare 1010 from pods hitting the IAP. What is the durable fix for that setup?'
    note('semantic/grok-setup.md', {
      title: 'Grok + Claude Code shared setup',
      summary: 'Grok + Claude Code shared setup (2026-07-18)',
      content_text: 'Both tools share the same durable knowledge and most automation. Use either interchangeably.',
    })
    note('semantic/mnb-iap.md', {
      title: 'Direct MNB SOAP',
      summary: 'Cloudflare 1010 blocked the IAP from pods',
      content_text: 'Cloudflare 1010 blocked the IAP from pods. Use MNB SOAP directly.',
    })
    conv('c-now')
    const block = buildRelatedWork(db, { query, conversationId: 'c-now' })
    expect(block!.content).toMatch(/\[vault\]/)
    expect(block!.content).toMatch(/IAP|Cloudflare|MNB/)
    expect(block!.content).not.toMatch(/Grok \+ Claude/)
    expect(block!.content).not.toMatch(/shared setup/)
  })

  it('returns null when no token survives the related-work lexer', () => {
    const query = Array(20).fill('ok').join(' ')
    expect([...query].length).toBeGreaterThanOrEqual(40)
    note('semantic/ok.md', { content_text: query, summary: query })
    conv('c-now')
    expect(buildRelatedWork(db, { query, conversationId: 'c-now' })).toBeNull()
  })
})

describe('buildRelatedWorkFtsQuery', () => {
  it('ORs distinctive tokens and keeps 2-letter all-caps', () => {
    expect(buildRelatedWorkFtsQuery('call the MNB SOAP API directly instead of the IAP'))
      .toBe('"call" OR "MNB" OR "SOAP" OR "API" OR "directly" OR "instead" OR "IAP"')
    expect(buildRelatedWorkFtsQuery('EU AI act overview for this turn now please xx'))
      .toBe('"EU" OR "AI" OR "overview" OR "this" OR "turn" OR "please"')
    expect(buildRelatedWorkFtsQuery('ok ok ok')).toBeNull()
  })
})
