// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'
import { createDataPortService } from '@modules/data-port/service'
import { createDataPortRoutes } from '@modules/data-port/routes'

let root: string
/** Outside the scanned tree: the service creates its own directories under it. */
let dataDir: string
let db: any
let service: ReturnType<typeof createDataPortService>
let app: Hono

const put = (rel: string, body: string | Buffer = '# n'): void => {
  const f = join(root, rel)
  mkdirSync(join(f, '..'), { recursive: true })
  writeFileSync(f, body)
}
const wait = async (done: () => boolean, ms = 20_000): Promise<void> => {
  const t = Date.now()
  while (!done() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 10))
}
const get = (path: string) => app.request(`/api/v1/data-port${path}`)
const post = (path: string, body: unknown) =>
  app.request(`/api/v1/data-port${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dp-routes-'))
  dataDir = mkdtempSync(join(tmpdir(), 'dp-routes-data-'))
  db = createMemoryDb()
  createDataPortTables(db)
  for (let i = 0; i < 30; i++) put(`notes/${i % 2 ? 'alpha' : 'bravo'}/n${i}.md`, `# note ${i}`)
  for (let i = 0; i < 5; i++) put(`GitHub/alpha/src/f${i}.ts`, `export const f${i} = ${i}\n`)
  put('GitHub/alpha/node_modules/m/index.js', 'x')
  put('notes/logo.png', Buffer.from([0x89, 0x50]))
  put('notes/alpha/deep/d.md', '# deep')
  service = createDataPortService({
    db,
    modelCtx: { model: undefined, logger: console } as any,
    applyDepsFactory: () => ({ createProposal: () => 'p', resolveDefaultAgentId: () => null }) as any,
    dataDir,
  })
  app = new Hono()
  app.use('*', async (c, next) => {
    ;(c as any).set('ability', { can: () => true })
    await next()
  })
  createDataPortRoutes(app, { service })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
})

async function scanned(): Promise<string> {
  const res = await post('/import/scan', { path: root, sourceProfile: 'auto' })
  expect(res.status).toBe(202)
  const body = (await res.json()) as any
  // 202 means "the row exists and the walk starts on the next tick" — never a
  // finished scan, whatever the size of the tree (P-9).
  expect(body.status).toBe('running')
  expect(body.candidates).toBeUndefined()
  await wait(() => service.getScan(body.scanId)?.status === 'done')
  expect(service.getScan(body.scanId)?.status).toBe('done')
  return body.scanId
}

describe('scan status and candidates API', () => {
  it('reports the finished scan with counts, stats and no absolute path', async () => {
    const id = await scanned()
    const res = await get(`/import/scans/${id}`)
    const s = (await res.json()) as any
    expect(s.status).toBe('done')
    // 31 notes, 5 source files, one `node_modules` row, one binary.
    expect(s.stats.candidateCount).toBe(38)
    expect(s.counts.total).toBe(38)
    expect(s.stats.scanMs).toBeGreaterThanOrEqual(0)
    expect(s.stats.directoriesMapped).toBeGreaterThan(0)
    expect(s.progress).toBeNull()
    // `rootPath` is the path the owner typed and is a declared field of the
    // summary; nothing ELSE may carry a server path.
    expect(s.rootPath).toBe(root)
    expect(JSON.stringify({ ...s, rootPath: '' })).not.toContain(root)
  })

  it('pages, filters and never leaks the server path', async () => {
    const id = await scanned()
    const all = (await (await get(`/import/scans/${id}/candidates?limit=500`)).json()) as any
    expect(all.items).toHaveLength(38)
    expect(all.total).toBe(38)
    expect(all.items[0]).toHaveProperty('seq')
    expect(all.items[0]).toHaveProperty('folder')
    expect(all.items.every((c: any) => !('sourcePath' in c))).toBe(true)
    expect(JSON.stringify(all)).not.toContain(root)

    expect(
      ((await (await get(`/import/scans/${id}/candidates?limit=5&offset=36`)).json()) as any).items,
    ).toHaveLength(2)
    const kinds = (await (await get(`/import/scans/${id}/candidates?kind=memory,code`)).json()) as any
    expect(kinds.items.every((c: any) => c.kind === 'memory' || c.kind === 'code')).toBe(true)
    expect(kinds.total).toBeGreaterThan(0)

    const sub = (await (await get(`/import/scans/${id}/candidates?folder=notes/alpha`)).json()) as any
    expect(sub.items.some((c: any) => c.relativePath === 'notes/alpha/deep/d.md')).toBe(true)
    const direct = (await (
      await get(`/import/scans/${id}/candidates?folder=notes/alpha&subtree=false`)
    ).json()) as any
    expect(direct.items.some((c: any) => c.relativePath === 'notes/alpha/deep/d.md')).toBe(false)

    expect(
      (
        (await (await get(`/import/scans/${id}/candidates?selected=false`)).json()) as any
      ).items.every((c: any) => !c.selectedByDefault),
    ).toBe(true)
    expect(
      ((await (await get(`/import/scans/${id}/candidates?reason=directory-skipped`)).json()) as any)
        .items,
    ).toHaveLength(1)
    expect(
      (
        (await (await get(`/import/scans/${id}/candidates?q=note 1`)).json()) as any
      ).items.every((c: any) => /note 1/.test(c.title)),
    ).toBe(true)

    for (const bad of ['limit=0', 'limit=5000', 'offset=-1', 'kind=bogus', 'reason=Has Space', 'order=x']) {
      expect((await get(`/import/scans/${id}/candidates?${bad}`)).status).toBe(400)
    }
    expect((await get('/import/scans/nope/candidates')).status).toBe(404)
    expect((await get('/import/scans/nope')).status).toBe(404)
  })

  it('answers counts and a folder tree', async () => {
    const id = await scanned()
    const c = (await (await get(`/import/scans/${id}/counts`)).json()) as any
    expect(c.byKind.reduce((a: number, b: any) => a + b.total, 0)).toBe(c.total)
    // A-23 — the tree is `listDirs`, level by level, never the top-100
    // `byFolder` summary, which would silently hide a folder on a real tree.
    const tree = (await (await get(`/import/scans/${id}/tree?parent=.`)).json()) as any
    expect(tree.dirs.map((d: any) => d.name).sort()).toEqual(['GitHub', 'notes'])
    const gh = (await (await get(`/import/scans/${id}/tree?parent=GitHub/alpha`)).json()) as any
    expect(gh.dirs.find((d: any) => d.name === 'node_modules')).toMatchObject({
      skippedClass: 'node_modules',
      fileCount: 1,
    })
    expect(gh.dirs.find((d: any) => d.name === 'src').subtree.total).toBe(5)
  })

  it('resolves a selection count server-side', async () => {
    const id = await scanned()
    const r = (await (
      await post(`/import/scans/${id}/selection/count`, {
        selection: { base: 'default', groups: [{ folder: 'notes/bravo', selected: false }], rows: [] },
        folders: ['notes/alpha', 'notes/bravo'],
      })
    ).json()) as any
    expect(r.selected).toBe(16)
    expect(r.byFolder['notes/bravo']).toBe(0)
    expect(r.byFolder['notes/alpha']).toBe(16)
    expect(r.byKind.memory).toBe(16)

    // A transport bound on ONE request body, never on what may be selected:
    // bulk gestures are groups, so 5 001 of them is a client bug (P-10).
    expect(
      (
        await post(`/import/scans/${id}/selection/count`, {
          selection: { base: 'all', groups: Array.from({ length: 5001 }, () => ({ selected: true })), rows: [] },
        })
      ).status,
    ).toBe(400)
  })

  it('creates jobs from a wire, from the legacy array, refuses noise-only and a running scan', async () => {
    const id = await scanned()
    const wire = await post('/import/jobs', {
      scanId: id,
      sourceProfile: 'auto',
      selection: { base: 'none', groups: [{ kind: 'memory', selected: true }], rows: [] },
    })
    expect(wire.status).toBe(201)
    const j = ((await wire.json()) as any).job
    expect(j.selectionMode).toBe('wire')
    expect(j.selectionTotal).toBe(31)

    const first = (
      (await (await get(`/import/scans/${id}/candidates?kind=memory&limit=1`)).json()) as any
    ).items[0]
    const legacy = await post('/import/jobs', {
      scanId: id,
      sourceProfile: 'auto',
      selection: [{ candidateId: first.id }],
    })
    expect(legacy.status).toBe(201)
    const legacyJob = ((await legacy.json()) as any).job
    expect(legacyJob.selectionMode).toBe('ids')
    expect(legacyJob.selectionTotal).toBe(1)

    expect(
      (
        await post('/import/jobs', {
          scanId: id,
          sourceProfile: 'auto',
          selection: { base: 'none', groups: [{ kind: 'noise', selected: true }], rows: [] },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await post('/import/jobs', {
          scanId: id,
          sourceProfile: 'auto',
          selection: { base: 'bogus', groups: [], rows: [] },
        })
      ).status,
    ).toBe(400)

    // The drive starts on the next tick and yields at every progress event
    // (500 files), so a 3 000-file tree is still `running` when the job is
    // posted — which is a conflict, not a bad request.
    for (let i = 0; i < 3000; i++) put(`bulk/b${i}.md`, `# b ${i}`)
    const running = (await (await post('/import/scan', { path: root, sourceProfile: 'auto' })).json()) as any
    expect(running.status).toBe('running')
    expect(
      (
        await post('/import/jobs', {
          scanId: running.scanId,
          sourceProfile: 'auto',
          selection: { base: 'all', groups: [], rows: [] },
        })
      ).status,
    ).toBe(409)
    await wait(() => service.getScan(running.scanId)?.status === 'done')
  })

  it('answers 400 for a missing path and a file path before any header is written', async () => {
    expect((await post('/import/scan', { path: join(root, 'nowhere'), sourceProfile: 'auto' })).status).toBe(400)
    put('plain.md', '# p')
    expect((await post('/import/scan', { path: join(root, 'plain.md'), sourceProfile: 'auto' })).status).toBe(400)
    // A generator's own checks run on the first `next()`, which is long after
    // a 202 would have promised a scan — so the path is validated eagerly and
    // a refused one leaves no row behind at all (A-27).
    expect((db.all(sql`SELECT count(*) AS n FROM data_port_scans`) as any[])[0].n).toBe(0)
  })

  it('stores alias paths, duplicates, skill assets and orphan rows through the background drive (P-18)', async () => {
    put('a/x.md', '# same body\n')
    put('b/x.md', '# same body\n')
    put('real/n.md', '# n')
    symlinkSync(join(root, 'real'), join(root, 'link'))
    put('.claude/skills/deploy/.env', 'TOKEN=alphabravocharlie0001\n')
    put('.claude/skills/deploy/SKILL.md', '---\nname: deploy\n---\n# Deploy\n')
    // Two packages that are identical down to their bundled file: one skill row
    // survives with both paths, and the loser's asset becomes a visible orphan.
    put('.claude/skills/alpha/SKILL.md', '# same skill\n')
    put('.claude/skills/alpha/run.sh', 'echo\n')
    put('.claude/skills/bravo/SKILL.md', '# same skill\n')
    put('.claude/skills/bravo/run.sh', 'echo\n')
    const id = await scanned()
    const rows = ((await (await get(`/import/scans/${id}/candidates?limit=500`)).json()) as any)
      .items as any[]
    const by = (rel: string) => rows.find((c) => c.relativePath === rel)

    const xs = rows.filter((c) => /^(a|b)\/x\.md$/.test(c.relativePath))
    expect(xs.find((c) => c.kind !== 'noise')!.paths.sort()).toEqual(['a/x.md', 'b/x.md'])
    expect(xs.find((c) => c.kind === 'noise')).toMatchObject({
      reasonCode: 'duplicate-content',
      importable: false,
    })
    // A symlinked directory reaches rows the drive has already flushed: the
    // alias arrives as an event and is applied by UPDATE, not in memory.
    expect(rows.find((c) => c.relativePath.endsWith('n.md'))!.paths.sort()).toEqual([
      'link/n.md',
      'real/n.md',
    ])
    expect(rows.filter((c) => c.relativePath.endsWith('n.md'))).toHaveLength(1)

    // R11.4 — a credential inside a package is bundled verbatim and tagged.
    const skill = by('.claude/skills/deploy/SKILL.md')
    expect(skill.assets.map((a: any) => a.relPath)).toEqual(['.env'])
    expect(skill.assets[0].containsSecrets).toBe(true)
    expect(skill.tags).toContain('contains-secrets')

    const pkgSkills = rows.filter((c) => c.kind === 'skill' && /skills\/(alpha|bravo)\//.test(c.relativePath))
    expect(pkgSkills).toHaveLength(1)
    const orphans = rows.filter((c) => c.reasonCode === 'orphan-asset')
    expect(orphans).toHaveLength(1)
    expect(orphans[0]!.relativePath.endsWith('/run.sh')).toBe(true)
    // The orphan belongs to the package that LOST the comparison, whichever
    // order the walker happened to reach the two in.
    expect(orphans[0]!.relativePath.startsWith(`${pkgSkills[0]!.relativePath.replace('/SKILL.md', '')}/`)).toBe(false)

    const s = service.getScan(id)!
    expect(s.stats.filesSkipped).toBe(rows.filter((c) => c.kind === 'noise').length)
  })

  it('previews a file by id, cuts on a UTF-8 boundary, refuses unknown ids', async () => {
    put('notes/alpha/u.md', '# é'.repeat(40_000))
    const id = await scanned()
    const row = ((await (await get(`/import/scans/${id}/candidates?q=u.md`)).json()) as any).items[0]
    const p = (await (
      await get(`/import/scans/${id}/candidates/${row.id}/preview?bytes=65536`)
    ).json()) as any
    expect(p.truncated).toBe(true)
    expect(p.head).not.toContain('�')
    expect(Buffer.byteLength(p.head)).toBeLessThanOrEqual(65_536)
    expect(p.candidate).not.toHaveProperty('sourcePath')
    expect((await get(`/import/scans/${id}/candidates/nope/preview`)).status).toBe(404)

    const dir = ((await (await get(`/import/scans/${id}/candidates?reason=directory-skipped`)).json()) as any)
      .items[0]
    expect(
      ((await (await get(`/import/scans/${id}/candidates/${dir.id}/preview`)).json()) as any).children,
    ).toContain('m')
  })

  /**
   * SQLite's `substr`/`instr` count CHARACTERS; JavaScript's `String.length`
   * counts UTF-16 code units. Every place a JS length was used as a SQL offset
   * was off by one per astral character — a single emoji in a folder name ate
   * the separator out of an alias path and blanked the wizard's tree under
   * that folder. The names below cover a plain path, a two-byte BMP character
   * (which would break a BYTE offset), a combining mark (two code points, two
   * UTF-16 units) and two astral characters (one code point, two UTF-16 units).
   */
  describe('non-ASCII folder names', () => {
    const NAMES = ['plain', 'café', 'édir', 'zz\u{1F600}dir', '\u{2000B}cjk']

    /** A name a filesystem may refuse; asserted only where it was created. */
    const oddball = 'cr\rdir'

    const build = (): string[] => {
      const made: string[] = []
      NAMES.forEach((n, i) => {
        put(`${n}/sub/one.md`, `# marker${i} one\n`)
        put(`${n}/two.md`, `# marker${i} two\n`)
        symlinkSync(join(root, n), join(root, `link-${n}`))
        made.push(n)
      })
      try {
        put(`${oddball}/sub/one.md`, `# markerCR one\n`)
        put(`${oddball}/two.md`, `# markerCR two\n`)
        symlinkSync(join(root, oddball), join(root, `link-${oddball}`))
        made.push(oddball)
      } catch {
        /* the filesystem refused the name; the other five still prove the fix */
      }
      return made
    }

    it('keeps the separator in an alias path, whatever the name is made of', async () => {
      const made = build()
      const id = await scanned()
      const rows = ((await (await get(`/import/scans/${id}/candidates?limit=500`)).json()) as any)
        .items as any[]
      for (let i = 0; i < made.length; i++) {
        const title = made[i] === oddball ? 'markerCR one' : `marker${i} one`
        const row = rows.find((c) => c.title === title)
        expect(row, `no row for ${title}`).toBeTruthy()
        // Whichever of the two paths the walker reached first carries the row;
        // the other must be exactly the same path with `link-` in front. The
        // defect ate the separator, so the alias came back as `link-plainsub`
        // rather than `link-plain/sub/one.md`.
        const paths = (row.paths as string[]).slice().sort()
        expect(paths, title).toHaveLength(2)
        const real = paths.find((x) => !x.startsWith('link-'))!
        const alias = paths.find((x) => x.startsWith('link-'))!
        expect(real.endsWith('/sub/one.md'), real).toBe(true)
        expect(alias).toBe(`link-${real}`)
      }
    })

    it('counts the subtree of every child, whatever the parent is made of', async () => {
      const made = build()
      const id = await scanned()
      const rows = ((await (await get(`/import/scans/${id}/candidates?limit=500`)).json()) as any)
        .items as any[]
      for (let i = 0; i < made.length; i++) {
        const title = made[i] === oddball ? 'markerCR one' : `marker${i} one`
        // `relativePath` is the path the walker actually entered, which is what
        // the `folder` column and the directory rows are both keyed on; its
        // twin is recorded as an alias and holds no children of its own.
        const folder = rows.find((c) => c.title === title)!.relativePath.split('/')[0]
        const tree = (await (
          await get(`/import/scans/${id}/tree?parent=${encodeURIComponent(folder)}`)
        ).json()) as any
        // Before the fix this was 0 for every astral name: the aggregate's
        // segment came out one character short and joined to no child.
        expect(tree.dirs.find((d: any) => d.name === 'sub')?.subtree.total, folder).toBe(1)
        expect(tree.files.total, folder).toBe(1)
      }
    })
  })

  it('patches an alias onto a row the drive has already flushed', async () => {
    // More than one flush (SCAN_FLUSH_ROWS is 500), with the alias reached in a
    // directory that sorts after the filler: the patch lands as an UPDATE on a
    // row that is no longer in memory.
    put('aaa-real/n.md', '# the real one\n')
    for (let i = 0; i < 1200; i++) put(`mmm/f${String(i).padStart(4, '0')}.md`, `# filler ${i}\n`)
    symlinkSync(join(root, 'aaa-real', 'n.md'), join(root, 'zzz-alias.md'))
    const id = await scanned()
    const s = service.getScan(id)!
    expect(s.stats.candidateCount).toBeGreaterThan(500)
    const rows = service.listCandidates(id, { q: 'the real one' }, { offset: 0, limit: 500, order: 'seq' }).items
    expect(rows).toHaveLength(1)
    expect(rows[0]!.paths?.slice().sort()).toEqual(['aaa-real/n.md', 'zzz-alias.md'])
  })

  /*
   * A-87. This required the pair to come back exactly `[200, 409]`, which needs
   * the second request to arrive while the first is still walking — and whether
   * that happens is the SCHEDULER's decision, not the test's. It flaked 2 runs
   * in 5 on a loaded machine, and this is A-49(c), recorded earlier in the wave
   * as "unreproduced in twelve runs": twelve runs on an idle machine said
   * nothing about the test, only about the machine.
   *
   * What actually matters is the invariant, which holds however the scheduler
   * orders them: concurrent counts never disagree and never fail. A supersede
   * answers 409 — a conflict the client caused by asking again — and never a 5xx
   * that observability counts as a server error and clients retry into. Whether
   * the supersede happens on any given run is not something to assert.
   */
  it('answers concurrent selection counts consistently, with a supersede as a conflict and never a 5xx', async () => {
    // The walk only yields between batches of SELECTION_SCAN_BATCH (5 000), so a
    // supersede is only REACHABLE on a tree bigger than the batch.
    for (let i = 0; i < 6000; i++) put(`bulk/b${i}.md`, `# b ${i}`)
    const id = await scanned()
    const total = service.countCandidates(id, {})
    expect(total).toBeGreaterThan(5000)
    const body = { selection: { base: 'all', groups: [], rows: [] } }

    /*
     * A-88. The reference is the same selection counted with nothing competing
     * for it. Comparing the concurrent answers only with EACH OTHER was vacuous
     * in the branch this case is named for: when a supersede happens there is
     * exactly one 200, and one answer always agrees with itself. A supersede
     * that returned a truncated count would have sat inside the old bounds and
     * passed.
     *
     * It is also the comparison the first version of this case reached for and
     * got wrong — it used the ROW total, and `base: 'all'` selects the importable
     * rows, so the binary and class-directory rows made it fail at 6 036 against
     * 6 038. The quantity was wrong, not the idea.
     */
    const uncontended = await post(`/import/scans/${id}/selection/count`, body)
    expect(uncontended.status).toBe(200)
    const expected = ((await uncontended.json()) as { selected: number }).selected
    expect(expected).toBeGreaterThan(5000)
    expect(expected).toBeLessThanOrEqual(total)
    // The reference is itself pinned, by a DIFFERENT computation: `base: 'all'`
    // selects every importable row, and that count comes from SQL rather than
    // from the resolver's row-by-row walk. Without this, a truncation affecting
    // every call would agree with itself and pass — the reference would be as
    // wrong as the answers it is checking.
    expect(expected).toBe(service.countCandidates(id, { importable: true }))

    const responses = await Promise.all([
      post(`/import/scans/${id}/selection/count`, body),
      post(`/import/scans/${id}/selection/count`, body),
    ])

    // Every outcome is either the answer or the conflict — never a server error.
    for (const r of responses) expect([200, 409]).toContain(r.status)
    // At least one caller is always answered: a pair of requests cannot both lose.
    const answered = responses.filter((r) => r.status === 200)
    expect(answered.length).toBeGreaterThanOrEqual(1)
    // …and every answer is the WHOLE answer, whichever branch the scheduler took.
    for (const r of answered) {
      expect(((await r.json()) as { selected: number }).selected).toBe(expected)
    }
  })

  it('refuses to purge a scan a running import is still reading from', async () => {
    const id = await scanned()
    const now = new Date().toISOString()
    db.run(sql`INSERT INTO data_port_jobs
      (id, status, source_profile, scan_id, selection_json, phase, progress, stats_json, error,
       instructions, enrich, created_at, updated_at, finished_at)
      VALUES ('job-1', 'running', 'auto', ${id}, '[]', 'apply', 0.5, '{}', NULL, NULL, 0, ${now}, ${now}, NULL)`)

    const refused = await app.request(`/api/v1/data-port/import/scans/${id}`, { method: 'DELETE' })
    expect(refused.status).toBe(409)
    // Task 12's runner walks these rows by keyset while the job runs: purging
    // them would truncate the import and still report it completed.
    expect(service.countCandidates(id, {})).toBe(38)

    db.run(sql`UPDATE data_port_jobs SET status = 'completed' WHERE id = 'job-1'`)
    expect((await app.request(`/api/v1/data-port/import/scans/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect(service.countCandidates(id, {})).toBe(0)
  })

  it('tells a locked database apart from a scan an import is using', async () => {
    const id = await scanned()
    const broken = new Hono()
    broken.use('*', async (c, next) => {
      ;(c as any).set('ability', { can: () => true })
      await next()
    })
    // Everything else answers normally, so the route reaches `cancelScan` and
    // the failure is the only thing under test.
    createDataPortRoutes(broken, {
      service: {
        ...service,
        cancelScan: () => {
          throw new Error('database is locked')
        },
      } as any,
    })
    const res = await broken.request(`/api/v1/data-port/import/scans/${id}`, { method: 'DELETE' })
    // A 409 here would tell the operator to wait for an import that does not exist.
    expect(res.status).toBe(500)
    expect(((await res.json()) as any).error).toBe('database is locked')
  })

  /*
   * A-53. The retention sweep that trims old scans runs inside `finishScan` and
   * is deliberately fail-soft: failing the scan the owner asked for in order to
   * report a tidy-up would be the wrong bargain. But a log line is not a channel
   * anyone reads, and a sweep that fails does so on EVERY scan while the table
   * keeps rows it should have dropped — hundreds of thousands per scan of a
   * whole home directory. So it says so where the wizard already looks.
   */
  it('says out loud when the retention sweep fails, and finishes the scan anyway', async () => {
    // A real failure, not a stub: the sweep's own DELETE is refused.
    db.run(sql`CREATE TRIGGER dp_prune_fail BEFORE DELETE ON data_port_candidates
      BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END`)
    // The sweep keeps the newest ten scans AND everything inside the retention
    // window, so a victim has to be both old and pushed out of that ten. Eleven
    // rows dated 2020, and the oldest is the one it will try to drop.
    for (let i = 0; i < 11; i++) {
      db.run(sql`INSERT INTO data_port_scans
        (id, source_profile, detected_profile, root_path, candidates_json, stats_json, warnings_json,
         instructions, created_at, status, progress_json, format, candidate_count)
        VALUES (${`old-scan-${i}`}, 'auto', 'generic-md', '/x', '[]', '{}', '[]', NULL,
                ${`2020-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`}, 'done', NULL, 2, 1)`)
    }
    db.run(sql`INSERT INTO data_port_candidates
      (scan_id, id, seq, relative_path, folder, depth, kind, target, importable, title, preview,
       bytes, confidence, reason, reason_code, reason_prefix, selected_by_default, search_text)
      VALUES ('old-scan-0', 'old-row', 1, 'a.md', '.', 0, 'memory', 'semantic', 1, 'A', '',
              1, 1.0, 'a note', 'memory-note', 'memory-note', 1, 'a.md a')`)

    const id = await scanned()
    const s = service.getScan(id)!
    // The scan itself succeeded — the tidy-up is not the deliverable.
    expect(s.status).toBe('done')
    expect(s.stats.candidateCount).toBeGreaterThan(0)
    // …and the failure reached the owner, in the channel the wizard renders,
    // carrying the reason rather than the statement (A-50).
    const warning = s.warnings.find((w) => w.code === 'retention-sweep-failed')
    expect(warning, JSON.stringify(s.warnings)).toBeTruthy()
    expect(JSON.stringify(warning!.params)).toContain('disk I/O error')
    expect(JSON.stringify(warning)).not.toContain('DELETE FROM')

    // It is in the STORED header, not only in the object this call returned:
    // the sweep used to run after `warnings_json` was written, so a warning
    // raised there could never have been persisted at all.
    const stored = (
      db.all(sql`SELECT warnings_json FROM data_port_scans WHERE id = ${id}`) as Array<{ warnings_json: string }>
    )[0]!.warnings_json
    expect(stored).toContain('retention-sweep-failed')

    db.run(sql`DROP TRIGGER dp_prune_fail`)
  })

  it('reports what a scan wrote when it dies before the first progress tick', async () => {
    // One container that expands to 700 rows: the drive flushes at 500 rows
    // long before the walker's first tick at 500 FILES, so the walker's
    // counters are still zero when the failure lands.
    writeFileSync(
      join(root, 'conversations.json'),
      JSON.stringify(
        Array.from({ length: 700 }, (_, i) => ({
          uuid: `chat-${i}`,
          name: `Chat ${i}`,
          created_at: '2026-01-02T10:00:00Z',
          chat_messages: [
            { sender: 'human', text: `question ${i}`, created_at: '2026-01-02T10:00:00Z' },
            { sender: 'assistant', text: `answer ${i}`, created_at: '2026-01-02T10:00:01Z' },
          ],
        })),
      ),
    )
    // The database itself refuses the 501st row, so the first flush commits and
    // the second is rolled back — a real mid-drive failure, no stubbing.
    db.run(sql`CREATE TRIGGER dp_fail BEFORE INSERT ON data_port_candidates
      WHEN (SELECT count(*) FROM data_port_candidates) >= 500
      BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END`)

    const summary = service.scanPath('auto', root)
    await wait(() => service.getScan(summary.scanId)?.status === 'failed')
    const s = service.getScan(summary.scanId)!
    expect(s.status).toBe('failed')
    expect(s.warnings[0]).toMatchObject({ code: 'scan-failed' })
    // Everything mapped before the failure stays listed…
    expect(s.stats.candidateCount).toBe(500)
    expect(service.countCandidates(summary.scanId, {})).toBe(500)
    // …and the stats block says so, instead of reporting a scan that saw
    // nothing beside 500 rows it plainly wrote.
    expect(s.stats.filesScanned).toBeGreaterThanOrEqual(500)
    // Both numbers come from what reached the table, because no tick ever
    // arrived to report anything else: 500 rows written, no directory row yet.
    // The stats therefore never claim more than the scan can show for.
    // N-3 — the warning must say WHY, not quote the statement. drizzle wraps a
    // driver error as `Failed to run the query '<the whole prepared
    // statement>'` and hides the reason on `.cause`, so `err.message` alone
    // stored 61 414 bytes of `?` placeholders here with the words "disk I/O
    // error" nowhere in it, and handed the lot to the wizard on every poll.
    const stored = (
      db.all(sql`SELECT warnings_json FROM data_port_scans WHERE id = ${summary.scanId}`) as Array<{
        warnings_json: string
      }>
    )[0]!.warnings_json
    expect(stored).toContain('disk I/O error')
    expect(stored).not.toContain('INSERT INTO')
    expect(stored).not.toContain('?, ?')
    expect(Buffer.byteLength(stored)).toBeLessThan(1000)
    expect(s.warnings[0]!.message).toContain('disk I/O error')
    expect((s.warnings[0]!.params as any).detail).toBe('disk I/O error')
    expect(s.stats.dirsVisited).toBe(s.stats.directoriesMapped)
    expect(s.stats.totalBytes).toBeGreaterThan(0)
    expect(s.stats.scanMs).toBeGreaterThanOrEqual(0)
    expect(s.progress).toBeNull()
    db.run(sql`DROP TRIGGER dp_fail`)
  })

  it('answers a failing scan with the reason, not the statement (N-5)', async () => {
    // The header INSERT itself fails, so the route's own error path is the only
    // thing between the driver and the operator.
    db.run(sql`CREATE TRIGGER dp_header_fail BEFORE INSERT ON data_port_scans
      BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END`)
    const res = await post('/import/scan', { path: root, sourceProfile: 'auto' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as any
    expect(body.error).toBe('disk I/O error')
    expect(body.error).not.toContain('INSERT INTO')
    db.run(sql`DROP TRIGGER dp_header_fail`)
  })

  it('keeps a cause that contains the separator whole (N-4)', async () => {
    const id = await scanned()
    // SQLite says things like `constraint failed | column x | table y`. Reading
    // the innermost link off a JOINED chain would have stored only `table y`.
    const inner = 'constraint failed | column alpha | table bravo'
    const broken = new Hono()
    broken.use('*', async (c, next) => {
      ;(c as any).set('ability', { can: () => true })
      await next()
    })
    createDataPortRoutes(broken, {
      service: {
        ...service,
        cancelScan: () => {
          throw new Error("Failed to run the query 'DELETE FROM data_port_candidates WHERE …'", {
            cause: new Error(inner),
          })
        },
      } as any,
    })
    const res = await broken.request(`/api/v1/data-port/import/scans/${id}`, { method: 'DELETE' })
    expect(res.status).toBe(500)
    const body = (await res.json()) as any
    expect(body.error).toBe(inner)
    expect(body.error).not.toContain('DELETE FROM')
  })

  it('survives an error whose cause refuses to be read (N-7)', async () => {
    const id = await scanned()
    // `message` and `cause` are accessors an error may define however it likes,
    // and every caller of the reason helper is a catch block. A throw out of it
    // inside the scan drive's own catch would escape the drive and leave the
    // scan `running` for ever, with nothing at startup to close it.
    const hostile = new Error('outer failure')
    Object.defineProperty(hostile, 'cause', {
      get() {
        throw new Error('this accessor is hostile')
      },
    })
    const broken = new Hono()
    broken.use('*', async (c, next) => {
      ;(c as any).set('ability', { can: () => true })
      await next()
    })
    createDataPortRoutes(broken, {
      service: {
        ...service,
        cancelScan: () => {
          throw hostile
        },
      } as any,
    })
    const res = await broken.request(`/api/v1/data-port/import/scans/${id}`, { method: 'DELETE' })
    // Answered, not crashed: what was reached before the hostile link.
    expect(res.status).toBe(500)
    expect(((await res.json()) as any).error).toBe('outer failure')
  })

  it('filters on importable, which the schema accepts rather than strips (A-47)', async () => {
    const id = await scanned()
    const yes = (await (await get(`/import/scans/${id}/candidates?importable=true&limit=500`)).json()) as any
    const no = (await (await get(`/import/scans/${id}/candidates?importable=false&limit=500`)).json()) as any
    expect(yes.items.every((c: any) => c.importable)).toBe(true)
    expect(no.items.every((c: any) => !c.importable)).toBe(true)
    // Stripped in silence, the two answers would have been identical.
    expect(yes.total + no.total).toBe(38)
    expect(no.total).toBe(2)
    expect((await get(`/import/scans/${id}/candidates?importable=maybe`)).status).toBe(400)
  })

  it('cancels a running scan and purges its rows', async () => {
    for (let i = 0; i < 3000; i++) put(`bulk/b${i}.md`, `# b ${i}`)
    const s = (await (await post('/import/scan', { path: root, sourceProfile: 'auto' })).json()) as any
    expect(
      (await app.request(`/api/v1/data-port/import/scans/${s.scanId}`, { method: 'DELETE' })).status,
    ).toBe(200)
    await wait(() => ['cancelled', 'done'].includes(service.getScan(s.scanId)?.status ?? ''))
    expect(service.getScan(s.scanId)?.status).toBe('cancelled')
    expect(service.countCandidates(s.scanId, {})).toBe(0)
  })

  it('purges a finished scan on DELETE too', async () => {
    const id = await scanned()
    expect(service.countCandidates(id, {})).toBe(38)
    expect((await app.request(`/api/v1/data-port/import/scans/${id}`, { method: 'DELETE' })).status).toBe(200)
    expect(service.countCandidates(id, {})).toBe(0)
    expect(service.getScan(id)).toMatchObject({
      status: 'cancelled',
      stats: expect.objectContaining({ candidateCount: 0 }),
    })
    expect((await app.request(`/api/v1/data-port/import/scans/nope`, { method: 'DELETE' })).status).toBe(404)
  })
})
