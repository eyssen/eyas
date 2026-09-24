// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'
import { createDataPortService } from '@modules/data-port/service'
import {
  readWorkspaceFile,
  resolveDefaultAgentId,
  writeWorkspaceTarget,
} from '@modules/data-port/index'

const logger = { debug() {}, info() {}, warn() {}, error() {} }

let db: any
let dataDir: string
let files: Record<string, string>
let service: ReturnType<typeof createDataPortService>

function makeService(): ReturnType<typeof createDataPortService> {
  const created = createDataPortService({
    db,
    modelCtx: { logger } as any,
    applyDepsFactory: () => ({
      createProposal: (input) => created.createProposal(input),
      resolveDefaultAgentId: () => 'a1',
      readWorkspaceFile: (agentId, file) => files[`${agentId}/${file}`] ?? null,
    }),
    dataDir,
    logger,
  })
  return created
}

/** Writer/reader pair over the in-memory `files` map, standing in for the workspace on disk. */
const writer = {
  write: async (req: { agentId: string; file: string; body: string }) => {
    files[`${req.agentId}/${req.file}`] = req.body
  },
}
const reader = { read: (agentId: string, file: string) => files[`${agentId}/${file}`] ?? null }

function createProjectTypesTable(): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS project_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
  )`)
}

function createAgentDefinitionsTable(): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS agent_definitions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'specialist',
    enabled INTEGER NOT NULL DEFAULT 1,
    addressable INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`)
}

beforeEach(() => {
  db = createMemoryDb()
  createDataPortTables(db)
  dataDir = mkdtempSync(join(tmpdir(), 'eyas-proposals-'))
  files = {}
  service = makeService()
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

describe('approveProposal — append to the current file', () => {
  it('keeps both sections when two proposals over the same file are approved in turn', async () => {
    files['a1/AGENTS.md'] = 'seed rules'
    // Both rows carry the SAME stale snapshot: the second one was created before
    // the first was approved, which is exactly the case a snapshot-based append erases.
    const first = service.createProposal({
      jobId: 'job-1',
      agentId: 'a1',
      workspaceFile: 'AGENTS.md',
      title: 'Alpha rules (.alpha/AGENTS.md)',
      proposedBody: 'first body',
      existingBody: 'seed rules',
    })
    const second = service.createProposal({
      jobId: 'job-1',
      agentId: 'a1',
      workspaceFile: 'AGENTS.md',
      title: 'Beta rules (.beta/RULES.md)',
      proposedBody: 'second body',
      existingBody: 'seed rules',
    })

    await service.approveProposal(first, writer, reader)
    await service.approveProposal(second, writer, reader)

    const out = files['a1/AGENTS.md']
    expect(out.startsWith('seed rules')).toBe(true)
    expect(out).toContain(
      `<!-- eyas-import:${first} -->\n## Imported: Alpha rules (.alpha/AGENTS.md)\n\nfirst body\n<!-- /eyas-import:${first} -->`,
    )
    expect(out).toContain(
      `<!-- eyas-import:${second} -->\n## Imported: Beta rules (.beta/RULES.md)\n\nsecond body\n<!-- /eyas-import:${second} -->`,
    )
    // The seed survived once, not once per approval.
    expect(out.split('seed rules').length - 1).toBe(1)
    expect(out.indexOf('first body')).toBeLessThan(out.indexOf('second body'))
  })

  it('prefers the reader over the stale snapshot stored on the row', async () => {
    files['a1/AGENTS.md'] = 'edited by hand'
    const id = service.createProposal({
      jobId: 'job-1',
      agentId: 'a1',
      workspaceFile: 'AGENTS.md',
      title: 'Alpha rules (.alpha/AGENTS.md)',
      proposedBody: 'body',
      existingBody: 'stale snapshot',
    })

    await service.approveProposal(id, writer, reader)

    const out = files['a1/AGENTS.md']
    expect(out.startsWith('edited by hand')).toBe(true)
    expect(out).not.toContain('stale snapshot')
  })

  it('falls back to the stored snapshot when no reader is given', async () => {
    const id = service.createProposal({
      jobId: 'job-1',
      agentId: 'a1',
      workspaceFile: 'AGENTS.md',
      title: 'Alpha rules (.alpha/AGENTS.md)',
      proposedBody: 'body',
      existingBody: 'stored snapshot',
    })

    await service.approveProposal(id, writer)

    expect(files['a1/AGENTS.md'].startsWith('stored snapshot\n\n---\n\n')).toBe(true)
  })

  it('writes no leading separator when the current file is empty', async () => {
    const id = service.createProposal({
      jobId: 'job-1',
      agentId: 'a1',
      workspaceFile: 'AGENTS.md',
      title: 'Alpha rules (.alpha/AGENTS.md)',
      proposedBody: 'body',
      existingBody: null,
    })

    await service.approveProposal(id, writer, reader)

    const out = files['a1/AGENTS.md']
    expect(out.startsWith(`<!-- eyas-import:${id} -->\n## Imported:`)).toBe(true)
    expect(out).not.toContain('---\n\n<!-- eyas-import:')
    expect(out.endsWith(`<!-- /eyas-import:${id} -->\n`)).toBe(true)
  })

  it('treats a whitespace-only current file as empty', async () => {
    files['a1/AGENTS.md'] = '\n  \n'
    const id = service.createProposal({
      jobId: 'job-1',
      agentId: 'a1',
      workspaceFile: 'AGENTS.md',
      title: 'Alpha rules (.alpha/AGENTS.md)',
      proposedBody: 'body',
      existingBody: null,
    })

    await service.approveProposal(id, writer, reader)

    expect(files['a1/AGENTS.md'].startsWith('<!-- eyas-import:')).toBe(true)
  })

  it('treats a file holding nothing but the writer\'s own header as empty', async () => {
    // M13 — a bootstrapped workspace file is all generated frontmatter and no
    // owner text. Separating the section from it would leave a bare `---` at the
    // top of the body once the writer regenerates the header, and a rollback
    // would have nothing to attach that separator to.
    files['a1/AGENTS.md'] =
      '---\nschema: workspace/v1\nagentId: a1\ngeneratedAt: 2026-09-05T10:00:00Z\n---\n\n'
    const id = service.createProposal({
      jobId: 'job-1',
      agentId: 'a1',
      workspaceFile: 'AGENTS.md',
      title: 'Alpha rules (.alpha/AGENTS.md)',
      proposedBody: 'body',
      existingBody: null,
    })

    await service.approveProposal(id, writer, reader)

    const out = files['a1/AGENTS.md']
    expect(out.startsWith(`<!-- eyas-import:${id} -->\n## Imported:`)).toBe(true)
    expect(out).not.toContain('---\n\n<!-- eyas-import:')
  })

  it('still separates the section from text the owner wrote under that header', async () => {
    files['a1/AGENTS.md'] =
      '---\nschema: workspace/v1\nagentId: a1\ngeneratedAt: 2026-09-05T10:00:00Z\n---\n\nOwner prose.\n'
    const id = service.createProposal({
      jobId: 'job-1',
      agentId: 'a1',
      workspaceFile: 'AGENTS.md',
      title: 'Alpha rules (.alpha/AGENTS.md)',
      proposedBody: 'body',
      existingBody: null,
    })

    await service.approveProposal(id, writer, reader)

    const out = files['a1/AGENTS.md']
    expect(out).toContain('Owner prose.')
    expect(out).toContain(`\n\n---\n\n<!-- eyas-import:${id} -->`)
  })

  it('refuses to approve twice', async () => {
    const id = service.createProposal({
      jobId: 'job-1',
      agentId: 'a1',
      workspaceFile: 'AGENTS.md',
      title: 'Alpha rules (.alpha/AGENTS.md)',
      proposedBody: 'body',
      existingBody: null,
    })
    await service.approveProposal(id, writer, reader)
    await expect(service.approveProposal(id, writer, reader)).rejects.toThrow(/already approved/)
  })
})

describe('project-type prompt as a workspace target', () => {
  beforeEach(() => {
    createProjectTypesTable()
    db.run(
      sql`INSERT INTO project_types (id, name, prompt, created_at) VALUES ('general', 'General', 'type prompt', '2026-01-01T00:00:00.000Z')`,
    )
  })

  it('reads the prompt column for a project-type file id', () => {
    expect(readWorkspaceFile(db, dataDir, '-', 'project-type:general')).toBe('type prompt')
    expect(readWorkspaceFile(db, dataDir, '-', 'project-type:missing')).toBeNull()
  })

  it('writes the prompt column instead of the agent workspace', async () => {
    let delegated = 0
    const base = { write: async () => { delegated += 1 } }

    await writeWorkspaceTarget(db, base, {
      agentId: '-',
      file: 'project-type:general',
      body: 'new prompt',
    })

    expect(delegated).toBe(0)
    const rows = db.all(sql`SELECT prompt FROM project_types WHERE id = 'general'`) as any[]
    expect(rows[0].prompt).toBe('new prompt')
  })

  it('delegates every other file to the workspace writer', async () => {
    const seen: Array<{ agentId: string; file: string; body: string }> = []
    const base = { write: async (req: any) => { seen.push(req) } }

    await writeWorkspaceTarget(db, base, { agentId: 'a1', file: 'AGENTS.md', body: 'body' })

    expect(seen).toEqual([{ agentId: 'a1', file: 'AGENTS.md', body: 'body' }])
    const rows = db.all(sql`SELECT prompt FROM project_types WHERE id = 'general'`) as any[]
    expect(rows[0].prompt).toBe('type prompt')
  })

  it('appends to the type prompt end to end when the proposal is approved', async () => {
    const id = service.createProposal({
      jobId: 'job-1',
      agentId: '-',
      workspaceFile: 'project-type:general',
      title: 'Alpha rules (RULES.md)',
      proposedBody: 'imported rules',
      existingBody: 'type prompt',
    })

    await service.approveProposal(
      id,
      { write: (req) => writeWorkspaceTarget(db, { write: async () => {} }, req) },
      { read: (agentId, file) => readWorkspaceFile(db, dataDir, agentId, file) },
    )

    const rows = db.all(sql`SELECT prompt FROM project_types WHERE id = 'general'`) as any[]
    expect(rows[0].prompt).toBe(
      `type prompt\n\n---\n\n<!-- eyas-import:${id} -->\n## Imported: Alpha rules (RULES.md)\n\nimported rules\n<!-- /eyas-import:${id} -->\n`,
    )
  })
})

describe('resolveDefaultAgentId', () => {
  beforeEach(() => {
    createAgentDefinitionsTable()
  })

  it('picks the oldest enabled primary agent over an alphabetically earlier addressable one', () => {
    db.run(sql`INSERT INTO agent_definitions (id, name, tier, enabled, addressable, created_at)
      VALUES ('addressable-1', 'Aardvark', 'specialist', 1, 1, '2026-01-01T00:00:00.000Z')`)
    db.run(sql`INSERT INTO agent_definitions (id, name, tier, enabled, addressable, created_at)
      VALUES ('primary-2', 'Yankee', 'primary', 1, 0, '2026-03-01T00:00:00.000Z')`)
    db.run(sql`INSERT INTO agent_definitions (id, name, tier, enabled, addressable, created_at)
      VALUES ('primary-1', 'Zulu', 'primary', 1, 0, '2026-02-01T00:00:00.000Z')`)

    expect(resolveDefaultAgentId(db)).toBe('primary-1')
  })

  it('ignores a disabled primary agent', () => {
    db.run(sql`INSERT INTO agent_definitions (id, name, tier, enabled, addressable, created_at)
      VALUES ('primary-1', 'Zulu', 'primary', 0, 0, '2026-01-01T00:00:00.000Z')`)
    db.run(sql`INSERT INTO agent_definitions (id, name, tier, enabled, addressable, created_at)
      VALUES ('addressable-1', 'Aardvark', 'specialist', 1, 1, '2026-02-01T00:00:00.000Z')`)

    expect(resolveDefaultAgentId(db)).toBe('addressable-1')
  })

  it('falls back to any enabled agent by name', () => {
    db.run(sql`INSERT INTO agent_definitions (id, name, tier, enabled, addressable, created_at)
      VALUES ('plain-2', 'Bravo', 'specialist', 1, 0, '2026-01-01T00:00:00.000Z')`)
    db.run(sql`INSERT INTO agent_definitions (id, name, tier, enabled, addressable, created_at)
      VALUES ('plain-1', 'Alpha', 'specialist', 1, 0, '2026-02-01T00:00:00.000Z')`)

    expect(resolveDefaultAgentId(db)).toBe('plain-1')
  })

  it('returns null when nothing is enabled and when the table is absent', () => {
    db.run(sql`INSERT INTO agent_definitions (id, name, tier, enabled, addressable, created_at)
      VALUES ('plain-1', 'Alpha', 'specialist', 0, 0, '2026-01-01T00:00:00.000Z')`)
    expect(resolveDefaultAgentId(db)).toBeNull()

    const bare = createMemoryDb()
    expect(resolveDefaultAgentId(bare)).toBeNull()
  })
})
