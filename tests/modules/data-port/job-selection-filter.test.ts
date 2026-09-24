// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// P-10 — a bulk selection is a folder/kind GESTURE, not a list of ids. The wire
// stays a few hundred bytes whatever the size of the tree, the server resolves
// it against the candidate table, and the job imports exactly what the wizard
// showed. The legacy id list still works and must land the same ledger.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'
import { createDataPortService } from '@modules/data-port/service'
import { listApplied } from '@modules/data-port/ledger'
import { buildApplyDeps, type ApplyDepsHost } from '@modules/data-port/apply-deps'
import { createMemoryTables } from '@modules/memory/schema'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createSkillLoader } from '@modules/skills/skill-loader'
import { createVaultService } from '@modules/memory/vault/vault-service'
import type { ApplyDeps } from '@modules/data-port/pipeline/apply'
import type { PublicCandidate } from '@modules/data-port/types'

/** Notes per folder. Three folders, so the tree carries 1 200 candidates. */
const PER_FOLDER = 400
const FOLDERS = ['alpha', 'bravo', 'charlie'] as const

const logger = { debug() {}, info() {}, warn() {}, error() {} }

interface Harness {
  root: string
  dataDir: string
  db: any
  service: ReturnType<typeof createDataPortService>
  vault: ReturnType<typeof createVaultService>
}

const roots: string[] = []

function createSkillsTable(db: any): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, category TEXT,
    trigger_patterns TEXT, capabilities TEXT, version TEXT DEFAULT '1.0.0',
    content TEXT NOT NULL, skill_type TEXT NOT NULL DEFAULT 'knowledge',
    tool_config TEXT, integration_config TEXT, sources TEXT,
    source TEXT NOT NULL DEFAULT 'user', enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
}

/** A whole running stack: real vault, real memory tables, real skill loader. */
function harness(): Harness {
  const root = mkdtempSync(join(tmpdir(), 'dp-sel-'))
  const dataDir = mkdtempSync(join(tmpdir(), 'dp-sel-data-'))
  roots.push(root, dataDir)
  for (const folder of FOLDERS) {
    for (let i = 0; i < PER_FOLDER; i++) {
      const full = join(root, 'notes', folder, `n${String(i).padStart(3, '0')}.md`)
      mkdirSync(join(full, '..'), { recursive: true })
      writeFileSync(full, `---\nname: ${folder}_${i}\ntype: reference\n---\nNote ${folder} ${i}.\n`)
    }
  }
  const db = createMemoryDb()
  createDataPortTables(db)
  createMemoryTables(db)
  createSkillsTable(db)
  const vault = createVaultService(join(dataDir, 'vault'))
  const episodic = createEpisodicMemoryService(db)
  const loader = createSkillLoader(db, logger)
  const agents: any[] = []
  const host: ApplyDepsHost = {
    db,
    logger,
    memory: {
      episodic: { create: (input) => episodic.create(input as never) },
      vault: {
        write: (path, frontmatter, content) => vault.write(path, frontmatter as never, content),
        exists: (path) => vault.exists(path),
        read: (path) => vault.read(path),
      },
    },
    skills: {
      loader: { create: (input) => loader.create(input as never), getByName: (name) => loader.getByName(name) },
    },
    agents: {
      registry: {
        get: () => undefined,
        create: (input) => {
          agents.push(input)
          return { id: (input as any).id }
        },
      },
    },
  }
  let service: ReturnType<typeof createDataPortService>
  const applyDepsFactory = (): ApplyDeps =>
    buildApplyDeps({
      host,
      dataDir,
      createProposal: (input) => service.createProposal(input),
      readWorkspaceFile: () => null,
      resolveDefaultAgentId: () => null,
    })
  service = createDataPortService({ db, modelCtx: {}, applyDepsFactory, dataDir, logger })
  return { root, dataDir, db, service, vault }
}

const wait = async (done: () => boolean, ms = 120_000): Promise<void> => {
  const t = Date.now()
  while (!done() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 10))
}

async function scanned(h: Harness): Promise<string> {
  const summary = h.service.scanPath('auto', h.root)
  await wait(() => h.service.getScan(summary.scanId)?.status === 'done')
  expect(h.service.getScan(summary.scanId)?.status).toBe('done')
  return summary.scanId
}

/** Every row of one folder, in emission order — the wizard's own paging. */
function pageAll(h: Harness, scanId: string, folder: string): PublicCandidate[] {
  const out: PublicCandidate[] = []
  for (let offset = 0; ; offset += 500) {
    const page = h.service.listCandidates(scanId, { folder }, { offset, limit: 500, order: 'path' })
    out.push(...page.items)
    if (out.length >= page.total) return out
  }
}

async function runToEnd(h: Harness, jobId: string): Promise<void> {
  await wait(() => {
    const j = h.service.getJob(jobId)
    return j?.status === 'completed' || j?.status === 'failed'
  })
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('a job built from a folder/kind selection', () => {
  let h: Harness
  let scanId: string
  let alpha: PublicCandidate[]

  beforeEach(async () => {
    h = harness()
    scanId = await scanned(h)
    alpha = pageAll(h, scanId, 'notes/alpha')
    expect(alpha).toHaveLength(PER_FOLDER)
    expect(h.service.countCandidates(scanId, {})).toBe(PER_FOLDER * FOLDERS.length)
  })

  const wireFor = (excludedId: string, retargetedId: string, ghostId = 'id-from-another-scan') => ({
    base: 'none' as const,
    groups: [{ kind: 'memory' as const, folder: 'notes/alpha', selected: true }],
    rows: [
      { candidateId: excludedId, selected: false },
      { candidateId: retargetedId, target: 'vault.procedural' as const },
      // A row id minted by a DIFFERENT scan — a second tab, a re-scan. It
      // matches nothing here and must change nothing.
      { candidateId: ghostId, selected: true },
    ],
  })

  it('resolves the gesture server-side, and the wire stays small', async () => {
    const excluded = alpha[0]!
    const retargeted = alpha[1]!
    const count = await h.service.selectionCount(scanId, wireFor(excluded.id, retargeted.id), {}, [
      'notes/alpha',
      'notes/bravo',
    ])
    expect(count.selected).toBe(PER_FOLDER - 1)
    expect(count.byFolder['notes/alpha']).toBe(PER_FOLDER - 1)
    expect(count.byFolder['notes/bravo']).toBe(0)

    const job = h.service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: wireFor(excluded.id, retargeted.id),
    })
    expect(job.selectionMode).toBe('wire')
    expect(job.selectionTotal).toBe(PER_FOLDER - 1)
    expect(job.stats.total).toBe(PER_FOLDER - 1)

    // The point of the wire: 399 rows selected, and the stored selection is a
    // few hundred bytes — an id list would have been tens of kilobytes.
    const stored = (
      h.db.all(sql`SELECT selection_json FROM data_port_jobs WHERE id = ${job.id}`) as Array<{
        selection_json: string
      }>
    )[0]!.selection_json
    expect(Buffer.byteLength(stored)).toBeLessThan(2000)

    await runToEnd(h, job.id)
    const done = h.service.getJob(job.id)!
    expect(done.status).toBe('completed')
    expect(done.stats).toMatchObject({ applied: PER_FOLDER - 1, errors: 0, skipped: 0, unchanged: 0 })

    const ledger = listApplied(h.db, job.id)
    expect(ledger).toHaveLength(PER_FOLDER - 1)
    // The row the wire unticked wrote nothing at all.
    expect(ledger.some((r) => r.sourcePath?.endsWith(`${excluded.relativePath.split('/').pop()}`))).toBe(false)
    expect(h.vault.exists('semantic/alpha_0.md')).toBe(false)
    // The row the wire re-targeted was filed where the wire said, not where
    // the scan had proposed.
    const moved = ledger.find((r) => r.sourcePath?.endsWith(retargeted.relativePath.split('/').pop()!))!
    expect(moved.kind).toBe('vault')
    expect(moved.ref.startsWith('procedural/')).toBe(true)
    // Neither of the other two folders was touched.
    expect(h.vault.listFiles().some((f) => f.includes('bravo'))).toBe(false)
    expect(h.vault.listFiles().some((f) => f.includes('charlie'))).toBe(false)
  }, 180_000)

  it('lands the same ledger when the same selection arrives as the legacy id list', async () => {
    const excluded = alpha[0]!
    const retargeted = alpha[1]!
    const wireJob = h.service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: wireFor(excluded.id, retargeted.id),
    })
    await runToEnd(h, wireJob.id)
    const fromWire = listApplied(h.db, wireJob.id)
      .map((r) => `${r.kind}:${r.ref}`)
      .sort()

    // A second, independent stack: the same tree, scanned again, selected as
    // an explicit id list. Same ledger, or the two wires disagree about what a
    // selection means and the wizard shows one thing while the job does another.
    const other = harness()
    const otherScan = await scanned(other)
    const otherAlpha = pageAll(other, otherScan, 'notes/alpha')
    const byPath = new Map(otherAlpha.map((c) => [c.relativePath, c]))
    const legacy = otherAlpha
      .filter((c) => c.relativePath !== excluded.relativePath)
      .map((c) =>
        c.relativePath === retargeted.relativePath
          ? { candidateId: c.id, target: 'vault.procedural' as const }
          : { candidateId: c.id },
      )
    expect(byPath.get(retargeted.relativePath)).toBeTruthy()
    const legacyJob = other.service.createJob({
      scanId: otherScan,
      sourceProfile: 'auto',
      selection: legacy,
    })
    expect(legacyJob.selectionMode).toBe('ids')
    expect(legacyJob.selectionTotal).toBe(PER_FOLDER - 1)
    await runToEnd(other, legacyJob.id)
    expect(other.service.getJob(legacyJob.id)!.stats).toMatchObject({
      applied: PER_FOLDER - 1,
      errors: 0,
    })
    const fromIds = listApplied(other.db, legacyJob.id)
      .map((r) => `${r.kind}:${r.ref}`)
      .sort()
    expect(fromIds).toEqual(fromWire)
  }, 180_000)
})
