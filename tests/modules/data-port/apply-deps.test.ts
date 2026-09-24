// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * The production wiring, not a look-alike. Every function under test here is the
 * one `onStart` hands the importer, run against the REAL skills and memory
 * schemas and a real temp directory — so a change to how `capabilities` or
 * `tags` are stored, or to the asset-path wall, fails a test instead of quietly
 * re-importing everything on every run.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { sql } from 'drizzle-orm'
import { createMemoryDb } from '../../helpers/test-db'
import { buildApplyDeps, type ApplyDepsHost } from '@modules/data-port/apply-deps'
import { createDataPortTables } from '@modules/data-port/schema'
import { recordApplied } from '@modules/data-port/ledger'
import { skillsModule } from '@modules/skills/index'
import { createMemoryTables } from '@modules/memory/schema'
import { createEpisodicMemoryService } from '@modules/memory/tiers/episodic-memory'
import type { ApplyDeps } from '@modules/data-port/pipeline/apply'

const logger = { debug() {}, info() {}, warn() {}, error() {} }

describe('data-port production apply deps', () => {
  let db: any
  let dataDir: string
  let deps: ApplyDeps
  let loader: any
  let episodic: ReturnType<typeof createEpisodicMemoryService>

  beforeEach(async () => {
    db = createMemoryDb()
    dataDir = join(tmpdir(), `eyas-deps-${process.pid}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dataDir, { recursive: true })

    // The real skills schema and the real loader, straight from the module.
    const skillsCtx: any = { db, logger, config: {} }
    await skillsModule.onRegister!(skillsCtx)
    loader = skillsCtx.skills.loader
    // The real episodic schema and service, and the real ledger the idempotency
    // lookup consults first.
    createMemoryTables(db)
    createDataPortTables(db)
    episodic = createEpisodicMemoryService(db, {})

    const host: ApplyDepsHost = {
      db,
      logger,
      memory: { episodic: { create: (input) => episodic.create(input as any) } },
      skills: { loader },
    }
    deps = buildApplyDeps({
      host,
      dataDir,
      createProposal: () => 'proposal-1',
      readWorkspaceFile: () => null,
      resolveDefaultAgentId: () => null,
    })
  })

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
  })

  describe('findByContentSha', () => {
    it('finds a user skill by the content-sha capability the importer wrote', () => {
      const created = loader.create({
        name: 'alpha-deploy',
        content: '# Alpha deploy',
        capabilities: ['imported', 'content-sha:aaa111', 'source:claude-code'],
      })
      expect(deps.skills!.findByContentSha!('aaa111')).toEqual({
        id: created.id,
        capabilities: ['imported', 'content-sha:aaa111', 'source:claude-code'],
      })
    })

    it('does not match a different hash, or one that is only a prefix of a stored hash', () => {
      loader.create({ name: 'alpha-deploy', content: 'body', capabilities: ['content-sha:aaa111'] })
      expect(deps.skills!.findByContentSha!('bbb222')).toBeNull()
      // The quoted match is what makes this a miss: an unquoted LIKE would hit.
      expect(deps.skills!.findByContentSha!('aaa')).toBeNull()
    })

    it('ignores a shipped skill — an import never claims one as its own earlier work', () => {
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO skills (id, name, description, category, trigger_patterns, capabilities, content, skill_type, source, enabled, created_at, updated_at)
        VALUES ('bundled-1', 'bundled', '', 'own', '[]', ${JSON.stringify(['content-sha:ccc333'])}, 'body', 'knowledge', 'seed', 1, ${now}, ${now})`)
      expect(deps.skills!.findByContentSha!('ccc333')).toBeNull()
    })
  })

  describe('findByName', () => {
    it('returns the user-owned row with its body and capabilities, so apply can compare', () => {
      const created = loader.create({
        name: 'alpha-deploy',
        content: '# Body',
        capabilities: ['imported', 'import-job:job-3'],
      })
      expect(deps.skills!.findByName!('alpha-deploy')).toMatchObject({
        id: created.id,
        content: '# Body',
        capabilities: expect.arrayContaining(['import-job:job-3']),
      })
      expect(deps.skills!.findByName!('nothing-here')).toBeNull()
    })
  })

  describe('skills.restamp', () => {
    it('rewrites the body and the content-sha, keeping every other capability', () => {
      const created = loader.create({
        name: 'alpha-deploy',
        content: '# Old body',
        capabilities: ['imported', 'content-sha:stale', 'import-job:old', 'kept-by-hand'],
      })
      deps.skills!.restamp!(created.id, {
        content: '# New body\n',
        sha: 'fresh',
        addCapabilities: ['contains-secrets'],
      })
      const after = loader.get(created.id)!
      expect(after.content).toBe('# New body\n')
      expect(after.capabilities).toContain('content-sha:fresh')
      expect(after.capabilities).not.toContain('content-sha:stale')
      expect(after.capabilities).toEqual(
        expect.arrayContaining(['imported', 'import-job:old', 'kept-by-hand', 'contains-secrets']),
      )
    })

    it('never touches a shipped skill', () => {
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO skills (id, name, description, category, trigger_patterns, capabilities, content, skill_type, source, enabled, created_at, updated_at)
        VALUES ('bundled-2', 'bundled', '', 'own', '[]', '[]', 'shipped body', 'knowledge', 'seed', 1, ${now}, ${now})`)
      deps.skills!.restamp!('bundled-2', { content: 'overwritten', sha: 'x', addCapabilities: [] })
      const row = (db.all(sql`SELECT content FROM skills WHERE id = 'bundled-2'`) as Array<{ content: string }>)[0]
      expect(row.content).toBe('shipped body')
    })
  })

  describe('writeAssets', () => {
    it('writes a nested file as bytes and applies its mode', () => {
      const dir = deps.skills!.writeAssets!('alpha-deploy-abc12345', [
        { relPath: 'scripts/run.sh', content: '#!/bin/sh\necho ship\n', mode: 0o755 },
        { relPath: 'data/blob.bin', content: Buffer.from([0, 1, 2, 250]), binary: true },
      ])
      expect(dir).toBe(resolve(dataDir, 'skills', 'imported', 'alpha-deploy-abc12345'))
      expect(readFileSync(join(dir, 'scripts', 'run.sh'), 'utf-8')).toBe('#!/bin/sh\necho ship\n')
      expect(statSync(join(dir, 'scripts', 'run.sh')).mode & 0o777).toBe(0o755)
      // A Buffer must survive byte for byte, not go through utf-8.
      expect([...readFileSync(join(dir, 'data', 'blob.bin'))]).toEqual([0, 1, 2, 250])
    })

    it('re-applies the mode when the file already exists', () => {
      const assets = [{ relPath: 'run.sh', content: 'echo one\n', mode: 0o600 }]
      const dir = deps.skills!.writeAssets!('alpha-pkg', assets)
      expect(statSync(join(dir, 'run.sh')).mode & 0o777).toBe(0o600)
      // writeFileSync honours `mode` only on creation, so an overwrite would
      // otherwise leave the first run's permissions standing.
      deps.skills!.writeAssets!('alpha-pkg', [{ relPath: 'run.sh', content: 'echo two\n', mode: 0o755 }])
      expect(statSync(join(dir, 'run.sh')).mode & 0o777).toBe(0o755)
      expect(readFileSync(join(dir, 'run.sh'), 'utf-8')).toBe('echo two\n')
    })

    it('drops a path that resolves outside the asset directory, and keeps the rest', () => {
      const dir = deps.skills!.writeAssets!('alpha-pkg', [
        { relPath: '../escaped.sh', content: 'nope' },
        { relPath: '../../further/escaped.sh', content: 'nope' },
        { relPath: 'kept.sh', content: 'yes' },
      ])
      expect(existsSync(join(dir, 'kept.sh'))).toBe(true)
      expect(existsSync(resolve(dataDir, 'skills', 'imported', 'escaped.sh'))).toBe(false)
      expect(existsSync(resolve(dataDir, 'skills', 'further', 'escaped.sh'))).toBe(false)
    })
  })

  describe('writeAssets — links', () => {
    /** The asset directory as `writeAssets` will compute it, created up front. */
    const assetDir = (name: string): string => {
      const dir = resolve(dataDir, 'skills', 'imported', name)
      mkdirSync(dir, { recursive: true })
      return dir
    }

    it('drops an absolute path outright', () => {
      const outside = join(dataDir, 'outside.txt')
      writeFileSync(outside, 'original\n')
      deps.skills!.writeAssets!('alpha-pkg', [{ relPath: outside, content: 'overwritten' }])
      expect(readFileSync(outside, 'utf-8')).toBe('original\n')
    })

    it('does not write through a symlinked file inside the directory', () => {
      const dir = assetDir('alpha-pkg')
      const outside = join(dataDir, 'target.sh')
      writeFileSync(outside, 'original\n')
      // A package that ships a link where a file is expected: every string in
      // the name is local, but the write would land on `outside`.
      symlinkSync(outside, join(dir, 'run.sh'))

      deps.skills!.writeAssets!('alpha-pkg', [{ relPath: 'run.sh', content: 'planted\n' }])

      expect(readFileSync(outside, 'utf-8')).toBe('original\n')
      // The link itself is left alone rather than unlinked and replaced.
      expect(lstatSync(join(dir, 'run.sh')).isSymbolicLink()).toBe(true)
    })

    it('does not plant a file through a symlinked directory inside the directory', () => {
      const dir = assetDir('bravo-pkg')
      const outsideDir = join(dataDir, 'elsewhere')
      mkdirSync(outsideDir, { recursive: true })
      symlinkSync(outsideDir, join(dir, 'scripts'))

      deps.skills!.writeAssets!('bravo-pkg', [{ relPath: 'scripts/planted.sh', content: 'nope' }])

      expect(existsSync(join(outsideDir, 'planted.sh'))).toBe(false)
    })

    it('creates no directory through a link before refusing the file under it', () => {
      const dir = assetDir('delta-pkg')
      const outsideDir = join(dataDir, 'far-away')
      mkdirSync(outsideDir, { recursive: true })
      symlinkSync(outsideDir, join(dir, 'scripts'))

      // The refusal has to come BEFORE the tree is built: a recursive mkdir
      // follows the link and would leave `far-away/deep/nested` behind even
      // though the file itself was never written.
      deps.skills!.writeAssets!('delta-pkg', [
        { relPath: 'scripts/deep/nested/run.sh', content: 'nope' },
      ])

      expect(existsSync(join(outsideDir, 'deep'))).toBe(false)
      expect(existsSync(join(outsideDir, 'deep', 'nested', 'run.sh'))).toBe(false)
    })

    it('still writes a real nested file when nothing is linked', () => {
      const dir = deps.skills!.writeAssets!('charlie-pkg', [
        { relPath: 'scripts/run.sh', content: 'echo ship\n' },
      ])
      expect(readFileSync(join(dir, 'scripts', 'run.sh'), 'utf-8')).toBe('echo ship\n')
    })
  })

  describe('findImported', () => {
    it('finds an imported episodic row by its sha tag', () => {
      const row = episodic.create({
        content: 'the transcript body',
        sourceType: 'system',
        sourceId: 'import:job-1',
        tags: ['imported', 'sha:ddd444'],
      })
      expect(deps.episodic!.findImported!('ddd444')).toMatchObject({
        id: row.id,
        sourceId: 'import:job-1',
        tags: ['imported', 'sha:ddd444'],
      })
      expect(deps.episodic!.findImported!('eee555')).toBeNull()
    })

    it('answers from the ledger first, without the row needing a sha tag', () => {
      // R11.8 — the digest lives in the ledger now, indexed; the tag scan is
      // only the pre-ledger fallback.
      const row = episodic.create({
        content: 'the transcript body',
        sourceType: 'system',
        sourceId: 'import:job-9',
        tags: ['imported'],
      })
      recordApplied(db, { jobId: 'job-9', kind: 'episodic', ref: row.id, sha256: 'aaa000' })
      expect(deps.episodic!.findImported!('aaa000')).toMatchObject({
        id: row.id,
        sourceId: 'import:job-9',
      })
    })

    it('is not a hit when the ledger row outlived the episodic row it names', () => {
      const row = episodic.create({
        content: 'gone',
        sourceType: 'system',
        sourceId: 'import:job-9',
        tags: ['imported'],
      })
      recordApplied(db, { jobId: 'job-9', kind: 'episodic', ref: row.id, sha256: 'bbb000' })
      episodic.delete(row.id)
      expect(deps.episodic!.findImported!('bbb000')).toBeNull()
    })

    it('never runs the tag scan while every imported row carries a ledger digest', () => {
      // The scan is a full-table LIKE over a JSON column: run per item it is
      // O(N²) across the amendment's ten-times-larger import.
      const row = episodic.create({
        content: 'covered',
        sourceType: 'system',
        sourceId: 'import:job-9',
        tags: ['imported'],
      })
      recordApplied(db, { jobId: 'job-9', kind: 'episodic', ref: row.id, sha256: 'ccc000' })

      const fresh = buildApplyDeps({
        host: { db, logger, memory: { episodic: { create: (i) => episodic.create(i as any) } } },
        dataDir,
        createProposal: () => 'p',
        readWorkspaceFile: () => null,
        resolveDefaultAgentId: () => null,
      })
      const queries: string[] = []
      const realAll = db.all.bind(db)
      db.all = (q: any) => {
        queries.push(String(q?.queryChunks?.map((c: any) => c?.value ?? '').join('') ?? ''))
        return realAll(q)
      }
      try {
        for (let i = 0; i < 50; i++) expect(fresh.episodic!.findImported!(`miss-${i}`)).toBeNull()
      } finally {
        db.all = realAll
      }
      expect(queries.some((q) => q.includes('tags LIKE'))).toBe(false)
    })

    it('runs the tag scan while one imported row the ledger cannot account for is left', () => {
      episodic.create({
        content: 'written before the ledger carried a digest',
        sourceType: 'system',
        sourceId: 'import:old',
        tags: ['imported', 'sha:legacy1'],
      })
      const fresh = buildApplyDeps({
        host: { db, logger, memory: { episodic: { create: (i) => episodic.create(i as any) } } },
        dataDir,
        createProposal: () => 'p',
        readWorkspaceFile: () => null,
        resolveDefaultAgentId: () => null,
      })
      expect(fresh.episodic!.findImported!('legacy1')).toMatchObject({ sourceId: 'import:old' })
    })

    it('restamps a row in place: verbatim body, new digest tag, the rest kept', () => {
      const row = episodic.create({
        content: 'Body.',
        sourceType: 'system',
        sourceId: 'import:old',
        tags: ['imported', 'sha:stale', 'kept-by-hand'],
      })
      deps.episodic!.restamp!(row.id, {
        content: '\nBody.\n\n',
        sha: 'fresh',
        addTags: ['contains-secrets'],
      })
      const after = episodic.get(row.id)!
      expect(after.content).toBe('\nBody.\n\n')
      expect(after.tags).toContain('sha:fresh')
      expect(after.tags).not.toContain('sha:stale')
      expect(after.tags).toEqual(expect.arrayContaining(['imported', 'kept-by-hand', 'contains-secrets']))
    })

    it('ignores a row that was not imported, even with the same tag', () => {
      episodic.create({
        content: 'a conversation the assistant had',
        sourceType: 'conversation',
        sourceId: 'conv-9',
        tags: ['sha:fff666'],
      })
      expect(deps.episodic!.findImported!('fff666')).toBeNull()
    })
  })

  describe('findPendingProposal', () => {
    /** One pending card, exactly as `createProposal` writes it. */
    const seed = (over: Partial<Record<string, string>> = {}): string => {
      const id = over.id ?? `p-${Math.random().toString(36).slice(2)}`
      db.run(sql`INSERT INTO data_port_proposals
        (id, job_id, agent_id, workspace_file, title, proposed_body, existing_body, status, created_at, resolved_at)
        VALUES (${id}, ${over.jobId ?? 'job-1'}, ${over.agentId ?? 'primary-1'},
                ${over.workspaceFile ?? 'AGENTS.md'}, 'Alpha rules',
                ${over.body ?? 'Write tests first.'}, NULL, ${over.status ?? 'pending'},
                ${new Date().toISOString()}, NULL)`)
      return id
    }
    it('finds a pending card whose proposed body hashes the same', () => {
      const id = seed()
      expect(
        deps.findPendingProposal!({
          agentId: 'primary-1',
          workspaceFile: 'AGENTS.md',
          proposedBody: 'Write tests first.',
        }),
      ).toEqual({ id, jobId: 'job-1', proposedBody: 'Write tests first.' })
    })

    it('ignores a card that has already been answered', () => {
      seed({ status: 'approved' })
      seed({ status: 'rejected' })
      expect(
        deps.findPendingProposal!({
          agentId: 'primary-1',
          workspaceFile: 'AGENTS.md',
          proposedBody: 'Write tests first.',
        }),
      ).toBeNull()
    })

    it('never matches another workspace, another agent, or a different body', () => {
      seed()
      const body = 'Write tests first.'
      expect(
        deps.findPendingProposal!({ agentId: 'primary-1', workspaceFile: 'SOUL.md', proposedBody: body }),
      ).toBeNull()
      expect(
        deps.findPendingProposal!({ agentId: 'other-1', workspaceFile: 'AGENTS.md', proposedBody: body }),
      ).toBeNull()
      expect(
        deps.findPendingProposal!({
          agentId: 'primary-1',
          workspaceFile: 'AGENTS.md',
          proposedBody: 'Something else entirely.',
        }),
      ).toBeNull()
    })
  })

  describe('wasImported', () => {
    it('answers from the ledger, so an item whose tags were edited away is still ours', () => {
      expect(deps.wasImported!('vault', 'semantic/alpha.md')).toBe(false)
      recordApplied(db, { jobId: 'job-1', kind: 'vault', ref: 'semantic/alpha.md', sha256: 'aaa' })
      expect(deps.wasImported!('vault', 'semantic/alpha.md')).toBe(true)
      // Kind and ref both have to match: a skill of that id is not that note.
      expect(deps.wasImported!('skill', 'semantic/alpha.md')).toBe(false)
      expect(deps.wasImported!('vault', 'semantic/other.md')).toBe(false)
    })

    it('says no rather than throwing when there is no ledger table to ask', () => {
      const bare = buildApplyDeps({
        host: { db: createMemoryDb() as never, logger },
        dataDir,
        createProposal: () => 'p',
        readWorkspaceFile: () => null,
        resolveDefaultAgentId: () => null,
      })
      // "Cannot check" must never read as "the importer wrote it".
      expect(bare.wasImported!('vault', 'semantic/alpha.md')).toBe(false)
    })
  })

  describe('scopeExists', () => {
    it('answers for the ids this instance actually has, and no for a table it has not got', () => {
      // Before the board module has ever run there is no table to ask, and an
      // unresolvable id must read as unknown rather than throw the import.
      expect(deps.scopeExists!.project!('alpha')).toBe(false)

      db.run(sql`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL)`)
      db.run(sql`CREATE TABLE project_types (id TEXT PRIMARY KEY, name TEXT NOT NULL)`)
      db.run(sql`INSERT INTO projects VALUES ('alpha', 'Alpha')`)
      db.run(sql`INSERT INTO project_types VALUES ('delivery', 'Delivery')`)

      expect(deps.scopeExists!.project!('alpha')).toBe(true)
      expect(deps.scopeExists!.project!('zeta')).toBe(false)
      expect(deps.scopeExists!.projectType!('delivery')).toBe(true)
      expect(deps.scopeExists!.projectType!('unknown-type')).toBe(false)
    })
  })

  describe('toolRegistry', () => {
    it('is absent without a tools module, and asks the live registry when there is one', () => {
      expect(deps.toolRegistry).toBeUndefined()

      const asked: string[] = []
      const wired = buildApplyDeps({
        host: {
          db,
          logger,
          tools: {
            registry: {
              has: (name: string) => {
                asked.push(name)
                return name === 'read_file'
              },
            },
          },
        },
        dataDir,
        createProposal: () => 'p',
        readWorkspaceFile: () => null,
        resolveDefaultAgentId: () => null,
      })
      expect(wired.toolRegistry!.has('read_file')).toBe(true)
      expect(wired.toolRegistry!.has('codebase')).toBe(false)
      expect(asked).toEqual(['read_file', 'codebase'])
    })
  })

  describe('absent services', () => {
    it('leaves a slot undefined so apply reports the item as skipped, never as filed', () => {
      const bare = buildApplyDeps({
        host: { db, logger },
        dataDir,
        createProposal: () => 'p',
        readWorkspaceFile: () => null,
        resolveDefaultAgentId: () => null,
      })
      expect(bare.skills).toBeUndefined()
      expect(bare.episodic).toBeUndefined()
      expect(bare.vault).toBeUndefined()
      expect(bare.agents).toBeUndefined()
    })
  })
})
