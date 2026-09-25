// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// R11.7 — the caps are gone, so the only thing standing between an owner and a
// scan of their whole home directory is whether this actually holds at size.
//
// Skipped unless EYAS_SCALE_TESTS=1: it writes hundreds of megabytes (1.5 GB for
// the ten-times case) and runs for minutes.
//
//   EYAS_SCALE_TESTS=1 bun vitest run tests/modules/data-port/scale.test.ts
//
// What it is for. Three findings this feature was built to make impossible can
// only come back at size: a scan that RETAINS its rows in memory, a count that
// BLOCKS the event loop, and a container held open while every unit inside it is
// rendered. Each is invisible on a fixture of fifty files.
//
// Memory is asserted TWO ways, because the two questions are different.
//
// "Does the scan retain its rows?" is answered by heap AFTER a forced GC: if the
// walk streams, the heap comes back to where it started however many rows went
// past. RSS cannot answer it — the allocator does not return pages to the OS, so
// RSS stays high after a scan that leaked nothing at all (measured: heap 235 →
// 5 MiB across a GC while RSS only fell 881 → 790).
//
// "How much does it need at once?" is answered by peak RSS, and the bound is per
// LARGEST SINGLE FILE, not per row (A-56) — a container is held as one buffer
// while every unit inside it is rendered. Measured on this machine:
//
//   91 MiB JSONL transcript  → peak +287 MiB   3.2x   (A-56's 2-4x holds)
//   92 MiB chat export       → peak +686 MiB   7.5x   (parsed whole, 11 000 units)
//
// The chat-export ratio is more than double what the docs state; it is reported
// by this test rather than assumed, so the number can be corrected from a
// measurement instead of an estimate (A-62).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { buildScaleTree, SHAPES } from '../../helpers/scale-tree'
import { createDataPortTables } from '@modules/data-port/schema'
import { createDataPortService } from '@modules/data-port/service'
import { createDataPortRoutes } from '@modules/data-port/routes'
import { listApplied } from '@modules/data-port/ledger'
import { createMemoryTables } from '@modules/memory/schema'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createVaultService } from '@modules/memory/vault/vault-service'
import { createSkillLoader } from '@modules/skills/skill-loader'
import { buildApplyDeps, type ApplyDepsHost } from '@modules/data-port/apply-deps'
import type { ApplyDeps } from '@modules/data-port/pipeline/apply'

const ENABLED = process.env.EYAS_SCALE_TESTS === '1'

const MB = 1024 * 1024

/**
 * Peak RSS is allowed to scale with the LARGEST SINGLE FILE and with nothing
 * else. The multiplier is the measured worst case (a whole-file JSON parse,
 * 7.5x) with headroom; the flat term covers the runtime, the database handle and
 * the row batches in flight.
 */
const PER_FILE_MULTIPLIER = 9

/**
 * Peak RSS is the ALLOCATOR's high-water mark over a multi-minute run, and it is
 * not a stable measurement: five runs of materially the same code on this
 * machine measured 313, 419, 552, 608 and 860 MiB, varying with GC timing and
 * with what else the machine was doing. A tight budget on it is a flaky test,
 * which is what a 512 MiB bar turned out to be.
 *
 * So this bar is set where it discriminates the regression it exists for rather
 * than where the best run happened to land. Per-ROW retention at 260 000 rows
 * would be gigabytes, not a few hundred megabytes, and that is what would break
 * this line. The precise, deterministic claim lives in the two heap assertions:
 * what is retained after a scan, and that a second scan adds nothing.
 */
const FLAT_RSS_BUDGET = 1536 * MB

/**
 * What may still be on the heap once the walk is over and a GC has run.
 *
 * The walker holds per-FILE identity state while it runs — the realpath de-dupe
 * set, the alias maps, the ancestor chains that detect a cycle — so this is not
 * zero and is not meant to be. What matters is that it is RELEASED when the scan
 * ends, which the plateau case below asserts directly.
 */
const RETAINED_HEAP_BUDGET = 256 * MB

/**
 * How much a SECOND scan of the same tree may add to the first's retained heap.
 * This is the real anti-leak assertion: if a finished scan kept its identity
 * maps, retention would step up once per scan and an owner who re-imported
 * would run the process out of memory. Measured across three scans of 15 259
 * rows: 9, 18, 18 MiB — a plateau, not a staircase.
 */
const RETENTION_PLATEAU_BUDGET = 48 * MB

/**
 * Forces a collection, or FAILS with an actionable message (A-86).
 *
 * It used to answer `false` and let each caller skip its assertion. Under Node
 * without `--expose-gc` — a runtime this project supports — that silently
 * removed the one assertion carrying the anti-leak invariant, and the case still
 * reported green. A test that asserted nothing and passed is exactly the class
 * this wave has closed three times over; it must not sit in the suite's most
 * important claim.
 *
 * Failing is chosen over skipping because this suite is opt-in: somebody set
 * `EYAS_SCALE_TESTS=1` deliberately, and the thing they are asking for is this
 * measurement. A green run must mean the invariant held.
 */
const forceGc = (): void => {
  const g = globalThis as { Bun?: { gc?: (sync: boolean) => void }; gc?: () => void }
  if (g.Bun?.gc) {
    g.Bun.gc(true)
    return
  }
  if (typeof g.gc === 'function') {
    g.gc()
    return
  }
  throw new Error(
    'The scale suite asserts what a scan RETAINS, and that needs a forced collection. ' +
      'This runtime exposes none — run it under Bun, or under Node with --expose-gc. ' +
      'Failing rather than passing with the central invariant unchecked.',
  )
}

const wait = async (done: () => boolean, ms: number): Promise<void> => {
  const started = Date.now()
  while (!done() && Date.now() - started < ms) await new Promise((r) => setTimeout(r, 50))
}

/** Reported so a run leaves numbers behind, not just a green tick. */
function report(label: string, fields: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  console.log(`[scale] ${label} ${JSON.stringify(fields)}`)
}

interface Harness {
  root: string
  src: string
  dataDir: string
  db: any
  service: ReturnType<typeof createDataPortService>
  app: Hono
}

function standUp(profile: 'plan' | 'scale' | 'tenx'): Harness {
  const root = mkdtempSync(join(tmpdir(), `eyas-scale-${profile}-`))
  const src = join(root, 'src')
  const dataDir = join(root, 'data')
  mkdirSync(src, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  buildScaleTree(src, profile)

  /*
   * A FILE-backed database, unlike every other suite here.
   *
   * `createMemoryDb()` is `:memory:`, so the whole imported corpus — 260 000
   * candidate rows and every body written — would be resident as the database
   * itself, and the RSS this case measures would be answering "how big was the
   * corpus" rather than "what does the scan hold". Production writes to a file;
   * so does this.
   */
  const sqlite = new Database(join(dataDir, 'eyas.sqlite'))
  sqlite.run('PRAGMA journal_mode = WAL')
  // `as any` rather than `as never`: the harness calls `db.run` below, and the
  // project's drizzle wrapper type is not the one these module factories take.
  const db = drizzle(sqlite) as any
  createDataPortTables(db)
  createMemoryTables(db)
  // The skills table the loader needs, in the shape the module creates it.
  db.run(sql`CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, category TEXT,
    trigger_patterns TEXT, capabilities TEXT, version TEXT DEFAULT '1.0.0',
    content TEXT NOT NULL, skill_type TEXT NOT NULL DEFAULT 'knowledge',
    tool_config TEXT, integration_config TEXT, sources TEXT,
    source TEXT NOT NULL DEFAULT 'user', enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`)
  const logger = { debug() {}, info() {}, warn() {}, error() {} }
  const loader = createSkillLoader(db, logger as never)
  const vault = createVaultService(join(dataDir, 'vault'))
  const episodic = createEpisodicMemoryService(db)
  /**
   * A registry that REMEMBERS, mirroring `scan-and-apply.test.ts`. A stub whose
   * `get` always answers `undefined` makes the importer create the persona again
   * on every run, which reads as an idempotency defect and is not one — the
   * production registry answers from the table.
   */
  const agents: Array<{ id: string; systemPrompt?: string }> = []

  const host: ApplyDepsHost = {
    db,
    logger: logger as never,
    memory: {
      episodic: { create: (input) => episodic.create(input as never) },
      vault: {
        write: (p, fm, content) => vault.write(p, fm as never, content),
        exists: (p) => vault.exists(p),
        read: (p) => vault.read(p),
      },
    },
    skills: { loader: { create: (i) => loader.create(i as never), getByName: (n) => loader.getByName(n) } },
    agents: {
      registry: {
        get: (id) => {
          const found = agents.find((a) => a.id === id)
          return found ? { id: found.id, systemPrompt: found.systemPrompt, source: 'user' } : undefined
        },
        create: (input) => {
          agents.push(input as { id: string; systemPrompt?: string })
          return { id: (input as { id: string }).id }
        },
      },
    },
  }

  const service = createDataPortService({
    db,
    // No model: an import of this size must be deterministic and offline.
    modelCtx: {},
    applyDepsFactory: (): ApplyDeps =>
      buildApplyDeps({
        host,
        dataDir,
        createProposal: (input) => service.createProposal(input),
        readWorkspaceFile: () => '',
        resolveDefaultAgentId: () => 'primary-1',
      }),
    dataDir,
    logger: logger as never,
  })

  const app = new Hono()
  app.use('*', async (c, next) => {
    ;(c as never as { set: (k: string, v: unknown) => void }).set('ability', { can: () => true })
    await next()
  })
  createDataPortRoutes(app, { service })

  return { root, src, dataDir, db, service, app }
}

describe.skipIf(!ENABLED)('data-port at scale (R11.7)', () => {
  describe('a tree the size the plan targets', () => {
    let h: Harness
    beforeAll(() => {
      h = standUp('scale')
    }, 1_800_000)
    afterAll(() => {
      rmSync(h.root, { recursive: true, force: true })
    }, 600_000)

    it('scans, reviews and imports it within bounds, then reports every item unchanged', async () => {
      const shape = SHAPES.scale
      forceGc()
      const before = process.memoryUsage()
      const rssBefore = before.rss
      const samples: number[] = [rssBefore]
      // 100 ms, not 500: a container is parsed in one synchronous burst, so a
      // slow sampler can miss the peak entirely.
      const sampler = setInterval(() => samples.push(process.memoryUsage().rss), 100)

      const t0 = Date.now()
      const scan = h.service.scanPath('auto', h.src)
      // P-9: the walk starts on the next tick, whatever the size of the tree.
      expect(scan.status).toBe('running')
      await wait(() => h.service.getScan(scan.scanId)?.status === 'done', 900_000)
      const scanWall = Date.now() - t0
      const s = h.service.getScan(scan.scanId)!
      expect(s.status).toBe('done')

      // Every importable file is a row, and the class directory is ONE row
      // carrying its count rather than 2 000 rows nobody asked for.
      const expected = shape.notes + shape.sessions + shape.transcripts + shape.skills + shape.conversations
      expect(s.stats.candidateCount).toBeGreaterThanOrEqual(expected)
      expect(s.stats.dirsSkipped.node_modules).toBe(1)
      expect(s.stats.filesInSkippedDirs).toBe(shape.nmDirs * shape.nmFiles + 1)
      expect(s.stats.scanMs).toBeGreaterThan(0)

      // The API never hands back the whole list; the wizard pages, so this does.
      expect(h.service.listCandidates(scan.scanId, {}, { offset: 0, limit: 500, order: 'path' }).items)
        .toHaveLength(500)

      // The default selection is resolved SERVER-side, over every row.
      const tSel = Date.now()
      const counted = await h.service.selectionCount(scan.scanId, { base: 'default', groups: [], rows: [] })
      const selectionMs = Date.now() - tSel
      expect(counted.selected).toBeGreaterThan(0)

      const tImport = Date.now()
      const job = h.service.createJob({
        scanId: scan.scanId,
        sourceProfile: 'auto',
        selection: { base: 'default', groups: [], rows: [] },
      })
      await wait(() => ['completed', 'failed'].includes(h.service.getJob(job.id)?.status ?? ''), 3_600_000)
      const importWall = Date.now() - tImport
      clearInterval(sampler)

      const done = h.service.getJob(job.id)!
      expect(done.status).toBe('completed')
      expect(done.stats.errors).toBe(0)
      expect(done.stats.applied).toBeGreaterThan(0)
      expect(done.importMs).toBeGreaterThan(0)

      const peakRss = Math.max(...samples) - rssBefore
      // The largest single file in this tree is the chat export; the bound
      // follows it, not the 26 000 rows.
      const largest = statSync(join(h.src, 'Downloads', 'alpha-export', 'conversations.json')).size
      forceGc()
      const retainedHeap = process.memoryUsage().heapUsed - before.heapUsed

      report('scale', {
        rows: s.stats.candidateCount,
        selected: counted.selected,
        applied: done.stats.applied,
        scanWallMs: scanWall,
        scanMs: s.stats.scanMs,
        selectionMs,
        importWallMs: importWall,
        importMs: done.importMs,
        peakRssMiB: Math.round(peakRss / MB),
        largestFileMiB: Math.round(largest / MB),
        peakToLargestFile: +(peakRss / largest).toFixed(2),
        retainedHeapMiB: Math.round(retainedHeap / MB),
      })

      // Peak scales with the biggest file, not with the row count.
      expect(peakRss).toBeLessThan(largest * PER_FILE_MULTIPLIER + FLAT_RSS_BUDGET)
      // …and nothing is kept: 26 000 rows went past and the heap came back.
      // This is the assertion that would catch a scan retaining its rows, which
      // peak RSS cannot see (the allocator keeps the pages either way).
      expect(retainedHeap).toBeLessThan(RETAINED_HEAP_BUDGET)

      // Provenance on every ledger row, at size as at three files (R11.6).
      expect(listApplied(h.db, job.id).every((r) => r.sha256 && r.adapter)).toBe(true)

      // R11.8 at size: the second run writes nothing.
      const again = h.service.createJob({
        scanId: scan.scanId,
        sourceProfile: 'auto',
        selection: { base: 'default', groups: [], rows: [] },
      })
      await wait(() => h.service.getJob(again.id)?.status === 'completed', 3_600_000)
      const second = h.service.getJob(again.id)!
      expect(second.stats).toMatchObject({ applied: 0 })
      expect(second.stats.unchanged).toBe(done.stats.applied + done.stats.proposals)
      expect(listApplied(h.db, again.id)).toEqual([])
    }, 7_200_000)

    /*
     * The leak test, which peak RSS cannot perform.
     *
     * A scan holds per-file identity state while it walks — the realpath de-dupe
     * set, the alias maps, the ancestor chains. If a FINISHED scan kept them,
     * retention would step up once per scan, and an owner who re-scanned their
     * home directory a few times would run the process out of memory. It must
     * plateau instead.
     */
    it('releases what it held: a second scan of the same tree does not add to the first', async () => {
      const settle = async (): Promise<number> => {
        forceGc()
        await new Promise((r) => setTimeout(r, 300))
        forceGc()
        return process.memoryUsage().heapUsed
      }

      const base = await settle()
      const first = h.service.scanPath('auto', h.src)
      await wait(() => h.service.getScan(first.scanId)?.status === 'done', 900_000)
      const afterFirst = await settle()

      const secondScan = h.service.scanPath('auto', h.src)
      await wait(() => h.service.getScan(secondScan.scanId)?.status === 'done', 900_000)
      const afterSecond = await settle()

      const firstHeld = afterFirst - base
      const secondAdded = afterSecond - afterFirst
      report('retention', {
        rows: h.service.getScan(first.scanId)!.stats.candidateCount,
        heldAfterFirstMiB: Math.round(firstHeld / MB),
        addedBySecondMiB: Math.round(secondAdded / MB),
      })
      expect(secondAdded).toBeLessThan(RETENTION_PLATEAU_BUDGET)
    }, 3_600_000)
  })

  describe("a tree ten times the owner's", () => {
    let h: Harness
    beforeAll(() => {
      h = standUp('tenx')
    }, 3_600_000)
    // Deleting 760 000 files takes far longer than vitest's 10 s hook default.
    afterAll(() => {
      rmSync(h.root, { recursive: true, force: true })
    }, 1_800_000)

    it('maps it in the background, stays responsive, reports progress, and cancels within seconds', async () => {
      const shape = SHAPES.tenx
      forceGc()
      const before = process.memoryUsage()
      const rssBefore = before.rss
      const samples: number[] = [rssBefore]
      const progressAt: number[] = []
      let lastProgress = ''

      const t0 = Date.now()
      const scan = h.service.scanPath('auto', h.src)
      expect(scan.status).toBe('running')
      const sampler = setInterval(() => {
        samples.push(process.memoryUsage().rss)
        const p = JSON.stringify(h.service.getScan(scan.scanId)?.progress ?? null)
        if (p !== lastProgress) {
          lastProgress = p
          progressAt.push(Date.now() - t0)
        }
      }, 1000)

      // Responsiveness WHILE the walk runs: the wizard polls these, and a count
      // that blocked the loop would show up here and nowhere else.
      await wait(() => (h.service.getScan(scan.scanId)?.progress?.filesSeen ?? 0) > 50_000, 900_000)
      const midScan: number[] = []
      for (const path of [`/import/scans/${scan.scanId}/tree?parent=.`, `/import/scans/${scan.scanId}/counts`]) {
        const t = Date.now()
        expect((await h.app.request(`/api/v1/data-port${path}`)).status).toBe(200)
        midScan.push(Date.now() - t)
      }

      await wait(() => h.service.getScan(scan.scanId)?.status === 'done', 5_400_000)
      clearInterval(sampler)
      const scanWall = Date.now() - t0
      const s = h.service.getScan(scan.scanId)!
      expect(s.status).toBe('done')

      expect(s.stats.candidateCount).toBeGreaterThanOrEqual(shape.notes)
      expect(s.stats.dirsSkipped.node_modules).toBe(1)
      expect(s.stats.filesInSkippedDirs).toBe(shape.nmDirs * shape.nmFiles + 1)
      expect(s.stats.dirsVisited).toBeGreaterThanOrEqual(shape.noteFolders)

      const peakRss = Math.max(...samples) - rssBefore
      forceGc()
      const retainedHeap = process.memoryUsage().heapUsed - before.heapUsed
      const gaps = progressAt.slice(1).map((at, i) => at - progressAt[i]!)
      const afterScan: number[] = []
      for (const path of [`/import/scans/${scan.scanId}/tree?parent=.`, `/import/scans/${scan.scanId}/counts`]) {
        const t = Date.now()
        expect((await h.app.request(`/api/v1/data-port${path}`)).status).toBe(200)
        afterScan.push(Date.now() - t)
      }
      const tSel = Date.now()
      const counted = await h.service.selectionCount(scan.scanId, {
        base: 'default',
        groups: [{ folder: 'tree/f7', selected: false }],
        rows: [],
      })
      const selectionMs = Date.now() - tSel

      report('tenx', {
        rows: s.stats.candidateCount,
        dirsVisited: s.stats.dirsVisited,
        filesInSkippedDirs: s.stats.filesInSkippedDirs,
        scanWallMs: scanWall,
        scanMs: s.stats.scanMs,
        peakRssMiB: Math.round(peakRss / MB),
        retainedHeapMiB: Math.round(retainedHeap / MB),
        midScanMs: midScan,
        afterScanMs: afterScan,
        selectionMs,
        selected: counted.selected,
        progressUpdates: progressAt.length,
        worstProgressGapMs: gaps.length ? Math.max(...gaps) : null,
      })

      // Every file here is a few bytes, so there is no per-file term at all.
      // The peak catches an order-of-magnitude regression; the retained heap is
      // the exact claim, and it is the one that would move if the walk started
      // holding what it maps.
      expect(peakRss).toBeLessThan(FLAT_RSS_BUDGET)
      expect(retainedHeap).toBeLessThan(RETAINED_HEAP_BUDGET)
      for (const ms of [...midScan, ...afterScan]) expect(ms).toBeLessThan(2000)
      expect(selectionMs).toBeLessThan(2000)
      // At least one progress update per 5 s of wall time, the count of a
      // 500 000-entry class directory included.
      for (const gap of gaps) expect(gap).toBeLessThan(5000)

      // A cancel issued mid-walk is observed within seconds and takes its rows.
      const second = h.service.scanPath('auto', h.src)
      await wait(() => (h.service.getScan(second.scanId)?.progress?.filesSeen ?? 0) > 20_000, 900_000)
      const tc = Date.now()
      expect(h.service.cancelScan(second.scanId)).toBe(true)
      await wait(() => h.service.getScan(second.scanId)?.status === 'cancelled', 10_000)
      const cancelMs = Date.now() - tc
      report('tenx cancel', { cancelMs })
      expect(h.service.getScan(second.scanId)?.status).toBe('cancelled')
      expect(cancelMs).toBeLessThan(5000)
      expect(h.service.countCandidates(second.scanId, {})).toBe(0)
    }, 10_800_000)
  })
})
