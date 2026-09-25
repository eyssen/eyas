// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// skills.importRoots is re-read on every start, so a root is a live source.
// Another tool's own folders never are one: they are skipped (with a warning
// that points at Data port), while an ordinary team folder is still scanned.
// Everything lives in a temp dir — never the operator's real home.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createPathPolicy,
  installPathPolicy,
  resetPathPolicyForTests,
  workAreaRootsOf,
  type PathPolicy,
} from '@shared/memory-sovereignty/path-policy.js'
import {
  IMPORT_ROOT_REMEDY,
  classifyImportRoot,
  describeSkippedImportRoot,
  selectImportRoots,
} from '@shared/memory-sovereignty/import-roots.js'
import { resolveSkillImportRoots } from '@modules/skills/skill-inventory.js'
import { skillsModule } from '@modules/skills/index.js'
import { createMemoryDb } from '../../helpers/test-db'

let root: string
let home: string
let dataDir: string
let team: string
let policy: PathPolicy

function mk(...parts: string[]): string {
  const dir = join(...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

function skillMd(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}\n`
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eyas-import-roots-'))
  home = mk(root, 'home')
  dataDir = mk(root, 'eyas', 'data')
  team = mk(root, 'opt', 'team-skills')
  mk(home, '.claude', 'skills')
  mk(home, '.agents', 'skills')
  mk(home, '.config', 'opencode', 'skills')
  mk(dataDir, 'cli-homes', 'claude-code', '.claude', 'skills')
  const vault = mk(root, 'notes', 'Vault')
  mk(vault, '.obsidian')
  mk(vault, 'skills')
  policy = createPathPolicy({
    homeDir: home,
    env: {},
    dataDir,
    workspacesRoot: join(dataDir, 'workspaces'),
    workAreaRoots: workAreaRootsOf({ dataDir, workspacesDir: join(dataDir, 'workspaces') }),
    providerHomes: [join(dataDir, 'cli-homes')],
    extraForeignPaths: [join(root, 'owner-protected')],
  })
})

afterEach(() => {
  resetPathPolicyForTests()
  rmSync(root, { recursive: true, force: true })
})

describe('selectImportRoots', () => {
  it('skips a ~/.claude/skills root and names the store it is inside', () => {
    const hit = classifyImportRoot(join(home, '.claude', 'skills'), policy)
    expect(hit).toEqual({ root: join(home, '.claude', 'skills'), relation: 'inside', label: 'Claude Code (~/.claude)' })
    expect(describeSkippedImportRoot(hit!)).toBe(`${join(home, '.claude', 'skills')} is inside Claude Code (~/.claude)`)
  })

  it('scans an ordinary team folder such as /opt/team-skills', () => {
    expect(classifyImportRoot('/opt/team-skills', policy)).toBeNull()
    expect(classifyImportRoot(team, policy)).toBeNull()
  })

  it('skips the other provider-native folders: shared agent skills, OpenCode config, EYAS-owned CLI homes', () => {
    for (const r of [
      join(home, '.agents', 'skills'),
      join(home, '.config', 'opencode', 'skills'),
      join(dataDir, 'cli-homes', 'claude-code', '.claude', 'skills'),
    ]) {
      expect(classifyImportRoot(r, policy), r).toMatchObject({ root: r, relation: 'inside' })
    }
  })

  it('skips a folder inside an Obsidian vault and a security.foreignMemoryPaths entry', () => {
    expect(classifyImportRoot(join(root, 'notes', 'Vault', 'skills'), policy)).toMatchObject({ relation: 'inside', label: 'Obsidian vault' })
    expect(classifyImportRoot(join(root, 'owner-protected', 'skills'), policy)).toMatchObject({ relation: 'inside' })
  })

  it('skips a root that encloses a provider home, since a recursive scan would read it', () => {
    expect(classifyImportRoot(home, policy)).toMatchObject({ root: home, relation: 'encloses', label: 'Claude Code' })
    expect(describeSkippedImportRoot(classifyImportRoot(home, policy)!)).toBe(`${home} contains Claude Code`)
  })

  it('keeps configured order and splits scanned from skipped', () => {
    const roots = resolveSkillImportRoots({ skills: { importRoots: [team, join(home, '.claude', 'skills'), '/opt/team-skills'] } })
    const { scan, skipped } = selectImportRoots(roots, policy)
    expect(scan).toEqual([team, '/opt/team-skills'])
    expect(skipped.map((s) => s.root)).toEqual([join(home, '.claude', 'skills')])
  })

  it('asks the process-wide policy when none is passed', () => {
    installPathPolicy(policy)
    expect(selectImportRoots([join(home, '.claude', 'skills'), team])).toMatchObject({ scan: [team] })
  })
})

describe('skills module — importRoots on start', () => {
  it('loads skills from a team root and never from ~/.claude/skills, with a warning that points at Data port', async () => {
    writeFileSync(join(home, '.claude', 'skills', 'host-alpha.md'), skillMd('host-alpha', 'Host body.'))
    writeFileSync(join(team, 'team-bravo.md'), skillMd('team-bravo', 'Team body.'))
    installPathPolicy(policy)

    const warnings: Array<{ obj: unknown; msg: string }> = []
    const logger = {
      debug: () => {},
      info: () => {},
      error: () => {},
      warn: (obj: unknown, msg: string) => { warnings.push({ obj, msg }) },
    }
    const db = createMemoryDb()
    const ctx: any = {
      db,
      http: new Hono(),
      logger,
      config: { skills: { importRoots: [join(home, '.claude', 'skills'), team] } },
      bus: { on: () => {}, emit: () => {} },
    }
    await skillsModule.onRegister(ctx)
    await skillsModule.onStart(ctx)

    const ids = (db.all(sql`SELECT id FROM skills WHERE source_root LIKE 'import:%'`) as Array<{ id: string }>).map((r) => r.id)
    expect(ids).toEqual(['team-bravo'])
    expect(ids).not.toContain('host-alpha')
    const skip = warnings.find((w) => w.msg.startsWith('skills.importRoots:'))
    expect(skip?.msg).toContain(IMPORT_ROOT_REMEDY)
    expect(skip?.obj).toMatchObject({ root: join(home, '.claude', 'skills'), relation: 'inside' })
  }, 30_000)
})
