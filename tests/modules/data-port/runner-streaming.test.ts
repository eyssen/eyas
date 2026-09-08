// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// R11.7 — the runner is a STREAM. It walks the scan's candidate table by keyset
// in pages, holds one source file open at a time, flushes the ledger and the job
// row together per batch, and rebuilds the index once. Nothing here asserts a
// number for its own sake: each case names a way the old collect-then-loop
// runner would have failed on a tree the size of a home directory — the whole
// selection in memory, a container re-read per unit, a database write per item,
// an index rebuild per hundred, and no way to stop it once started.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'
import { createDataPortService } from '@modules/data-port/service'
import { createDataPortRoutes } from '@modules/data-port/routes'
import { listApplied } from '@modules/data-port/ledger'
import { buildApplyDeps, type ApplyDepsHost } from '@modules/data-port/apply-deps'
import { createMemoryTables } from '@modules/memory/schema'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import { createSkillLoader } from '@modules/skills/skill-loader'
import { createVaultService } from '@modules/memory/vault/vault-service'
import type { ApplyDeps } from '@modules/data-port/pipeline/apply'
import type { SourceProfile } from '@modules/data-port/types'

/**
 * `vi.spyOn(fs, 'readFileSync')` cannot work against an ESM module namespace
 * (scan-stream.test.ts documents the same wall), so the two facts these cases
 * need about the filesystem — how often a container was opened, and how big a
 * file claims to be — are recorded through a PASS-THROUGH module mock. Nothing
 * is stubbed out: every call reaches the real function, and `size` is overridden
 * only for a path a test named.
 */
const fsCalls = vi.hoisted(() => ({
  read: [] as string[],
  /** path → the size `statSync` should report, for the P-17 case. */
  fakeSize: new Map<string, number>(),
}))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    default: actual,
    readFileSync: (path: unknown, ...rest: unknown[]) => {
      fsCalls.read.push(String(path))
      return (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...rest)
    },
    statSync: (path: unknown, ...rest: unknown[]) => {
      const st = (actual.statSync as (...a: unknown[]) => unknown)(path, ...rest) as Record<
        string,
        unknown
      >
      const fake = fsCalls.fakeSize.get(String(path))
      if (fake === undefined || !st) return st
      // A real Stats keeps its fields as own properties and its predicates on the
      // prototype, so a copy with one field replaced still answers isFile().
      return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { size: fake })
    },
  }
})

/** Text of a drizzle template, for counting the statements a run actually makes. */
const sqlText = (q: unknown): string => {
  const chunks = (q as { queryChunks?: unknown[] })?.queryChunks
  if (!Array.isArray(chunks)) return String(q)
  return chunks
    .map((c) => {
      const v = (c as { value?: unknown })?.value
      if (Array.isArray(v)) return v.join('')
      return typeof v === 'string' ? v : ''
    })
    .join(' ')
}

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

const wait = async (done: () => boolean, ms = 240_000): Promise<void> => {
  const started = Date.now()
  while (!done() && Date.now() - started < ms) await new Promise((r) => setTimeout(r, 5))
}

describe('streaming runner (R11.7)', () => {
  let root: string
  let src: string
  let dataDir: string
  let db: any
  let service: ReturnType<typeof createDataPortService>
  let vault: ReturnType<typeof createVaultService>
  let applyDepsFactory: () => ApplyDeps
  let indexCalls: number
  let applyHost: ApplyDepsHost

  const put = (rel: string, body: string): void => {
    const full = join(src, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }

  /** One container holding `n` one-turn conversations. */
  const conversations = (n: number): string =>
    JSON.stringify(
      Array.from({ length: n }, (_, i) => ({
        uuid: `u${i}`,
        name: `alpha ${i}`,
        chat_messages: [{ sender: 'human', text: `turn ${i}` }],
      })),
    )

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dp-run-'))
    src = join(root, 'src')
    dataDir = join(root, 'data')
    mkdirSync(src, { recursive: true })
    fsCalls.read.length = 0
    fsCalls.fakeSize.clear()

    db = createMemoryDb()
    createDataPortTables(db)
    createMemoryTables(db)
    createSkillsTable(db)
    vault = createVaultService(join(dataDir, 'vault'))
    const episodic = createEpisodicMemoryService(db)
    const loader = createSkillLoader(db, logger)
    const agents: any[] = []
    indexCalls = 0

    applyHost = {
      db,
      logger,
      memory: {
        episodic: { create: (input) => episodic.create(input as never) },
        vault: {
          write: (path, frontmatter, content) => vault.write(path, frontmatter as never, content),
          exists: (path) => vault.exists(path),
          read: (path) => vault.read(path),
        },
        indexer: {
          indexAll: () => {
            indexCalls++
            return 0
          },
        },
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

    applyDepsFactory = (): ApplyDeps =>
      buildApplyDeps({
        host: applyHost,
        dataDir,
        createProposal: (input) => service.createProposal(input),
        readWorkspaceFile: () => null,
        resolveDefaultAgentId: () => null,
      })

    service = createDataPortService({ db, modelCtx: {}, applyDepsFactory, dataDir, logger })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

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
    svc: ReturnType<typeof createDataPortService> = service,
  ): Promise<void> => {
    await wait(() => {
      const s = svc.getJob(jobId)?.status
      return s === 'completed' || s === 'failed' || s === 'cancelled'
    })
  }

  it(
    'imports 5 200 items from one container and 200 notes with one open container, batched flushes and one reindex',
    async () => {
      put('chat/conversations.json', conversations(5000))
      for (let i = 0; i < 200; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
      const scanId = await scanned('chat-export')

      // Counted from HERE, so the scan's own reads are not mistaken for the
      // runner's: the point is that the runner opens the container once for all
      // 5 000 units it holds.
      fsCalls.read.length = 0
      const updates: string[] = []
      const origRun = db.run.bind(db)
      db.run = (q: any) => {
        const text = sqlText(q)
        if (text.includes('UPDATE data_port_jobs')) updates.push(text)
        return origRun(q)
      }

      const heapBefore = process.memoryUsage()
      const job = service.createJob({
        scanId,
        sourceProfile: 'chat-export',
        selection: { base: 'default', groups: [], rows: [] },
      })
      expect(job.selectionTotal).toBe(5200)
      // The job row exists and is queued; nothing has been walked in the caller.
      expect(job.status).toBe('pending')
      await finished(job.id)

      const done = service.getJob(job.id)!
      expect(done.status).toBe('completed')
      expect(done.stats).toMatchObject({ applied: 5200, total: 5200, processed: 5200, errors: 0 })
      // One rebuild for the whole import, not one per hundred notes.
      expect(indexCalls).toBe(1)
      // One open container: 5 000 units, one read of the file they came out of.
      expect(fsCalls.read.filter((p) => p.endsWith('conversations.json'))).toHaveLength(1)
      // A write per batch, not a write per item — and not one write at the end
      // either: the wizard follows a long import through these rows.
      expect(updates.length).toBeLessThanOrEqual(Math.ceil(5200 / 100) + 5)
      expect(updates.length).toBeGreaterThanOrEqual(Math.ceil(5200 / 100))
      expect(done.importMs).toBeGreaterThan(0)
      expect(done.stats.elapsedMs).toBeGreaterThan(0)
      expect(done.cursorSeq).toBeGreaterThan(0)
      // Flat: the selection was never a list, and only one container was ever
      // held. Measured on heap AND external, because a container's cost is
      // mostly OFF-heap — the file's Buffer plus the rendered units — and a
      // `heapUsed`-only bound would not see the part that actually grows (I3).
      //
      // These compare BEFORE with AFTER, so they bound what the run RETAINS —
      // a leak bound, not a peak bound. The transient peak of one open
      // container is several times its file size and is not measured here; the
      // report gives the measured spread. The RSS bound is deliberately loose:
      // resident memory depends on when the collector runs, and the observed
      // spread on this shape reaches ~385 MiB on a loaded machine, so a tighter
      // number would flake without catching anything a real regression would
      // not also trip.
      const after = process.memoryUsage()
      expect(after.heapUsed + after.external - (heapBefore.heapUsed + heapBefore.external)).toBeLessThan(
        200 * 1024 * 1024,
      )
      expect(after.rss - heapBefore.rss).toBeLessThan(600 * 1024 * 1024)

      const ledger = listApplied(db, job.id)
      expect(ledger).toHaveLength(5200)
      // R11.6 — a digest and an adapter on every row, whatever the kind.
      expect(ledger.every((r) => r.sha256?.length === 64)).toBe(true)
      expect(ledger.every((r) => Boolean(r.adapter))).toBe(true)
      expect(ledger.every((r) => r.paths.length > 0)).toBe(true)
      expect(new Set(ledger.map((r) => r.adapter))).toEqual(new Set(['chat-export', 'generic-md']))

      // Second run: everything is recognised, nothing is written twice, and no
      // row falls back to the O(N²) tag scan — every ledger row carries a digest.
      const queries: string[] = []
      const origAll = db.all.bind(db)
      db.all = (q: any) => {
        queries.push(sqlText(q))
        return origAll(q)
      }
      const again = service.createJob({
        scanId,
        sourceProfile: 'chat-export',
        selection: { base: 'default', groups: [], rows: [] },
      })
      await finished(again.id)
      expect(service.getJob(again.id)!.status).toBe('completed')
      expect(service.getJob(again.id)!.stats).toMatchObject({ unchanged: 5200, applied: 0, errors: 0 })
      expect(listApplied(db, again.id)).toEqual([])
      expect(queries.filter((q) => /tags LIKE/i.test(q))).toEqual([])
      // Nothing was duplicated in either layer.
      expect(vault.listFiles().filter((f) => /-\d+\.md$/.test(f))).toEqual([])
      expect(
        (db.all(sql`SELECT COUNT(*) AS n FROM episodic_memories`) as Array<{ n: number }>)[0]!.n,
      ).toBe(5000)
    },
    240_000,
  )

  it(
    'releases a container even when a unit in the middle is excluded',
    async () => {
      put('chat/conversations.json', conversations(5000))
      const scanId = await scanned('chat-export')
      const middle = service
        .listCandidates(scanId, { q: 'alpha 2500' }, { offset: 0, limit: 10, order: 'seq' })
        .items.find((c) => c.title === 'alpha 2500')!
      expect(middle).toBeTruthy()

      fsCalls.read.length = 0
      const job = service.createJob({
        scanId,
        sourceProfile: 'chat-export',
        selection: { base: 'default', groups: [], rows: [{ candidateId: middle.id, selected: false }] },
      })
      expect(job.selectionTotal).toBe(4999)
      await finished(job.id)

      expect(service.getJob(job.id)!.stats).toMatchObject({ applied: 4999, errors: 0 })
      // A hole in the middle of a container is not a reason to open it twice.
      expect(fsCalls.read.filter((p) => p.endsWith('conversations.json'))).toHaveLength(1)
      const ledger = listApplied(db, job.id)
      expect(ledger).toHaveLength(4999)
      expect(ledger.some((r) => r.ref === middle.id)).toBe(false)
      expect(
        (
          db.all(
            sql`SELECT COUNT(*) AS n FROM episodic_memories WHERE content LIKE '%turn 2500%'`,
          ) as Array<{ n: number }>
        )[0]!.n,
      ).toBe(0)
    },
    240_000,
  )

  it('names the engine string limit as the reason instead of a generic error', async () => {
    put('notes/ok.md', '# ok\n')
    put('notes/small.md', '# small\n')
    const scanId = await scanned('auto')
    // A file larger than the engine can hold as one string, without writing half
    // a gigabyte to say so: the runner consults `statSync(path).size` before it
    // reads, which is the only way it can answer honestly at all.
    fsCalls.fakeSize.set(join(src, 'notes', 'ok.md'), 600 * 1024 * 1024)
    // Counted from here: the scan read the file when it was still an ordinary
    // one, and the question is what the RUNNER does now that it is not.
    fsCalls.read.length = 0

    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: { base: 'all', groups: [], rows: [] },
    })
    await finished(job.id)
    const done = service.getJob(job.id)!
    expect(done.status).toBe('completed')
    // Named, counted and translatable — never a bare `error`, and never a file
    // silently missing from the import.
    expect(done.stats).toMatchObject({ errors: 0, skipped: 1, applied: 1 })
    expect(done.stats.skippedReasons).toMatchObject({ 'exceeds-string-limit': 1 })
    // The file was never opened: its size answered the question.
    expect(fsCalls.read.filter((p) => p.endsWith(join('notes', 'ok.md')))).toEqual([])
  })

  it('never hands a contains-secrets note to the model even when enrichment is on', async () => {
    // Neither file declares a kind, so the ONLY thing separating them is the
    // credential: without the gate both would be sent.
    put('ai-memory/key.md', 'DB_PASSWORD=alphaalphaalpha0001\nDeployment notes for the alpha box.\n')
    put('ai-memory/plain.md', 'A plain note body, long enough to be worth enriching. '.repeat(4))
    const complete = vi.fn(async () => ({
      content: JSON.stringify({ summary_one_line: 'model summary', tags: [] }),
    }))
    service = createDataPortService({
      db,
      modelCtx: { model: { complete, listProviders: () => [{}] } as never },
      applyDepsFactory,
      dataDir,
      logger,
    })
    const scanId = await scanned('claude-code')
    const flagged = service
      .listCandidates(scanId, {}, { offset: 0, limit: 50, order: 'seq' })
      .items.find((c) => c.relativePath.endsWith('key.md'))!
    expect(flagged.tags).toContain('contains-secrets')

    const job = service.createJob({
      scanId,
      sourceProfile: 'claude-code',
      selection: { base: 'default', groups: [], rows: [] },
      enrich: true,
    })
    await finished(job.id)
    const done = service.getJob(job.id)!
    expect(done.status).toBe('completed')
    expect(complete).toHaveBeenCalledTimes(1)
    // The credential never left the machine, and the item still imported.
    expect(JSON.stringify(complete.mock.calls[0])).not.toContain('alphaalphaalpha0001')
    expect(done.stats).toMatchObject({ aiEnriched: 1, aiFallback: 1, errors: 0 })
    expect(vault.read('semantic/key.md')!.content).toContain('alphaalphaalpha0001')
    expect(vault.read('semantic/key.md')!.frontmatter.tags).toContain('contains-secrets')
  })

  it('runs queued jobs one at a time and can be cancelled at a batch boundary', async () => {
    for (let i = 0; i < 600; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
    const scanId = await scanned('auto')

    const a = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: { base: 'all', groups: [], rows: [] },
    })
    const b = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: { base: 'all', groups: [], rows: [] },
    })
    // One import at a time per process: the memory bound the runner keeps is
    // process-wide, so a second job queues rather than walking beside the first.
    expect(service.getJob(b.id)!.status).toBe('pending')

    await wait(() => service.getJob(a.id)!.stats.processed >= 100, 60_000)
    expect(service.getJob(b.id)!.status).toBe('pending')
    expect(service.cancelJob(a.id)).toBe(true)
    await wait(() => service.getJob(a.id)!.status === 'cancelled', 60_000)

    const stopped = service.getJob(a.id)!
    expect(stopped.phase).toBe('cancelled')
    // Stopped where the ledger, the counters and the cursor agree.
    expect(stopped.stats.processed % 100).toBe(0)
    expect(stopped.stats.processed).toBeLessThan(600)
    expect(listApplied(db, a.id)).toHaveLength(stopped.stats.applied)
    expect(stopped.cursorSeq).toBeGreaterThan(0)
    expect(stopped.finishedAt).toBeTruthy()

    // …and the queue moves on.
    await finished(b.id)
    expect(service.getJob(b.id)!.status).toBe('completed')
    expect(service.getJob(b.id)!.stats.processed).toBe(600)
  }, 120_000)

  it('answers the cancel route 200 while the job runs, 409 once it is over and 404 for an id nobody has', async () => {
    for (let i = 0; i < 400; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
    const scanId = await scanned('auto')
    const app = new Hono()
    app.use('*', async (c, next) => {
      ;(c as any).set('ability', { can: () => true })
      await next()
    })
    createDataPortRoutes(app, { service } as never)
    const cancel = (id: string) =>
      app.request(`/api/v1/data-port/import/jobs/${id}/cancel`, { method: 'POST' })

    expect((await cancel('no-such-job')).status).toBe(404)

    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: { base: 'all', groups: [], rows: [] },
    })
    await wait(() => service.getJob(job.id)!.stats.processed >= 100, 60_000)
    const res = await cancel(job.id)
    expect(res.status).toBe(200)
    // 200 is "the request was taken", not "the import stopped": the body says
    // which, and the job row says what actually happened.
    expect(await res.json()).toEqual({ ok: true, status: 'running' })
    await wait(() => service.getJob(job.id)!.status === 'cancelled', 60_000)

    // Over is over: a second call is a conflict, not a silent success.
    expect((await cancel(job.id)).status).toBe(409)

    // A QUEUED job really does stop there and then, and the body says so —
    // which is the difference the owner needs from the 200 above.
    const first = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: { base: 'all', groups: [], rows: [] },
    })
    const queued = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: { base: 'all', groups: [], rows: [] },
    })
    expect(service.getJob(queued.id)!.status).toBe('pending')
    expect(await (await cancel(queued.id)).json()).toEqual({ ok: true, status: 'cancelled' })
    await finished(first.id)
    expect(service.getJob(queued.id)!.status).toBe('cancelled')
  }, 120_000)

  it('does not call a run cancelled when the cancel arrived too late to stop anything', async () => {
    // 60 items: fewer than one batch, so the flag can only ever be read at the
    // page boundary — by which time every selected item is in the ledger. The
    // cancel is fired from inside the run, on the fifth write, so there is no
    // race to lose.
    for (let i = 0; i < 60; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
    const scanId = await scanned('auto')
    let jobId = ''
    let writes = 0
    const realWrite = applyHost.memory!.vault!.write
    applyHost.memory!.vault!.write = (path, frontmatter, content) => {
      realWrite(path, frontmatter, content)
      if (++writes === 5 && jobId) service.cancelJob(jobId)
    }

    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: { base: 'all', groups: [], rows: [] },
    })
    jobId = job.id
    await finished(job.id)

    const done = service.getJob(job.id)!
    // Nothing was stopped, so nothing may say it was: a `cancelled` row here
    // would tell the owner their import was interrupted when every item landed.
    expect(done.status).toBe('completed')
    expect(done.phase).toBe('done')
    expect(done.stats).toMatchObject({ processed: 60, applied: 60, errors: 0 })
    expect(listApplied(db, job.id)).toHaveLength(60)
    expect(indexCalls).toBe(1)
  }, 60_000)

  it('counts the rows a purge took out from under it instead of finishing quietly short', async () => {
    for (let i = 0; i < 200; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
    const scanId = await scanned('auto')
    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: { base: 'all', groups: [], rows: [] },
    })
    expect(job.selectionTotal).toBe(200)
    // The drive starts on the next tick, so this lands before the first row is
    // read: half the selection is gone by the time the walk looks for it — a
    // retention purge, or a scan the owner deleted in another tab.
    const cut = (
      db.all(sql`SELECT seq FROM data_port_candidates WHERE scan_id = ${scanId} ORDER BY seq ASC`) as Array<{
        seq: number
      }>
    )[99]!.seq
    db.run(sql`DELETE FROM data_port_candidates WHERE scan_id = ${scanId} AND seq > ${cut}`)

    await finished(job.id)
    const done = service.getJob(job.id)!
    expect(done.status).toBe('completed')
    expect(done.stats.applied).toBe(100)
    // The 100 rows that vanished are reported, not passed over: a green run that
    // touched half of what it promised would tell the owner nothing at all.
    expect(done.stats.errors).toBe(100)
    expect(done.stats.processed).toBe(200)
    expect(done.stats.skippedReasons.error).toBe(100)
  }, 60_000)

  it('closes the job when the set-up throws before the walk begins', async () => {
    put('notes/n.md', '---\ntype: reference\n---\nn\n')
    const scanId = await scanned('auto')
    // `applyDepsFactory` runs after the row already says `running`, and used to
    // sit outside the guard: a throw there left the row running for ever with
    // no error, and the operator with an import stuck at 5 %.
    const broken = createDataPortService({
      db,
      modelCtx: {},
      applyDepsFactory: () => {
        throw new Error('vault directory is not writable')
      },
      dataDir,
      logger,
    })
    const job = broken.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: { base: 'all', groups: [], rows: [] },
    })
    await finished(job.id, broken)
    const done = broken.getJob(job.id)!
    expect(done.status).toBe('failed')
    expect(done.phase).toBe('error')
    expect(done.error).toContain('vault directory is not writable')
    expect(done.finishedAt).toBeTruthy()

    // …and the queue is unharmed.
    const next = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: { base: 'all', groups: [], rows: [] },
    })
    await finished(next.id)
    expect(service.getJob(next.id)!.status).toBe('completed')
  }, 60_000)

  it('closes the job when the database refuses the batch and the recovery too', async () => {
    for (let i = 0; i < 400; i++) put(`notes/n${i}.md`, `---\ntype: reference\n---\nnote ${i}\n`)
    const scanId = await scanned('auto')
    // Locked from the second batch on. The catch's own recovery flush hits the
    // same wall, so this is the case that used to skip the `failed` write
    // entirely and leave the row running with `error: null`.
    let begins = 0
    const origRun = db.run.bind(db)
    db.run = (q: any) => {
      if (sqlText(q).includes('BEGIN IMMEDIATE') && ++begins >= 2) {
        throw new Error('database is locked')
      }
      return origRun(q)
    }
    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: { base: 'all', groups: [], rows: [] },
    })
    await finished(job.id)
    db.run = origRun

    const done = service.getJob(job.id)!
    expect(done.status).toBe('failed')
    expect(done.phase).toBe('error')
    expect(done.error).toMatch(/locked/i)
    expect(done.finishedAt).toBeTruthy()
    // The run closed itself rather than being closed by the queue's backstop:
    // it got as far as rebuilding the index — so what it wrote is still
    // undoable — and wrote its counters and its clock with the failure.
    expect(indexCalls).toBeGreaterThanOrEqual(1)
    expect(done.importMs).toBeGreaterThan(0)
    expect(done.stats.processed).toBeGreaterThan(0)
    // The batch the database refused is on disk with no ledger row behind it.
    // Nothing in the product adopts those items unless this same job runs again,
    // so the count is on the job row rather than only in a log line.
    expect(done.stats.unledgered).toBe(100)
    expect(listApplied(db, job.id)).toHaveLength(done.stats.applied - done.stats.unledgered!)
  }, 120_000)

  it('refuses to cancel a job that has already finished', async () => {
    put('notes/n.md', '# n\n')
    const scanId = await scanned('auto')
    const job = service.createJob({
      scanId,
      sourceProfile: 'auto',
      selection: { base: 'all', groups: [], rows: [] },
    })
    await finished(job.id)
    expect(service.getJob(job.id)!.status).toBe('completed')
    expect(service.cancelJob(job.id)).toBe(false)
    expect(service.cancelJob('no-such-job')).toBe(false)
    expect(service.getJob(job.id)!.status).toBe('completed')
  })
})
