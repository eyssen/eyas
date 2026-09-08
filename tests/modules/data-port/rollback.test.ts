// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'
import { deleteAppliedRows, listApplied, recordApplied } from '@modules/data-port/ledger'
import { rollbackJob, stripImportedSection, type RollbackDeps } from '@modules/data-port/rollback'
import { contentSha } from '@modules/data-port/pipeline/apply'
import { legacyBody } from '@modules/data-port/source-frontmatter'

/** Synthetic data root; nothing on disk is touched — the guard is a string check. */
const DATA_DIR = '/srv/eyas-test/data'
const ASSET_DIR = `${DATA_DIR}/skills/imported/alpha-deploy-ab12cd34`

let db: any

/** The slice of the memory schema rollback consults (A15.5). */
function createVaultIndexTable(): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS vault_index (
    path TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    tier TEXT NOT NULL DEFAULT 'semantic',
    tags TEXT,
    content_text TEXT NOT NULL DEFAULT '',
    file_hash TEXT NOT NULL DEFAULT '',
    indexed_at TEXT NOT NULL DEFAULT ''
  )`)
}

function indexVaultNote(path: string, tags: string[]): void {
  db.run(sql`INSERT INTO vault_index (path, tags) VALUES (${path}, ${JSON.stringify(tags)})`)
}

function insertJob(id: string, status: string, stats = '{}'): void {
  db.run(sql`INSERT INTO data_port_jobs
    (id, status, source_profile, scan_id, selection_json, phase, progress, stats_json, created_at, updated_at)
    VALUES (${id}, ${status}, 'claude-code', 's', '[]', 'done', 1, ${stats}, 't', 't')`)
}

function insertProposal(input: {
  id: string
  jobId?: string
  agentId?: string
  file?: string
  title: string
  status: string
}): void {
  db.run(sql`INSERT INTO data_port_proposals
    (id, job_id, agent_id, workspace_file, title, proposed_body, existing_body, status, created_at)
    VALUES (${input.id}, ${input.jobId ?? 'j'}, ${input.agentId ?? 'a1'}, ${input.file ?? 'AGENTS.md'},
            ${input.title}, 'R', 'seed', ${input.status}, 't')`)
}

function jobRow(id = 'j'): any {
  return (db.all(sql`SELECT * FROM data_port_jobs WHERE id = ${id}`) as any[])[0]
}

/** `kind:ref` of every ledger row still standing for the job. */
function ledgerRows(jobId = 'j'): string[] {
  return (db.all(sql`SELECT kind, ref FROM data_port_applied WHERE job_id = ${jobId}`) as any[])
    .map((r) => `${r.kind}:${r.ref}`)
    .sort()
}

/** Deps over in-memory stand-ins; every destructive call is recorded in `deleted`. */
function makeDeps(overrides: Partial<RollbackDeps> = {}): {
  deps: RollbackDeps
  deleted: string[]
  files: Record<string, string>
  reindexed: string[]
} {
  const deleted: string[] = []
  const reindexed: string[] = []
  const files: Record<string, string> = {}
  const deps: RollbackDeps = {
    db,
    dataDir: DATA_DIR,
    vault: { delete: (p) => deleted.push(`vault:${p}`) },
    indexer: {
      indexAll: () => {
        reindexed.push('indexAll')
        return 0
      },
      removeStale: () => reindexed.push('removeStale'),
    },
    episodic: { delete: (id) => deleted.push(`ep:${id}`) },
    skills: {
      delete: (id) => deleted.push(`skill:${id}`),
      get: (id) => ({ id, name: 'alpha-deploy', source: 'user' }),
    },
    agents: {
      delete: (id) => deleted.push(`agent:${id}`),
      get: (id) => ({ id, name: 'Bravo', source: 'user' }),
    },
    removeAssetDir: (dir) => {
      deleted.push(`assets:${dir}`)
      return true
    },
    readWorkspaceFile: (a, f) => files[`${a}/${f}`] ?? null,
    writeWorkspaceFile: async (a, f, body) => {
      files[`${a}/${f}`] = body
    },
    ...overrides,
  }
  return { deps, deleted, files, reindexed }
}

beforeEach(() => {
  db = createMemoryDb()
  createDataPortTables(db)
  createVaultIndexTable()
})

describe('stripImportedSection', () => {
  it('removes the marker-bracketed block and the separator that introduced it', () => {
    const body =
      'seed\n\n---\n\n' +
      '<!-- eyas-import:p1 -->\n## Imported: Rules (alpha.md)\n\nR\n<!-- /eyas-import:p1 -->\n\n---\n\n' +
      '<!-- eyas-import:p3 -->\n## Imported: Later (bravo.md)\n\nL\n<!-- /eyas-import:p3 -->\n'

    expect(stripImportedSection(body, 'p1', 'Rules (alpha.md)')).toBe(
      'seed\n\n---\n\n<!-- eyas-import:p3 -->\n## Imported: Later (bravo.md)\n\nL\n<!-- /eyas-import:p3 -->\n',
    )
  })

  it('takes the trailing separator when the block it removes is the first one', () => {
    const body =
      '<!-- eyas-import:p1 -->\n## Imported: A\n\nR\n<!-- /eyas-import:p1 -->\n\n---\n\n' +
      '<!-- eyas-import:p2 -->\n## Imported: B\n\nL\n<!-- /eyas-import:p2 -->\n'

    expect(stripImportedSection(body, 'p1', 'A')).toBe(
      '<!-- eyas-import:p2 -->\n## Imported: B\n\nL\n<!-- /eyas-import:p2 -->\n',
    )
  })

  it('leaves the file empty when the only block is removed', () => {
    const body = '<!-- eyas-import:p1 -->\n## Imported: A\n\nR\n<!-- /eyas-import:p1 -->\n'
    expect(stripImportedSection(body, 'p1', 'A')).toBe('')
  })

  it('falls back to the title heading for a marker-less section', () => {
    const body = 'seed\n\n---\n\n## Imported: Rules (alpha.md)\n\nR\n\n---\n\n## Imported: Later (bravo.md)\n\nL\n'
    expect(stripImportedSection(body, 'p1', 'Rules (alpha.md)')).toBe(
      'seed\n\n---\n\n## Imported: Later (bravo.md)\n\nL\n',
    )
  })

  it('leaves a body that holds neither the markers nor the title untouched', () => {
    const body = 'hand written rules\n'
    expect(stripImportedSection(body, 'p1', 'Rules (alpha.md)')).toBe(body)
  })

  it('does not treat a title as a regular expression', () => {
    // Unescaped, `a.c` would match the heading `abc` and cut a section that is
    // not the one being rolled back.
    const body = 'seed\n\n---\n\n## Imported: abc\n\nR\n'
    expect(stripImportedSection(body, 'p1', 'a.c')).toBe(body)
  })

  it('matches the heading only on a line of its own', () => {
    const body = 'seed\n\n---\n\nsee also ## Imported: A for context\n'
    expect(stripImportedSection(body, 'p1', 'A')).toBe(body)
  })

  // I2 — the fallback must never reach into another proposal's marked block.
  it('leaves a heading quoted inside another block alone and takes the real section', () => {
    const body =
      '<!-- eyas-import:p1 -->\n## Imported: A\n\nquoting: ## Imported: B\n<!-- /eyas-import:p1 -->\n\n---\n\n' +
      '## Imported: B\n\nreal B\n'

    expect(stripImportedSection(body, 'pX', 'B')).toBe(
      '<!-- eyas-import:p1 -->\n## Imported: A\n\nquoting: ## Imported: B\n<!-- /eyas-import:p1 -->',
    )
  })

  it('skips a heading that sits at a line start inside another block', () => {
    const body =
      '<!-- eyas-import:p1 -->\n## Imported: A\n\n## Imported: B\n<!-- /eyas-import:p1 -->\n\n---\n\n' +
      '## Imported: B\n\nreal B\n'

    expect(stripImportedSection(body, 'pX', 'B')).toBe(
      '<!-- eyas-import:p1 -->\n## Imported: A\n\n## Imported: B\n<!-- /eyas-import:p1 -->',
    )
  })

  // N1 — the owner's own writing after a separator must survive. A marker-less
  // section is bounded by the first separator, even at the cost of leaving part
  // of the import behind.
  it('stops at the first separator rather than eating what the owner wrote after it', () => {
    const body = 'seed\n\n---\n\n## Imported: A\n\nR\n\n---\n\nmy own hand-written notes\n'
    expect(stripImportedSection(body, 'p1', 'A')).toBe('seed\n\n---\n\nmy own hand-written notes\n')
  })

  it('removes a marker-less section only up to its own horizontal rule, and says so', () => {
    const issues: string[] = []
    const body = 'seed\n\n---\n\n## Imported: A\n\nline1\n\n---\n\nline2 still mine\n'

    expect(stripImportedSection(body, 'p1', 'A', (issue) => issues.push(issue))).toBe(
      'seed\n\n---\n\nline2 still mine\n',
    )
    expect(issues).toEqual(['markers missing — section may be partially removed: A'])
  })

  it('ends a marker-less section at the next section when no separator divides them', () => {
    const body = '## Imported: A\n\nR\n## Imported: B\n\nS\n'
    expect(stripImportedSection(body, 'p1', 'A')).toBe('## Imported: B\n\nS\n')
  })

  // P1 — the cut must not glue the two sides into one line, or the heading that
  // survives is no longer at a line start and can never be matched again.
  it('keeps the next heading on a line of its own when the cut would join them', () => {
    const body = 'seed\n\n---\n\n## Imported: A\n\nR\n## Imported: B\n\nS\n'

    const once = stripImportedSection(body, 'p1', 'A')
    expect(once).toBe('seed\n\n---\n\n## Imported: B\n\nS\n')
    // Still removable: the heading is where the matcher can see it.
    expect(stripImportedSection(once, 'p2', 'B')).toBe('seed')
  })

  it('restores the separator when a marked block follows without one', () => {
    const body =
      'seed\n\n---\n\n<!-- eyas-import:p1 -->\n## Imported: A\n\nR\n<!-- /eyas-import:p1 -->\n' +
      '<!-- eyas-import:p2 -->\n## Imported: B\n\nS\n<!-- /eyas-import:p2 -->\n'

    const once = stripImportedSection(body, 'p1')
    expect(once).toBe(
      'seed\n\n---\n\n<!-- eyas-import:p2 -->\n## Imported: B\n\nS\n<!-- /eyas-import:p2 -->\n',
    )
    expect(stripImportedSection(once, 'p2')).toBe('seed')
  })

  it('gives plain text its line break back rather than a separator', () => {
    const body =
      'seed\n\n---\n\n<!-- eyas-import:p1 -->\n## Imported: A\n\nR\n<!-- /eyas-import:p1 -->\n' +
      'the owner appended this\n'

    // The owner's line is not a section, so it is not promoted to one — it just
    // keeps the line of its own that it had.
    expect(stripImportedSection(body, 'p1')).toBe('seed\nthe owner appended this\n')
  })

  // M1 — an open marker whose close marker was edited away.
  it('stops at the next section when the closing marker is missing, and says so', () => {
    const issues: string[] = []
    const body =
      'seed\n\n---\n\n<!-- eyas-import:p1 -->\n## Imported: A\n\nR\n\n---\n\n' +
      '<!-- eyas-import:p2 -->\n## Imported: B\n\nS\n<!-- /eyas-import:p2 -->\n'

    expect(stripImportedSection(body, 'p1', 'A', (issue) => issues.push(issue))).toBe(
      'seed\n\n---\n\n<!-- eyas-import:p2 -->\n## Imported: B\n\nS\n<!-- /eyas-import:p2 -->\n',
    )
    expect(issues).toEqual(['unclosed import marker; removed to the end of its section'])
  })
})

describe('rollbackJob', () => {
  it('removes every recorded item, strips the approved section, rejects the pending one', async () => {
    insertJob('j', 'completed', JSON.stringify({ applied: 6 }))
    insertProposal({ id: 'p1', title: 'Rules (alpha.md)', status: 'approved' })
    insertProposal({ id: 'p2', title: 'Other (bravo.md)', status: 'pending' })
    // An approved section from a different job that must survive untouched.
    insertProposal({ id: 'p3', jobId: 'other', title: 'Later (charlie.md)', status: 'approved' })
    indexVaultNote('semantic/alpha.md', ['imported', 'import-job:j'])
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/alpha.md' })
    recordApplied(db, { jobId: 'j', kind: 'episodic', ref: 'e1' })
    recordApplied(db, { jobId: 'j', kind: 'skill', ref: 'sk1' })
    recordApplied(db, { jobId: 'j', kind: 'skill-assets', ref: ASSET_DIR })
    recordApplied(db, { jobId: 'j', kind: 'agent', ref: 'bravo' })
    recordApplied(db, { jobId: 'j', kind: 'proposal', ref: 'p1' })

    const { deps, deleted, files, reindexed } = makeDeps()
    files['a1/AGENTS.md'] =
      'seed\n\n---\n\n' +
      '<!-- eyas-import:p1 -->\n## Imported: Rules (alpha.md)\n\nR\n<!-- /eyas-import:p1 -->\n\n---\n\n' +
      '<!-- eyas-import:p3 -->\n## Imported: Later (charlie.md)\n\nL\n<!-- /eyas-import:p3 -->\n'

    const result = await rollbackJob(deps, 'j')

    expect(deleted.sort()).toEqual([
      `assets:${ASSET_DIR}`,
      'agent:bravo',
      'ep:e1',
      'skill:sk1',
      'vault:semantic/alpha.md',
    ].sort())
    expect(files['a1/AGENTS.md']).toBe(
      'seed\n\n---\n\n<!-- eyas-import:p3 -->\n## Imported: Later (charlie.md)\n\nL\n<!-- /eyas-import:p3 -->\n',
    )
    expect(result.removed).toMatchObject({
      vault: 1,
      episodic: 1,
      skill: 1,
      'skill-assets': 1,
      agent: 1,
      proposal: 1,
    })
    expect(result.skipped).toEqual([])
    // The index is rebuilt once, after everything is gone from disk.
    expect(reindexed).toEqual(['removeStale', 'indexAll'])

    const statuses = Object.fromEntries(
      (db.all(sql`SELECT id, status FROM data_port_proposals`) as any[]).map((r) => [r.id, r.status]),
    )
    expect(statuses).toEqual({ p1: 'rejected', p2: 'rejected', p3: 'approved' })
    expect(jobRow().status).toBe('rolled_back')
    expect(jobRow().phase).toBe('rolled_back')
    expect((db.all(sql`SELECT count(*) AS n FROM data_port_applied WHERE job_id = 'j'`) as any[])[0].n).toBe(0)
  })

  it('refuses a job that is still running', async () => {
    db.run(sql`INSERT INTO data_port_jobs
      (id, status, source_profile, scan_id, selection_json, phase, progress, stats_json, created_at, updated_at)
      VALUES ('j', 'running', 'claude-code', 's', '[]', 'apply', 0.5, '{}', 't', 't')`)

    await expect(
      rollbackJob(
        { db, removeAssetDir: () => true, readWorkspaceFile: () => null, writeWorkspaceFile: async () => {} },
        'j',
      ),
    ).rejects.toThrow(/running/)
  })

  it('refuses a job it cannot find', async () => {
    await expect(
      rollbackJob(
        { db, removeAssetDir: () => true, readWorkspaceFile: () => null, writeWorkspaceFile: async () => {} },
        'missing',
      ),
    ).rejects.toThrow(/not found/)
  })

  // A15.4 — the result is written into the job it undid.
  it('folds the result into the job stats and keeps what was already there', async () => {
    insertJob('j', 'completed', JSON.stringify({ applied: 2, byKind: { memory: 2 } }))
    indexVaultNote('semantic/alpha.md', ['import-job:j'])
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/alpha.md' })

    const { deps } = makeDeps()
    const result = await rollbackJob(deps, 'j')

    const stats = JSON.parse(jobRow().stats_json)
    expect(stats.applied).toBe(2)
    expect(stats.byKind).toEqual({ memory: 2 })
    expect(stats.rollback).toEqual(result)
  })

  // A15.1 — provenance decides; a shipped skill or a seed agent is never deleted.
  it('skips a skill and an agent that are not user-owned', async () => {
    insertJob('j', 'completed')
    recordApplied(db, { jobId: 'j', kind: 'skill', ref: 'sk-bundled' })
    recordApplied(db, { jobId: 'j', kind: 'agent', ref: 'seed-agent' })

    const { deps, deleted } = makeDeps({
      skills: { delete: (id) => deleted.push(`skill:${id}`), get: (id) => ({ id, name: 'n', source: 'bundled' }) },
      agents: { delete: (id) => deleted.push(`agent:${id}`), get: (id) => ({ id, name: 'n', source: 'seed' }) },
    })
    const result = await rollbackJob(deps, 'j')

    expect(deleted).toEqual([])
    expect(result.removed.skill).toBe(0)
    expect(result.removed.agent).toBe(0)
    expect(result.skipped).toEqual([
      'skill:sk-bundled (not user-owned)',
      'agent:seed-agent (not user-owned)',
    ])
  })

  it('skips a skill and an agent that are already gone', async () => {
    insertJob('j', 'completed')
    recordApplied(db, { jobId: 'j', kind: 'skill', ref: 'sk1' })
    recordApplied(db, { jobId: 'j', kind: 'agent', ref: 'bravo' })

    const { deps, deleted } = makeDeps({
      skills: { delete: (id) => deleted.push(`skill:${id}`), get: () => null },
      agents: { delete: (id) => deleted.push(`agent:${id}`), get: () => null },
    })
    const result = await rollbackJob(deps, 'j')

    expect(deleted).toEqual([])
    expect(result.skipped).toEqual(['skill:sk1 (already gone)', 'agent:bravo (already gone)'])
  })

  // A15.2 — an asset directory outside the imported root is never removed.
  it('refuses an asset directory outside the imported skills root', async () => {
    insertJob('j', 'completed')
    recordApplied(db, { jobId: 'j', kind: 'skill-assets', ref: `${DATA_DIR}/../elsewhere/alpha` })
    recordApplied(db, { jobId: 'j', kind: 'skill-assets', ref: `${DATA_DIR}/skills/imported` })

    const { deps, deleted } = makeDeps()
    const result = await rollbackJob(deps, 'j')

    expect(deleted).toEqual([])
    expect(result.removed['skill-assets']).toBe(0)
    expect(result.skipped).toHaveLength(2)
    expect(result.skipped.every((s) => s.includes('outside the imported skills directory'))).toBe(true)
  })

  it('cannot check an asset directory without a data dir, so it removes nothing', async () => {
    insertJob('j', 'completed')
    recordApplied(db, { jobId: 'j', kind: 'skill-assets', ref: ASSET_DIR })

    const { deps, deleted } = makeDeps({ dataDir: undefined })
    const result = await rollbackJob(deps, 'j')

    expect(deleted).toEqual([])
    expect(result.skipped).toEqual([`skill-assets:${ASSET_DIR} (data directory unknown)`])
  })

  // A15.5 — a note the index no longer attributes to this job stays on disk.
  it('keeps a vault note whose index row lost the job tag', async () => {
    insertJob('j', 'completed')
    indexVaultNote('semantic/alpha.md', ['imported', 'import-job:other'])
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/alpha.md' })
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/bravo.md' })

    const { deps, deleted, reindexed } = makeDeps()
    const result = await rollbackJob(deps, 'j')

    expect(deleted).toEqual([])
    expect(result.removed.vault).toBe(0)
    expect(result.skipped).toEqual([
      'vault:semantic/alpha.md (modified since import)',
      'vault:semantic/bravo.md (modified since import)',
    ])
    // Nothing left the vault, so there is nothing to re-index.
    expect(reindexed).toEqual([])
  })

  it('records a missing service instead of pretending the item is gone', async () => {
    insertJob('j', 'completed')
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/alpha.md' })
    recordApplied(db, { jobId: 'j', kind: 'episodic', ref: 'e1' })

    const { deps } = makeDeps({ vault: undefined, episodic: undefined })
    const result = await rollbackJob(deps, 'j')

    expect(result.skipped).toEqual([
      'vault:semantic/alpha.md (memory vault unavailable)',
      'episodic:e1 (episodic memory unavailable)',
    ])
  })

  // A15.7 — `-` is the project-type sentinel; the prompt is reverted like any other target.
  it('reverts a project-type prompt through the workspace writer', async () => {
    insertJob('j', 'completed')
    insertProposal({
      id: 'p1',
      agentId: '-',
      file: 'project-type:general',
      title: 'Rules (alpha.md)',
      status: 'approved',
    })
    recordApplied(db, { jobId: 'j', kind: 'proposal', ref: 'p1' })

    const { deps, files } = makeDeps()
    files['-/project-type:general'] =
      'type prompt\n\n---\n\n<!-- eyas-import:p1 -->\n## Imported: Rules (alpha.md)\n\nR\n<!-- /eyas-import:p1 -->\n'

    const result = await rollbackJob(deps, 'j')

    expect(files['-/project-type:general']).toBe('type prompt')
    expect(result.removed.proposal).toBe(1)
  })

  it('still rejects an approved proposal whose workspace file has gone', async () => {
    insertJob('j', 'completed')
    insertProposal({ id: 'p1', title: 'Rules (alpha.md)', status: 'approved' })
    recordApplied(db, { jobId: 'j', kind: 'proposal', ref: 'p1' })

    const { deps } = makeDeps()
    const result = await rollbackJob(deps, 'j')

    expect(result.removed.proposal).toBe(1)
    expect((db.all(sql`SELECT status FROM data_port_proposals WHERE id = 'p1'`) as any[])[0].status).toBe('rejected')
  })

  // I1 — a second pass would find an empty ledger and overwrite the record of
  // the first, which is the only place the refused items are still named.
  it('refuses a second rollback and keeps the ledger rows of what it refused', async () => {
    insertJob('j', 'completed', JSON.stringify({ applied: 2 }))
    indexVaultNote('semantic/alpha.md', ['import-job:j'])
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/alpha.md' })
    recordApplied(db, { jobId: 'j', kind: 'skill', ref: 'sk-bundled' })

    const { deps, deleted } = makeDeps({
      skills: {
        delete: (id) => deleted.push(`skill:${id}`),
        get: (id) => ({ id, name: 'n', source: 'bundled' }),
      },
    })
    const first = await rollbackJob(deps, 'j')

    expect(first.removed.vault).toBe(1)
    expect(first.skipped).toEqual(['skill:sk-bundled (not user-owned)'])
    // The deleted note's row is gone; the surviving skill still points at its import.
    expect(ledgerRows()).toEqual(['skill:sk-bundled'])

    await expect(rollbackJob(deps, 'j')).rejects.toThrow(/already rolled back/)
    expect(JSON.parse(jobRow().stats_json).rollback).toEqual(first)
  })

  // M3 — a ledger row may only ever speak for a proposal of its own import.
  it("ignores a ledger row naming another job's proposal", async () => {
    insertJob('j', 'completed')
    insertJob('other', 'completed')
    insertProposal({ id: 'p9', jobId: 'other', title: 'Rules (alpha.md)', status: 'approved' })
    recordApplied(db, { jobId: 'j', kind: 'proposal', ref: 'p9' })

    const { deps, files } = makeDeps()
    const untouched =
      'seed\n\n---\n\n<!-- eyas-import:p9 -->\n## Imported: Rules (alpha.md)\n\nR\n<!-- /eyas-import:p9 -->\n'
    files['a1/AGENTS.md'] = untouched

    const result = await rollbackJob(deps, 'j')

    expect(result.removed.proposal).toBe(0)
    expect(result.skipped).toEqual(['proposal:p9 (already gone)'])
    expect(files['a1/AGENTS.md']).toBe(untouched)
    expect((db.all(sql`SELECT status FROM data_port_proposals WHERE id = 'p9'`) as any[])[0].status).toBe(
      'approved',
    )
  })

  // M4 — the ledger ref is POSIX; a vault index written on Windows is not.
  it('matches a vault index row stored with Windows separators', async () => {
    insertJob('j', 'completed')
    indexVaultNote('semantic\\alpha.md', ['import-job:j'])
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/alpha.md' })

    const { deps, deleted } = makeDeps()
    const result = await rollbackJob(deps, 'j')

    expect(deleted).toEqual(['vault:semantic/alpha.md'])
    expect(result.removed.vault).toBe(1)
  })

  // M6 — a directory that is already gone was not removed by this rollback.
  it('reports an asset directory that was already gone instead of counting it', async () => {
    insertJob('j', 'completed')
    recordApplied(db, { jobId: 'j', kind: 'skill-assets', ref: ASSET_DIR })

    const { deps } = makeDeps({ removeAssetDir: () => false })
    const result = await rollbackJob(deps, 'j')

    expect(result.removed['skill-assets']).toBe(0)
    expect(result.skipped).toEqual([`skill-assets:${ASSET_DIR} (already removed: ${ASSET_DIR})`])
    // Nothing is left for the row to point at, so it goes with the rest.
    expect(ledgerRows()).toEqual([])
  })

  // M1, end to end — the malformed block is reported on the result.
  it('reports a proposal whose closing marker was edited away', async () => {
    insertJob('j', 'completed')
    insertProposal({ id: 'p1', title: 'Rules (alpha.md)', status: 'approved' })
    recordApplied(db, { jobId: 'j', kind: 'proposal', ref: 'p1' })

    const { deps, files } = makeDeps()
    files['a1/AGENTS.md'] =
      'seed\n\n---\n\n<!-- eyas-import:p1 -->\n## Imported: Rules (alpha.md)\n\nR\n\n---\n\n' +
      '<!-- eyas-import:p2 -->\n## Imported: Later (bravo.md)\n\nL\n<!-- /eyas-import:p2 -->\n'

    const result = await rollbackJob(deps, 'j')

    expect(files['a1/AGENTS.md']).toBe(
      'seed\n\n---\n\n<!-- eyas-import:p2 -->\n## Imported: Later (bravo.md)\n\nL\n<!-- /eyas-import:p2 -->\n',
    )
    expect(result.skipped).toEqual([
      'proposal:p1 (unclosed import marker; removed to the end of its section)',
    ])
    expect(result.removed.proposal).toBe(1)
  })

  // N1 — the advisory reaches the operator through the result.
  it('warns that a marker-less section may have been only partly removed', async () => {
    insertJob('j', 'completed')
    insertProposal({ id: 'p1', title: 'Rules (alpha.md)', status: 'approved' })
    recordApplied(db, { jobId: 'j', kind: 'proposal', ref: 'p1' })

    const { deps, files } = makeDeps()
    files['a1/AGENTS.md'] = 'seed\n\n---\n\n## Imported: Rules (alpha.md)\n\nR\n\n---\n\nmy own notes\n'

    const result = await rollbackJob(deps, 'j')

    expect(files['a1/AGENTS.md']).toBe('seed\n\n---\n\nmy own notes\n')
    expect(result.skipped).toEqual([
      'proposal:p1 (markers missing — section may be partially removed: Rules (alpha.md))',
    ])
    // The advisory is not a refusal: the proposal was still rolled back.
    expect(result.removed.proposal).toBe(1)
  })

  it('carries on after one item throws', async () => {
    insertJob('j', 'completed')
    recordApplied(db, { jobId: 'j', kind: 'episodic', ref: 'e1' })
    recordApplied(db, { jobId: 'j', kind: 'episodic', ref: 'e2' })

    const { deps, deleted } = makeDeps({
      episodic: {
        delete: (id) => {
          if (id === 'e1') throw new Error('locked')
          deleted.push(`ep:${id}`)
        },
      },
    })
    const result = await rollbackJob(deps, 'j')

    expect(deleted).toEqual(['ep:e2'])
    expect(result.removed.episodic).toBe(1)
    expect(result.skipped).toEqual(['episodic:e1 (locked)'])
    expect(jobRow().status).toBe('rolled_back')
  })
})

/**
 * A3 / A15 — an undo may remove what the import wrote, and nothing else. The
 * ledger carries the digest of the body that was written, so a note the owner
 * has since rewritten is recognisably theirs even though it still wears the
 * import's tags.
 */
describe('rollbackJob — the owner has edited the note since', () => {
  const BODY = 'Never deploy on a Friday.'
  /** A vault file exactly as the writer leaves it: frontmatter, then the body. */
  const onDisk = (body: string): string => `---\ntitle: Alpha\n---\n${body}`

  /** The guard reading the file itself, which is the only verbatim view of it. */
  const withRaw = (raw: string | null, onDelete?: (p: string) => void) =>
    makeDeps({
      vault: {
        delete: (p: string) =>
          onDelete
            ? onDelete(p)
            : (() => {
                throw new Error(`must not delete ${p}`)
              })(),
        readRaw: () => raw,
      },
    })

  const seed = (sha256?: string): void => {
    insertJob('j', 'completed')
    indexVaultNote('semantic/alpha.md', ['imported', 'import-job:j'])
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/alpha.md', ...(sha256 ? { sha256 } : {}) })
  }

  it('keeps a note whose body no longer hashes to what the import wrote', async () => {
    seed(contentSha(BODY))
    const { deps } = withRaw(onDisk(`${BODY}\n\nAnd never on a Thursday either.`))
    const result = await rollbackJob(deps, 'j')

    expect(result.removed.vault).toBe(0)
    expect(result.skipped).toEqual(['vault:semantic/alpha.md (edited since import: semantic/alpha.md)'])
    // The row survives: it is the last thing linking the note to its import.
    expect(ledgerRows()).toEqual(['vault:semantic/alpha.md'])
    expect(jobRow().status).toBe('rolled_back')
  })

  it('removes a note that is byte-for-byte what the import wrote', async () => {
    seed(contentSha(BODY))
    const deleted: string[] = []
    const { deps } = withRaw(onDisk(BODY), (p) => deleted.push(p))
    const result = await rollbackJob(deps, 'j')

    expect(deleted).toEqual(['semantic/alpha.md'])
    expect(result.removed.vault).toBe(1)
    expect(result.skipped).toEqual([])
  })

  it("tolerates the writer's appended newline", async () => {
    // The vault writer adds exactly one trailing newline when the body has none.
    // That is its documented normalisation, not an edit by the owner (R11.5).
    seed(contentSha(BODY))
    const deleted: string[] = []
    const { deps } = withRaw(onDisk(`${BODY}\n`), (p) => deleted.push(p))
    const result = await rollbackJob(deps, 'j')

    expect(deleted).toEqual(['semantic/alpha.md'])
    expect(result.skipped).toEqual([])
  })

  it('keeps a body with blank lines the import wrote verbatim', async () => {
    const body = '\n\nNever deploy on a Friday.\n\n\n'
    seed(contentSha(body))
    const deleted: string[] = []
    const { deps } = withRaw(onDisk(body), (p) => deleted.push(p))
    await rollbackJob(deps, 'j')
    expect(deleted).toEqual(['semantic/alpha.md'])
  })

  it('still recognises a digest recorded before the amendment', async () => {
    // P-13 — the pre-R11 digest was taken over the trimmed body.
    const body = `${BODY}\n\n`
    seed(contentSha(legacyBody(body, true)))
    const deleted: string[] = []
    const { deps } = withRaw(onDisk(body), (p) => deleted.push(p))
    const result = await rollbackJob(deps, 'j')

    expect(deleted).toEqual(['semantic/alpha.md'])
    expect(result.skipped).toEqual([])
  })

  it('still recognises the pre-amendment trimmed digest of an indented body', async () => {
    // `sha256(body.trim())` was the pre-amendment vault digest, and `trim()`
    // differs from `legacyBody` for a body whose first line starts with a space.
    const body = '  two spaces first\nline\n'
    seed(contentSha(body.trim()))
    const deleted: string[] = []
    const { deps } = withRaw(onDisk(body), (p) => deleted.push(p))
    const result = await rollbackJob(deps, 'j')

    expect(deleted).toEqual(['semantic/alpha.md'])
    expect(result.skipped).toEqual([])
  })

  it('falls back to the tag check for a row written before the digest existed', async () => {
    // No sha256: nothing to compare, so the guard may not claim the note was edited.
    seed()
    const deleted: string[] = []
    const { deps } = withRaw(onDisk('anything at all'), (p) => deleted.push(p))
    const result = await rollbackJob(deps, 'j')

    expect(deleted).toEqual(['semantic/alpha.md'])
    expect(result.skipped).toEqual([])
  })

  it('falls back to the parsed reader when the file itself cannot be read', async () => {
    seed(contentSha(BODY))
    const deleted: string[] = []
    const { deps } = makeDeps({
      vault: {
        delete: (p: string) => deleted.push(p),
        readRaw: () => null,
        // The parsed reader trims, so only trimmed shapes can match here.
        read: () => ({ content: BODY }),
      },
    })
    await rollbackJob(deps, 'j')
    expect(deleted).toEqual(['semantic/alpha.md'])
  })

  it('cannot claim a note was edited when there is no reader to ask', async () => {
    seed(contentSha(BODY))
    // `makeDeps`' vault has no reader: the tag check decides alone, as before.
    const { deps, deleted } = makeDeps()
    await rollbackJob(deps, 'j')

    expect(deleted).toEqual(['vault:semantic/alpha.md'])
  })
})

/**
 * A4 — the artifacts are gone by the time the ledger is cleared, so a failure
 * there is a record to reconcile, not a reason to report the undo as failed.
 */
describe('rollbackJob — the ledger could not be cleared', () => {
  it('still finishes the undo and says out loud that the rows are stale', async () => {
    insertJob('j', 'completed')
    indexVaultNote('semantic/alpha.md', ['imported', 'import-job:j'])
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/alpha.md' })

    // Only the ledger batch fails; every other statement goes through.
    const flaky: any = {
      run: (query: unknown) => {
        if (JSON.stringify(query).includes('BEGIN IMMEDIATE')) throw new Error('database is locked')
        return db.run(query)
      },
      all: (query: unknown) => db.all(query),
      get: (query: unknown) => db.get(query),
    }
    const { deps, deleted } = makeDeps({ db: flaky })
    const result = await rollbackJob(deps, 'j')

    expect(deleted).toEqual(['vault:semantic/alpha.md'])
    expect(result.removed.vault).toBe(1)
    expect(result.skipped).toEqual(['ledger clear failed: database is locked'])
    // The job is undone, and the rows that could not be dropped are still there.
    expect(jobRow().status).toBe('rolled_back')
    expect(ledgerRows()).toEqual(['vault:semantic/alpha.md'])
  })
})

/**
 * I13 — the status read was a check-then-act: two calls a few milliseconds
 * apart both passed it, both walked the ledger, and the loser's all-zero record
 * overwrote the winner's — the only place the refused items were still named.
 */
describe('rollbackJob — two undos at once', () => {
  it('lets exactly one pass and refuses the other before it removes anything', async () => {
    insertJob('j', 'completed')
    indexVaultNote('semantic/alpha.md', ['imported', 'import-job:j'])
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/alpha.md' })
    recordApplied(db, { jobId: 'j', kind: 'episodic', ref: 'e1' })

    const { deps, deleted } = makeDeps()
    const first = rollbackJob(deps, 'j')
    const second = rollbackJob(deps, 'j')

    await expect(second).rejects.toThrow(/already being rolled back/i)
    const result = await first
    // One pass did the work, and its record is the one that survives.
    expect(deleted.sort()).toEqual(['ep:e1', 'vault:semantic/alpha.md'])
    expect(result.removed).toMatchObject({ vault: 1, episodic: 1 })
    expect(JSON.parse(jobRow().stats_json).rollback.removed).toMatchObject({ vault: 1, episodic: 1 })
  })

  it('refuses a job another pass has already claimed in the database', async () => {
    insertJob('j', 'completed')
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/alpha.md' })
    // What the claim leaves behind — as another process would have left it.
    db.run(sql`UPDATE data_port_jobs SET phase = 'rolling_back' WHERE id = 'j'`)

    const { deps, deleted } = makeDeps()
    await expect(rollbackJob(deps, 'j')).rejects.toThrow(/already being rolled back/i)
    expect(deleted).toEqual([])
    expect(ledgerRows()).toEqual(['vault:semantic/alpha.md'])
  })

  it('gives the claim back when the pass dies, so the undo can be retried', async () => {
    insertJob('j', 'completed')
    indexVaultNote('semantic/alpha.md', ['imported', 'import-job:j'])
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/alpha.md' })

    const exploding: any = {
      run: (query: unknown) => {
        if (JSON.stringify(query).includes('data_port_proposals')) throw new Error('disk went away')
        return db.run(query)
      },
      all: (query: unknown) => db.all(query),
      get: (query: unknown) => db.get(query),
    }
    const { deps } = makeDeps({ db: exploding })
    await expect(rollbackJob(deps, 'j')).rejects.toThrow(/disk went away/)
    // The job is left exactly as it was found, claim included.
    expect(jobRow().phase).toBe('done')
    expect(jobRow().status).toBe('completed')

    // …and a second attempt over a healthy database goes through.
    const retry = makeDeps()
    const result = await rollbackJob(retry.deps, 'j')
    expect(result.removed.vault).toBe(1)
  })
})

describe('deleteAppliedRows', () => {
  it('leaves every row in place when one deletion fails', () => {
    insertJob('j', 'completed')
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/alpha.md' })
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/bravo.md' })
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/charlie.md' })
    const ids = listApplied(db, 'j').map((row) => row.id)

    // Call order inside deleteAppliedRows: BEGIN, then one DELETE per id. The
    // third call is the second DELETE, so the batch fails halfway.
    let calls = 0
    const flaky: any = {
      run: (query: unknown) => {
        calls += 1
        if (calls === 3) throw new Error('database is locked')
        return db.run(query)
      },
      all: (query: unknown) => db.all(query),
      get: (query: unknown) => db.get(query),
    }

    expect(() => deleteAppliedRows(flaky, ids)).toThrow(/locked/)
    expect(listApplied(db, 'j')).toHaveLength(3)
  })

  it('deletes nothing when the transaction cannot be opened', () => {
    insertJob('j', 'completed')
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/alpha.md' })
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/bravo.md' })
    const ids = listApplied(db, 'j').map((row) => row.id)

    // The first `run` is the BEGIN. A busy database, not a caller's open
    // transaction: fail closed.
    let calls = 0
    const locked: any = {
      run: (query: unknown) => {
        calls += 1
        if (calls === 1) throw new Error('database is locked')
        return db.run(query)
      },
      all: (query: unknown) => db.all(query),
      get: (query: unknown) => db.get(query),
    }

    expect(() => deleteAppliedRows(locked, ids)).toThrow(/locked/)
    expect(listApplied(db, 'j')).toHaveLength(2)
  })

  it("participates in a caller's transaction instead of owning one", () => {
    insertJob('j', 'completed')
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/alpha.md' })
    const ids = listApplied(db, 'j').map((row) => row.id)

    let calls = 0
    const nested: any = {
      run: (query: unknown) => {
        calls += 1
        if (calls === 1) throw new Error('cannot start a transaction within a transaction')
        return db.run(query)
      },
      all: (query: unknown) => db.all(query),
      get: (query: unknown) => db.get(query),
    }

    deleteAppliedRows(nested, ids)

    expect(listApplied(db, 'j')).toEqual([])
    // The failed BEGIN and one DELETE — and no COMMIT, because the caller owns
    // the transaction and its outcome.
    expect(calls).toBe(2)
  })

  it('does nothing at all for an empty batch', () => {
    insertJob('j', 'completed')
    recordApplied(db, { jobId: 'j', kind: 'vault', ref: 'semantic/alpha.md' })

    deleteAppliedRows(db, [])

    expect(listApplied(db, 'j')).toHaveLength(1)
  })
})
