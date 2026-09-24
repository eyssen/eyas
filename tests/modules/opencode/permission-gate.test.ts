// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  mapOpencodePermission,
  opencodeWorktree,
  OpencodePermissionRequestSchema,
  OPENCODE_UNMAPPED_TOOL,
  type OpencodePermissionRequest,
} from '@modules/opencode/permission-gate'

const FIXTURE = join(process.cwd(), 'tests/fixtures/cli/opencode/1.18.29/permission-asked.json')

interface FixtureEvent { type: string; properties: Record<string, unknown> }

/** The recorded permission.asked events, with the redacted paths filled in. */
function fixtureRequests(root: string, home: string): OpencodePermissionRequest[] {
  const raw = readFileSync(FIXTURE, 'utf8')
    .replaceAll('<ROOT_WITHOUT_LEADING_SLASH>', root.slice(1))
    .replaceAll('<HOME>', home)
  const parsed = JSON.parse(raw) as { events: FixtureEvent[] }
  return parsed.events.map((e) => OpencodePermissionRequestSchema.parse(e.properties))
}

describe('opencode permission → gate mapping', () => {
  let root: string
  let project: string
  let home: string

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-oc-perm-')))
    project = join(root, 'project')
    home = join(root, 'home')
    mkdirSync(project, { recursive: true })
    mkdirSync(join(home, 'Documents', 'EyasSentinelVault', '99_Meta', 'ai-memory'), { recursive: true })
    writeFileSync(join(project, 'probe-opencode.txt'), 'PROBE\n')
    writeFileSync(join(home, 'Documents', 'EyasSentinelVault', '99_Meta', 'ai-memory', 'MEMORY.md'), 'x\n')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('maps the recorded read / bash / external_directory requests onto gate tools with absolute paths', () => {
    const [read, bash, external, vaultRead] = fixtureRequests(root, home)

    const r = mapOpencodePermission(read!, project)
    expect(r.name).toBe('Read')
    expect(r.mapped).toBe(true)
    // The pattern is the absolute path without its leading slash (no git repo → worktree "/").
    expect(r.input.file_path).toBe(join(project, 'probe-opencode.txt'))

    const b = mapOpencodePermission(bash!, project)
    expect(b.name).toBe('Bash')
    expect(b.input).toMatchObject({ command: 'ls', cwd: project })

    const e = mapOpencodePermission(external!, project)
    expect(e.name).toBe('Read')
    const vaultDir = join(home, 'Documents', 'EyasSentinelVault', '99_Meta', 'ai-memory')
    expect(e.input).toMatchObject({ path: vaultDir, file_path: join(vaultDir, 'MEMORY.md'), paths: [vaultDir] })

    const v = mapOpencodePermission(vaultRead!, project)
    expect(v.input.file_path).toBe(join(vaultDir, 'MEMORY.md'))
    // The raw request travels along for the judge and the audit log.
    expect(v.input._opencode).toMatchObject({ permission: 'read' })
  })

  it('resolves a relative pattern against the git worktree, and also shows the root reading', () => {
    const repo = join(root, 'repo')
    mkdirSync(join(repo, '.git'), { recursive: true })
    mkdirSync(join(repo, 'src'), { recursive: true })
    writeFileSync(join(repo, 'src', 'a.ts'), '')
    expect(opencodeWorktree(join(repo, 'src'))).toBe(repo)
    const mapped = mapOpencodePermission(
      { id: 'per_1', sessionID: 'ses_1', permission: 'read', patterns: ['src/a.ts'], metadata: {} },
      join(repo, 'src'),
    )
    expect(mapped.input.file_path).toBe(join(repo, 'src', 'a.ts'))
    expect(mapped.input.paths).toEqual([join(repo, 'src', 'a.ts'), '/src/a.ts'])
  })

  it('uses metadata.filepath for an edit and maps it to the yellow Edit tool', () => {
    const mapped = mapOpencodePermission(
      { id: 'per_2', sessionID: 'ses_1', permission: 'edit', patterns: ['x.ts'], metadata: { filepath: join(project, 'x.ts'), diff: 'd'.repeat(5_000) } },
      project,
    )
    expect(mapped.name).toBe('Edit')
    expect(mapped.input.file_path).toBe(join(project, 'x.ts'))
    const meta = (mapped.input._opencode as { metadata: { diff: string } }).metadata
    expect(meta.diff.length).toBeLessThan(2_100)
  })

  it('maps webfetch / grep / task onto their canonical names', () => {
    expect(mapOpencodePermission({ id: 'p', sessionID: 's', permission: 'webfetch', patterns: ['https://example.com'], metadata: { url: 'https://example.com' } }, project))
      .toMatchObject({ name: 'WebFetch', input: { url: 'https://example.com' } })
    expect(mapOpencodePermission({ id: 'p', sessionID: 's', permission: 'grep', patterns: ['TODO'], metadata: { pattern: 'TODO' } }, project))
      .toMatchObject({ name: 'Grep', input: { pattern: 'TODO', path: project } })
    expect(mapOpencodePermission({ id: 'p', sessionID: 's', permission: 'task', patterns: ['explore'], metadata: {} }, project))
      .toMatchObject({ name: 'Task', input: { subagent_type: 'explore' } })
  })

  it('never lets an unknown permission key become the gate name', () => {
    const mapped = mapOpencodePermission({ id: 'p', sessionID: 's', permission: 'Read_file', patterns: [], metadata: {} }, project)
    expect(mapped.name).toBe(OPENCODE_UNMAPPED_TOOL)
    expect(mapped.mapped).toBe(false)
    expect(mapOpencodePermission({ id: 'p', sessionID: 's', permission: 'doom_loop', patterns: [], metadata: {} }, project).name)
      .toBe(OPENCODE_UNMAPPED_TOOL)
  })

  it('rejects a malformed request payload', () => {
    expect(OpencodePermissionRequestSchema.safeParse({ sessionID: 'ses_1', permission: 'read' }).success).toBe(false)
    expect(OpencodePermissionRequestSchema.safeParse({ id: 'per_1', permission: 'read' }).success).toBe(false)
    // Missing optional arrays are tolerated.
    expect(OpencodePermissionRequestSchema.parse({ id: 'per_1', sessionID: 'ses_1', permission: 'read' }).patterns).toEqual([])
  })
})
