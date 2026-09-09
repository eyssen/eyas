// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// P-8 — an import the process died in the middle of is RESUMED, not failed. The
// ledger rows of a batch and the keyset cursor that accounts for them are
// committed in one transaction, so every item is on exactly one side of the
// cursor: read again and recognised, or never touched. The one gap that rule
// leaves — an artifact written after the last commit, whose ledger row died with
// the process — is closed by adoption: the item is re-applied, comes back
// `unchanged` carrying THIS job's id, and is recorded under the ledger kind the
// branch that produced it names, so the undo can still reach it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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
import { createVaultIndexer } from '@modules/memory/vault/vault-indexer'
import type { ApplyDeps } from '@modules/data-port/pipeline/apply'
import type { SourceProfile } from '@modules/data-port/types'

const logger = { debug() {}, info() {}, warn() {}, error() {} }

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

const wait = async (done: () => boolean, ms = 60_000): Promise<void> => {
  const started = Date.now()
  while (!done() && Date.now() - started < ms) await new Promise((r) => setTimeout(r, 5))
}

describe('resume after a restart (P-8)', () => {
  let root: string
  let src: string
  let dataDir: string
  let db: any
  let service: ReturnType<typeof createDataPortService>
  let vault: ReturnType<typeof createVaultService>
  let applyDepsFactory: () => ApplyDeps
  let indexer: ReturnType<typeof createVaultIndexer>
  let agents: any[]

  const put = (rel: string, body: string): void => {
    const full = join(src, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dp-res-'))
    src = join(root, 'src')
    dataDir = join(root, 'data')
    mkdirSync(src, { recursive: true })

    db = createMemoryDb()
    createDataPortTables(db)
    createMemoryTables(db)
    createSkillsTable(db)
    vault = createVaultService(join(dataDir, 'vault'))
    // The REAL vault indexer, because the undo asks `vault_index` whether a note
    // is still the one this import wrote. A harness with no index would make
    // every rollback answer "modified since import" and the case would prove
    // nothing. Wikilink syncing is the one piece stubbed: no graph is asserted.
    indexer = createVaultIndexer(db, vault, { syncLinks() {}, removeSource() {} } as never)
    const episodic = createEpisodicMemoryService(db)
    const loader = createSkillLoader(db, logger)
    agents = []

    const applyHost: ApplyDepsHost = {
      db,
      logger,
      memory: {
        episodic: { create: (input) => episodic.create(input as never) },
        vault: {
          write: (path, frontmatter, content) => vault.write(path, frontmatter as never, content),
          exists: (path) => vault.exists(path),
          read: (path) => vault.read(path),
        },
        indexer,
      },
      skills: {
        loader: {
          create: (input) => loader.create(input as never),
          getByName: (name) => loader.getByName(name),
        },
      },
      agents: {
        registry: {
          get: (id) => agents.find((a) => a.id === id),
          create: (input) => {
            agents.push(input)
            return { id: (input as any).id }
          },
        },
      },
    }

    // Deliberately NOT bound to one service: a "restart" builds a second service
    // over the same database and the same layers, exactly as the module does.
    applyDepsFactory = (): ApplyDeps =>
      buildApplyDeps({
        host: applyHost,
        dataDir,
        createProposal: (input) => service.createProposal(input),
        readWorkspaceFile: () => 'seed',
        resolveDefaultAgentId: () => 'primary-1',
      })

    service = createDataPortService({ db, modelCtx: {}, applyDepsFactory, dataDir, logger })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  /** A second process over the same database — what a restart actually leaves. */
  const restarted = (): ReturnType<typeof createDataPortService> =>
    createDataPortService({ db, modelCtx: {}, applyDepsFactory, dataDir, logger })

  const scanned = async (
    profile: SourceProfile,
    svc: ReturnType<typeof createDataPortService> = service,
  ): Promise<string> => {
    const summary = svc.scanPath(profile, src)
    await wait(() => svc.getScan(summary.scanId)?.status === 'done')
    expect(svc.getScan(summary.scanId)?.status).toBe('done')
    return summary.scanId
  }

  const finished = async (
    jobId: string,
    svc: ReturnType<typeof createDataPortService>,
  ): Promise<void> => {
    await wait(() => {
      const s = svc.getJob(jobId)?.status
      return s === 'completed' || s === 'failed' || s === 'cancelled'
    })
  }

  it('resumes from the last committed batch, duplicating nothing', async () => {
    for (let i = 0; i < 350; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
    const scanId = await scanned('auto')

    // A deterministic "crash": the first service is stopped at a batch boundary
    // once 250 items are through. A thrown vault write would not do — that is
    // caught per item as an `error` and the job would simply finish, which is
    // not an interruption.
    const svc1 = service
    const job = svc1.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: { base: 'all', groups: [], rows: [] },
    })
    await wait(() => svc1.getJob(job.id)!.stats.processed >= 250)
    expect(svc1.cancelJob(job.id)).toBe(true)
    await wait(() => svc1.getJob(job.id)!.status === 'cancelled')

    const stopped = svc1.getJob(job.id)!
    expect(stopped.stats.processed % 100).toBe(0)
    expect(stopped.stats.processed).toBeLessThan(350)
    expect(stopped.cursorSeq).toBeGreaterThan(0)
    const ledgerBefore = listApplied(db, job.id)
    // The cursor and the rows that account for it committed together.
    expect(ledgerBefore).toHaveLength(stopped.stats.processed)

    // "Restart": the row now looks like a job the process died in the middle of,
    // and a new service over the same database picks it up.
    db.run(
      sql`UPDATE data_port_jobs SET status = 'running', phase = 'apply', finished_at = NULL WHERE id = ${job.id}`,
    )
    const svc2 = restarted()
    expect(svc2.resumeInterruptedJobs()).toEqual({ resumed: 1, released: 0 })
    const afterResume = svc2.getJob(job.id)!
    // Said out loud only for a job that had actually started.
    expect(afterResume.phase).toBe('resuming')
    expect(['pending', 'running']).toContain(afterResume.status)

    await finished(job.id, svc2)
    const done = svc2.getJob(job.id)!
    expect(done.status).toBe('completed')
    // Counters carry across the resume rather than starting over — the second run
    // read only the 100 rows the first had not committed.
    expect(done.stats.processed).toBe(350)
    expect(done.stats.applied).toBe(350)
    expect(done.stats.resumed).toBe(1)
    expect(done.stats.errors).toBe(0)
    // Wall time is the sum of the two runs, not only the second.
    expect(done.stats.elapsedMs).toBeGreaterThanOrEqual(stopped.stats.elapsedMs)

    const ledger = listApplied(db, job.id)
    expect(ledger).toHaveLength(350)
    expect(new Set(ledger.map((l) => l.ref)).size).toBe(350)
    expect(ledger.every((l) => l.sha256?.length === 64)).toBe(true)
    // Every row of the first run survived: nothing was re-recorded under a new id.
    const kept = new Set(ledgerBefore.map((l) => l.id))
    expect(ledger.filter((l) => kept.has(l.id))).toHaveLength(ledgerBefore.length)
    // Nothing was written twice.
    expect(readdirSync(join(dataDir, 'vault', 'semantic')).filter((f) => f.endsWith('-2.md'))).toEqual([])
    expect(readdirSync(join(dataDir, 'vault', 'semantic'))).toHaveLength(350)
  }, 120_000)

  it('reports the time it actually worked, not the hours the server was down', async () => {
    for (let i = 0; i < 350; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
    const scanId = await scanned('auto')
    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: { base: 'all', groups: [], rows: [] },
    })
    await wait(() => service.getJob(job.id)!.stats.processed >= 250)
    expect(service.cancelJob(job.id)).toBe(true)
    await wait(() => service.getJob(job.id)!.status === 'cancelled')
    const stopped = service.getJob(job.id)!
    expect(stopped.importMs).toBeGreaterThan(0)
    expect(stopped.startedAt).toBeTruthy()

    // The server is down. Every millisecond of this belongs to nobody: the
    // wizard falls back to `finished_at − started_at` when `import_ms` is
    // missing, and that span would hand the owner this gap as work done.
    const DOWN_MS = 500
    await new Promise((r) => setTimeout(r, DOWN_MS))

    db.run(
      sql`UPDATE data_port_jobs SET status = 'running', phase = 'apply', finished_at = NULL WHERE id = ${job.id}`,
    )
    const svc2 = restarted()
    svc2.resumeInterruptedJobs()
    await finished(job.id, svc2)
    const done = svc2.getJob(job.id)!
    expect(done.status).toBe('completed')

    // `started_at` is the FIRST start and survives the resume, so the fallback
    // span is well defined — and `import_ms` is the sum of the two working
    // periods, so the wizard never shows the gap.
    expect(done.startedAt).toBe(stopped.startedAt)
    const span = Date.parse(done.finishedAt!) - Date.parse(done.startedAt!)
    expect(span).toBeGreaterThanOrEqual(DOWN_MS)
    expect(done.importMs).toBeGreaterThanOrEqual(stopped.importMs!)
    expect(span - done.importMs!).toBeGreaterThanOrEqual(DOWN_MS * 0.8)
    // The two numbers the wizard may read agree with each other.
    expect(Math.abs(done.stats.elapsedMs - done.importMs!)).toBeLessThanOrEqual(5)
  }, 120_000)

  it('adopts artifacts of an interrupted batch that lost their ledger rows, under their own ledger kinds', async () => {
    for (let i = 0; i < 16; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
    put('.grok/memory/p1/sessions/2026-01-01_alpha.md', '---\ntype: grok-session\n---\nlog\n')
    put('GitHub/alpha/AGENTS.md', '# rules\n\nAnswer in the language the owner wrote in.\n')
    put('.claude/agents/dev.md', '---\nname: dev\ndescription: developer\n---\nYou write code.\n')
    put('.claude/skills/deploy/SKILL.md', '---\nname: deploy\ndescription: Use when "deploy docs"\n---\n# Deploy\n')
    put('.claude/skills/deploy/run.sh', 'echo ship\n')
    put('.claude/skills/bravo/SKILL.md', '---\nname: bravo\ndescription: Use when "bravo check"\n---\n# Bravo\n')
    put('.claude/skills/bravo/check.sh', 'echo bravo\n')
    const scanId = await scanned('auto')

    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: { base: 'default', groups: [], rows: [] },
    })
    await finished(job.id, service)
    expect(service.getJob(job.id)!.status).toBe('completed')
    const before = listApplied(db, job.id)
    expect(new Set(before.map((r) => r.kind))).toEqual(
      new Set(['vault', 'episodic', 'proposal', 'agent', 'skill', 'skill-assets']),
    )

    // Exactly what a process killed between the write and its flush leaves: the
    // artifacts are on disk, their ledger rows are not, and the cursor is back
    // where the last committed batch left it.
    const deploySkill = before.find((r) => r.kind === 'skill' && r.sourcePath?.includes('deploy'))!
    const deployAssets = before.find((r) => r.kind === 'skill-assets' && r.sourcePath?.includes('deploy'))!
    // The other package loses ONLY its asset row — the flush died between the two
    // writes. Adoption has to notice that on its own, not merely alongside the
    // skill it belongs to.
    const bravoAssets = before.find((r) => r.kind === 'skill-assets' && r.sourcePath?.includes('bravo'))!
    const victims = [
      ...before.filter((r) => r.kind === 'vault').slice(0, 3),
      before.find((r) => r.kind === 'episodic')!,
      before.find((r) => r.kind === 'proposal')!,
      before.find((r) => r.kind === 'agent')!,
      deploySkill,
      deployAssets,
      bravoAssets,
    ]
    expect(victims.every(Boolean)).toBe(true)
    for (const v of victims) db.run(sql`DELETE FROM data_port_applied WHERE id = ${v.id}`)
    db.run(
      sql`UPDATE data_port_jobs SET status = 'running', cursor_seq = -1, finished_at = NULL WHERE id = ${job.id}`,
    )

    const svc2 = restarted()
    expect(svc2.resumeInterruptedJobs().resumed).toBe(1)
    await finished(job.id, svc2)
    expect(svc2.getJob(job.id)!.status).toBe('completed')

    const after = listApplied(db, job.id)
    expect(after).toHaveLength(before.length)
    for (const v of victims) {
      const adopted = after.find((r) => r.ref === v.ref && r.kind === v.kind)!
      // A proposal comes back as `proposal`, never as a `vault` row a rollback
      // would then try to delete as a note; the skill's asset directory as
      // `skill-assets`, never as the skill itself.
      expect(adopted).toBeTruthy()
      expect(adopted.sha256).toHaveLength(64)
      expect(adopted.adapter).toBeTruthy()
    }
    // The walk started over, so the counters did too: only the CANDIDATES whose
    // ledger entry was missing count as applied — `deploy` lost two rows and is
    // one item, `bravo` lost one and is another.
    // The walk started over, so the counters did too: only the CANDIDATES whose
    // ledger entry was missing count as applied — `deploy` lost two rows and is
    // one item, `bravo` lost one and is another. 21 items, 23 ledger rows.
    expect(before).toHaveLength(23)
    expect(victims).toHaveLength(9)
    expect(svc2.getJob(job.id)!.stats).toMatchObject({
      processed: 21,
      applied: 8,
      unchanged: 13,
      errors: 0,
      resumed: 1,
    })
    expect(svc2.getJob(job.id)!.stats.skippedReasons).toMatchObject({ unchanged: 13 })
    // Nothing was written a second time in any layer.
    expect(readdirSync(join(dataDir, 'vault', 'semantic')).filter((f) => f.endsWith('-2.md'))).toEqual([])
    expect(agents).toHaveLength(1)
    expect(service.listProposals({ jobId: job.id })).toHaveLength(1)
  }, 120_000)

  it('closes an import the server was killed in the last batch of, and the undo stays reachable', async () => {
    for (let i = 0; i < 120; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
    const scanId = await scanned('auto')
    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: { base: 'all', groups: [], rows: [] },
    })
    await finished(job.id, service)
    const ledger = listApplied(db, job.id)
    expect(ledger).toHaveLength(120)

    // Killed after the last batch committed but before the row said `completed`:
    // the cursor is at the end, so there is genuinely nothing left to import and
    // the resume says so instead of walking the tree again for an hour.
    db.run(
      sql`UPDATE data_port_jobs SET status = 'running', phase = 'apply', finished_at = NULL WHERE id = ${job.id}`,
    )
    const svc2 = restarted()
    expect(svc2.resumeInterruptedJobs().resumed).toBe(1)
    await finished(job.id, svc2)
    const done = svc2.getJob(job.id)!
    expect(done.status).toBe('completed')
    expect(done.stats).toMatchObject({ applied: 120, unchanged: 0, errors: 0, resumed: 1 })
    // The ledger is exactly the one the first run wrote — no new rows, none lost.
    expect(listApplied(db, job.id).map((r) => r.id).sort()).toEqual(ledger.map((r) => r.id).sort())

    // …which is what makes the undo reachable: it walks that ledger.
    const rollbackDeps = {
      db,
      dataDir,
      vault: {
        delete: (path: string) => vault.delete(path),
        read: (path: string) => vault.read(path),
      },
      indexer,
      episodic: { delete: () => {} },
      removeAssetDir: () => true,
      readWorkspaceFile: () => null,
      writeWorkspaceFile: async () => {},
    }
    await svc2.rollback(job.id, rollbackDeps)
    expect(svc2.getJob(job.id)!.status).toBe('rolled_back')
    expect(readdirSync(join(dataDir, 'vault', 'semantic'))).toEqual([])
  }, 120_000)

  it('re-enqueues a queued job without calling it resumed', async () => {
    put('notes/n.md', '---\ntype: reference\n---\nn\n')
    const scanId = await scanned('auto')
    const id = 'queued-1'
    const now = new Date().toISOString()
    // A job that was posted and never started: the wizard must not tell the
    // owner it was "resumed after a restart".
    db.run(sql`INSERT INTO data_port_jobs
      (id, status, source_profile, scan_id, selection_json, phase, progress, stats_json, created_at, updated_at,
       selection_mode, selection_total, cursor_seq)
      VALUES (${id}, 'pending', 'auto', ${scanId}, '{"base":"all","groups":[],"rows":[]}', 'queued', 0, '{}',
              ${now}, ${now}, 'wire', 1, -1)`)

    const svc2 = restarted()
    expect(svc2.resumeInterruptedJobs()).toEqual({ resumed: 0, released: 0 })
    expect(svc2.getJob(id)!.phase).not.toBe('resuming')
    await finished(id, svc2)
    expect(svc2.getJob(id)!.status).toBe('completed')
    expect(svc2.getJob(id)!.stats.resumed).toBe(0)
    expect(svc2.getJob(id)!.stats.applied).toBe(1)
  }, 60_000)

  it('leaves a cancelled import undoable — the notes it wrote are indexed, so rollback can take them back', async () => {
    for (let i = 0; i < 400; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
    const scanId = await scanned('auto')
    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: { base: 'all', groups: [], rows: [] },
    })
    await wait(() => service.getJob(job.id)!.stats.processed >= 100)
    expect(service.cancelJob(job.id)).toBe(true)
    await wait(() => service.getJob(job.id)!.status === 'cancelled')

    const stopped = service.getJob(job.id)!
    const written = stopped.stats.applied
    expect(written).toBeGreaterThan(0)
    expect(written).toBeLessThan(400)
    expect(listApplied(db, job.id)).toHaveLength(written)
    expect(readdirSync(join(dataDir, 'vault', 'semantic'))).toHaveLength(written)
    // The undo walks the ledger but refuses any note the vault index does not
    // name, so a cancelled run whose notes were never indexed strands them in
    // the owner's vault for ever — and burns the single undo attempt saying so.
    expect(
      Number(
        (db.all(sql`SELECT count(*) AS n FROM vault_index`) as Array<{ n: number }>)[0]!.n,
      ),
    ).toBe(written)

    const rollbackDeps = {
      db,
      dataDir,
      vault: {
        delete: (path: string) => vault.delete(path),
        read: (path: string) => vault.read(path),
      },
      indexer,
      episodic: { delete: () => {} },
      removeAssetDir: () => true,
      readWorkspaceFile: () => null,
      writeWorkspaceFile: async () => {},
    }
    const result = await service.rollback(job.id, rollbackDeps)
    expect(result.removed.vault).toBe(written)
    expect(result.skipped).toHaveLength(0)
    expect(service.getJob(job.id)!.status).toBe('rolled_back')
    expect(readdirSync(join(dataDir, 'vault', 'semantic'))).toEqual([])
  }, 120_000)

  /**
   * A-52 — the scan half of the same restart problem. A header left `running`
   * has nobody walking it: the wizard polls it for ever and `createJob` answers
   * 409 against it for ever, so one unlucky restart takes that import away from
   * the owner entirely.
   */
  describe('a scan the restart caught mid-walk', () => {
    it('closes it with an honest reason, keeps every row it reached, and unblocks the import', async () => {
      for (let i = 0; i < 40; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
      const scanId = await scanned('auto')
      const rowsReached = service.countCandidates(scanId, {})
      expect(rowsReached).toBeGreaterThan(0)
      const dirsReached = Number(
        (db.all(sql`SELECT count(*) AS n FROM data_port_scan_dirs WHERE scan_id = ${scanId}`) as Array<{
          n: number
        }>)[0]!.n,
      )
      expect(dirsReached).toBeGreaterThan(0)

      // Exactly the header a killed process leaves: still walking, mid-tick.
      db.run(sql`UPDATE data_port_scans SET status = 'running', finished_at = NULL,
        progress_json = '{"dirsVisited":2,"filesSeen":31,"candidates":31,"bytes":4096,"elapsedMs":120}'
        WHERE id = ${scanId}`)
      expect(service.getScan(scanId)!.status).toBe('running')
      // …and while it says that, the import cannot be started at all.
      expect(() =>
        service.createJob({
          scanId,
          sourceProfile: 'auto',
          selection: { base: 'all', groups: [], rows: [] },
        }),
      ).toThrow(/still running/i)

      const svc2 = restarted()
      expect(svc2.closeInterruptedScans()).toBe(1)

      const closedScan = svc2.getScan(scanId)!
      expect(closedScan.status).toBe('failed')
      // The reason names the restart — not "no rows", which is what the owner
      // would otherwise be told about a scan that found forty of them.
      const warning = closedScan.warnings.find((w) => w.code === 'scan-failed')!
      expect(warning).toBeTruthy()
      expect(String(warning.params?.detail)).toMatch(/interrupted by a restart/i)
      // Nothing a committed batch reached is thrown away. (The batch in flight
      // when a process dies was never committed and is simply not in the table,
      // which is why a closed scan's `filesScanned` can exceed its row count.)
      expect(svc2.countCandidates(scanId, {})).toBe(rowsReached)
      expect(closedScan.stats.candidateCount).toBe(rowsReached)
      expect(
        Number(
          (db.all(sql`SELECT count(*) AS n FROM data_port_scan_dirs WHERE scan_id = ${scanId}`) as Array<{
            n: number
          }>)[0]!.n,
        ),
      ).toBe(dirsReached)
      // Counters come from the walker's last tick and the rows on disk, never
      // from `created_at` — a closed scan must not report the downtime as time
      // spent scanning.
      expect(closedScan.stats.scanMs).toBe(120)
      expect(closedScan.stats.filesScanned).toBe(Math.max(31, rowsReached))
      expect(closedScan.progress).toBeNull()
      // `ScanSummary` carries no `finishedAt`, so the row itself answers: a
      // closed header must not look like one still waiting to finish.
      expect(
        (db.all(sql`SELECT finished_at FROM data_port_scans WHERE id = ${scanId}`) as Array<{
          finished_at: string | null
        }>)[0]!.finished_at,
      ).toBeTruthy()

      // The import is reachable again: what the walk reached can be imported.
      const job = svc2.createJob({
        scanId,
        sourceProfile: 'auto',
        selection: { base: 'all', groups: [], rows: [] },
      })
      await finished(job.id, svc2)
      expect(svc2.getJob(job.id)!.status).toBe('completed')
      expect(svc2.getJob(job.id)!.stats.applied).toBe(rowsReached)

      // …and a fresh scan of the same tree is unaffected.
      const freshId = await scanned('auto', svc2)
      expect(svc2.getScan(freshId)!.status).toBe('done')
      expect(svc2.countCandidates(freshId, {})).toBe(rowsReached)

      // Idempotent: nothing is left to close.
      expect(svc2.closeInterruptedScans()).toBe(0)
    }, 60_000)

    it('never closes a scan this process is actually walking', async () => {
      for (let i = 0; i < 60; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
      const summary = service.scanPath('auto', src)
      expect(summary.status).toBe('running')
      // The sweep is a startup pass, but it must be safe to call at any moment:
      // a live walk is running, not interrupted.
      expect(service.closeInterruptedScans()).toBe(0)
      await wait(() => service.getScan(summary.scanId)?.status === 'done')
      expect(service.getScan(summary.scanId)!.status).toBe('done')
      expect(service.countCandidates(summary.scanId, {})).toBe(60)
    }, 60_000)
  })

  it('runs the jobs a restart found oldest first, one at a time', async () => {
    for (let i = 0; i < 20; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
    const scanId = await scanned('auto')
    const now = Date.now()
    const seed = (id: string, at: string): void => {
      db.run(sql`INSERT INTO data_port_jobs
        (id, status, source_profile, scan_id, selection_json, phase, progress, stats_json, created_at, updated_at,
         selection_mode, selection_total, cursor_seq)
        VALUES (${id}, 'pending', 'auto', ${scanId}, '{"base":"all","groups":[],"rows":[]}', 'queued', 0, '{}',
                ${at}, ${at}, 'wire', 20, -1)`)
    }
    seed('later-job', new Date(now + 60_000).toISOString())
    seed('earlier-job', new Date(now).toISOString())

    const svc2 = restarted()
    svc2.resumeInterruptedJobs()
    await finished('later-job', svc2)
    await finished('earlier-job', svc2)
    const earlier = svc2.getJob('earlier-job')!
    const later = svc2.getJob('later-job')!
    expect(earlier.status).toBe('completed')
    expect(later.status).toBe('completed')
    // The import the owner started first runs first, and the second only once
    // the first is done: one walker per process.
    expect(Date.parse(earlier.finishedAt!)).toBeLessThanOrEqual(Date.parse(later.startedAt!))
  }, 60_000)
})
