// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// P-11 — the preview reads `source_path` off the stored row and answers with
// the file's first bytes. Secrets come back VERBATIM: D-7 is a rule about what
// a model may recall, not about the owner reading their own file before they
// decide whether to import it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMemoryDb } from '../../helpers/test-db'
import { createDataPortTables } from '@modules/data-port/schema'
import { createDataPortService } from '@modules/data-port/service'

/**
 * Every path the module actually opens or reads, recorded by a PASS-THROUGH
 * mock — the same mechanism `scan-stream.test.ts` uses. A-79 is a claim about
 * whether a read HAPPENS, and only watching the call can settle that: the
 * obvious filesystem-side check does not work, because a sparse file's blocks
 * stay at zero however much of it you read (measured: 0 before, 0 after a
 * 64 KiB read, 0 after reading the whole 4 MB).
 */
const fsCalls = vi.hoisted(() => ({ read: [] as string[], open: [] as string[] }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    default: actual,
    readFileSync: (path: unknown, ...rest: unknown[]) => {
      fsCalls.read.push(String(path))
      return (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...rest)
    },
    openSync: (path: unknown, ...rest: unknown[]) => {
      fsCalls.open.push(String(path))
      return (actual.openSync as (...a: unknown[]) => unknown)(path, ...rest)
    },
  }
})

const KEY = 'OPENAI_API_KEY=sk-alphabravocharliealphabravo\n'

let root: string
let dataDir: string
let db: any
let service: ReturnType<typeof createDataPortService>

const put = (rel: string, body: string | Buffer): void => {
  const f = join(root, rel)
  mkdirSync(join(f, '..'), { recursive: true })
  writeFileSync(f, body)
}
const wait = async (done: () => boolean, ms = 20_000): Promise<void> => {
  const t = Date.now()
  while (!done() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 10))
}

/** The row whose path ends in `suffix`, whatever the scan's emission order. */
const rowFor = (scanId: string, suffix: string) => {
  const page = service.listCandidates(scanId, {}, { offset: 0, limit: 500, order: 'seq' })
  const found = page.items.find((c) => c.relativePath.endsWith(suffix))
  if (!found) throw new Error(`no row for ${suffix} in ${page.items.map((c) => c.relativePath).join(', ')}`)
  return found
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dp-preview-'))
  dataDir = mkdtempSync(join(tmpdir(), 'dp-preview-data-'))
  db = createMemoryDb()
  createDataPortTables(db)
  put('ai-memory/alpha_note.md', '---\nname: alpha_note\ntype: reference\n---\nA short note.\n')
  put('assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
  put('.env', KEY)
  put('ai-memory/long.md', '# é'.repeat(40_000))
  service = createDataPortService({
    db,
    modelCtx: { model: undefined, logger: console } as any,
    applyDepsFactory: () => ({ createProposal: () => 'p', resolveDefaultAgentId: () => null }) as any,
    dataDir,
  })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
})

const scanned = async (): Promise<string> => {
  const summary = service.scanPath('auto', root)
  await wait(() => service.getScan(summary.scanId)?.status === 'done')
  return summary.scanId
}

describe('candidate preview', () => {
  /*
   * A-79. A `not-downloaded` row tells the owner the bytes are not on this
   * machine, and the natural next gesture is to click it to see what it is.
   * Reading it here would make the provider fetch the whole file — the label
   * made a lie by the one gesture it invites, and A-66's hazard arriving one row
   * at a time. Inspection never fetches; ticking is the gesture that does.
   */
  it('does not fetch a file whose bytes are not on this machine', async () => {
    const held = join(root, 'ai-memory', 'held.md')
    const fd = openSync(held, 'w')
    ftruncateSync(fd, 4_000_000)
    closeSync(fd)

    const scanId = await scanned()
    const row = rowFor(scanId, 'ai-memory/held.md')
    expect(row.reasonCode).toBe('not-downloaded')

    // Cleared AFTER the scan, so what follows is the preview's own doing.
    fsCalls.read.length = 0
    fsCalls.open.length = 0

    const p = service.preview(scanId, row.id)!
    expect(p.encoding).toBe('not-downloaded')
    expect(p.head).toBeNull()
    expect(p.bytes).toBe(0)
    // The size still comes from the stored row, so the panel can say how big it is.
    expect(p.size).toBe(4_000_000)

    // What settles it: the file was never opened or read. On a real provider
    // that open is the download, and it is the CALL that has to be absent —
    // a filesystem-side check cannot see it, because reading a hole allocates
    // nothing and the blocks stay at zero either way.
    expect(fsCalls.open.filter((x) => x.endsWith('held.md'))).toEqual([])
    expect(fsCalls.read.filter((x) => x.endsWith('held.md'))).toEqual([])

    // A local file in the same scan still previews normally — so this is a
    // discrimination, and the recorder demonstrably does catch a real read.
    const local = service.preview(scanId, rowFor(scanId, 'ai-memory/alpha_note.md').id)!
    expect(local.encoding).toBe('utf-8')
    expect(local.head).toContain('A short note.')
    expect(fsCalls.open.some((x) => x.endsWith('alpha_note.md'))).toBe(true)
  })

  it('reads a text file, keeps its frontmatter and says it is complete', async () => {
    const id = await scanned()
    const row = rowFor(id, 'alpha_note.md')
    const p = service.preview(id, row.id, 65_536)!
    expect(p.encoding).toBe('utf-8')
    expect(p.head).toContain('A short note.')
    expect(p.truncated).toBe(false)
    expect(p.frontmatter).toMatchObject({ name: 'alpha_note', type: 'reference' })
    // The absolute path stays on the stored row and never travels.
    expect(p.candidate).not.toHaveProperty('sourcePath')
    expect(JSON.stringify(p.candidate)).not.toContain(root)
  })

  it('never reads a binary row — it answers what it is instead', async () => {
    const id = await scanned()
    const row = rowFor(id, 'logo.png')
    expect(row.reasonCode).toBe('binary')
    // A-83: "never reads" is a claim about a CALL, so it is settled by watching
    // the call — the same instrument as the case above, not the return value.
    // A return value cannot tell you whether the file was opened on the way.
    fsCalls.read.length = 0
    fsCalls.open.length = 0
    const p = service.preview(id, row.id)!
    expect(p.encoding).toBe('binary')
    expect(p.head).toBeNull()
    expect(p.truncated).toBe(false)
    expect(fsCalls.open.filter((x) => x.endsWith('logo.png'))).toEqual([])
    expect(fsCalls.read.filter((x) => x.endsWith('logo.png'))).toEqual([])
  })

  it('returns a credential verbatim, tagged, so the owner can see what they are importing', async () => {
    const id = await scanned()
    const row = rowFor(id, '.env')
    expect(row.tags).toContain('contains-secrets')
    const p = service.preview(id, row.id)!
    expect(p.encoding).toBe('utf-8')
    // Verbatim: not masked, not refused. The recall gate is elsewhere (D-7).
    expect(p.head).toBe(KEY)
    expect(p.candidate.tags).toContain('contains-secrets')
  })

  it('cuts a long file on a UTF-8 boundary and says it was cut', async () => {
    const id = await scanned()
    const row = rowFor(id, 'long.md')
    for (const bytes of [1024, 2049, 65_536]) {
      const p = service.preview(id, row.id, bytes)!
      expect(p.head).not.toContain('�')
      expect(Buffer.byteLength(p.head!)).toBeLessThanOrEqual(bytes)
      expect(p.truncated).toBe(true)
      expect(p.size).toBe(160_000)
    }
  })

  it('answers null for an id this scan does not hold, and for another scan\'s id', async () => {
    const id = await scanned()
    const other = await scanned()
    const row = rowFor(other, 'alpha_note.md')
    expect(service.preview(id, 'no-such-id')).toBeNull()
    // Ids are minted per scan, so one scan must never answer for another's row.
    expect(service.preview(id, row.id)).toBeNull()
    expect(service.preview('no-such-scan', row.id)).toBeNull()
  })

  it('says a file that vanished after the scan is unreadable instead of throwing', async () => {
    const id = await scanned()
    const row = rowFor(id, 'alpha_note.md')
    rmSync(join(root, 'ai-memory', 'alpha_note.md'))
    const p = service.preview(id, row.id)!
    expect(p.encoding).toBe('unreadable')
    expect(p.head).toBeNull()
    expect(p.error).toBeTruthy()
  })
})
