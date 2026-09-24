// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseWorkingDirectories,
  parseNamedWorkingDirectories,
  inheritWorkingDirectories,
  validateWorkingDirectories,
  workspaceFromContext,
  toolWorkspaceFields,
  isPathInsideRoots,
  checkWorkingDirectoriesBody,
  folderRefusedNotice,
  screenStoredWorkingDirectories,
  screenToolWorkspaceFields,
  NO_WORKING_DIR,
} from '@modules/tools/working-directories.js'
import { NoticeSchema } from '@shared/chat-stream.js'
import {
  createPathPolicy,
  installPathPolicy,
  resetPathPolicyForTests,
  workAreaRootsOf,
  type PathPolicy,
} from '@shared/memory-sovereignty/path-policy.js'
import { RUN_SCRATCH_DIR } from '@modules/model/cli-runtime/workspaces.js'
import { createSovereigntyFixture, type SovereigntyFixture } from '../../helpers/memory-sovereignty-fixture.js'
import { resolveToolPath } from '@modules/tools/builtin/path-utils.js'
import { createFileTools } from '@modules/tools/builtin/file-tools.js'
import { createToolRegistry } from '@modules/tools/tool-registry.js'
import { createToolExecutor } from '@modules/tools/tool-executor.js'
import type { ToolContext } from '@modules/tools/types.js'

function silentCtx(partial: Partial<ToolContext> = {}): ToolContext {
  const logger: any = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  }
  return { conversationId: 'c1', userId: 'u1', logger, ...partial }
}

describe('working directories', () => {
  let dir: string
  let extra: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eyas-wd-'))
    extra = mkdtempSync(join(tmpdir(), 'eyas-wd2-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(extra, { recursive: true, force: true })
  })

  it('parses JSON arrays and ignores junk', () => {
    expect(parseWorkingDirectories(null)).toEqual([])
    expect(parseWorkingDirectories(JSON.stringify([dir, extra]))).toEqual([dir, extra])
    expect(parseWorkingDirectories(['  ', dir])).toEqual([dir])
  })

  it('parses named {name, path} entries and keeps the path list for the jail', () => {
    const named = [
      { name: 'alpha', path: dir },
      { name: 'bravo', path: extra },
    ]
    expect(parseWorkingDirectories(named)).toEqual([dir, extra])
    expect(parseWorkingDirectories(JSON.stringify(named))).toEqual([dir, extra])
    expect(parseNamedWorkingDirectories(named)).toEqual(named)
    expect(parseNamedWorkingDirectories([dir])).toEqual([{ name: dir.split(/[\\/]/).pop()!, path: dir }])
  })

  it('inherits the type list when the project list is empty', () => {
    const typeDirs = [{ name: 'alpha', path: dir }]
    expect(inheritWorkingDirectories(null, typeDirs)).toEqual(typeDirs)
    expect(inheritWorkingDirectories([], typeDirs)).toEqual(typeDirs)
    expect(inheritWorkingDirectories([extra], typeDirs)).toEqual([
      { name: extra.split(/[\\/]/).pop()!, path: extra },
    ])
  })

  it('accepts existing absolute directories, realpathed and de-duplicated; an empty list clears', () => {
    const ok = validateWorkingDirectories([dir, extra, `${dir}/`])
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.paths).toEqual([realpathSync(dir), realpathSync(extra)])
    const empty = validateWorkingDirectories([])
    expect(empty).toEqual({ ok: true, paths: [], entries: [] })
  })

  it('refuses a missing, relative or file path with its code', () => {
    const missing = validateWorkingDirectories(['/no/such/eyas-wd-xyz'])
    expect(missing.ok === false && missing.code).toBe('notFound')
    const relative = validateWorkingDirectories(['relative/path'])
    expect(relative.ok === false && relative.code).toBe('notAbsolute')
    writeFileSync(join(dir, 'file.txt'), 'x')
    const file = validateWorkingDirectories([join(dir, 'file.txt')])
    expect(file.ok === false && file.code).toBe('notDirectory')
  })

  it('resolves relative paths against the primary root and allows extra roots', () => {
    writeFileSync(join(dir, 'a.ts'), 'a')
    writeFileSync(join(extra, 'b.ts'), 'b')
    const rel = resolveToolPath('a.ts', dir, [dir, extra])
    expect(rel.ok).toBe(true)
    const absExtra = resolveToolPath(join(extra, 'b.ts'), dir, [dir, extra])
    expect(absExtra.ok).toBe(true)
    const escape = resolveToolPath('/tmp', dir, [dir, extra])
    expect(escape.ok).toBe(false)
  })

  it('fails closed with no working directory', () => {
    const r = resolveToolPath('a.ts')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('no working directory')
    expect(workspaceFromContext(silentCtx()).ok).toBe(false)
    expect(isPathInsideRoots(dir, [])).toBe(false)
  })

  it('file tools refuse when no workspace is bound', async () => {
    const registry = createToolRegistry()
    for (const t of createFileTools()) registry.register(t)
    const exec = createToolExecutor(registry, { authorization: 'disabled' })
    const res = await exec.execute('read_file', { path: 'a.ts' }, silentCtx())
    expect(res.output?.error).toMatch(/no working directory/i)
  })

  it('file tools read under extra roots', async () => {
    writeFileSync(join(extra, 'note.md'), 'hello')
    const registry = createToolRegistry()
    for (const t of createFileTools()) registry.register(t)
    const exec = createToolExecutor(registry, { authorization: 'disabled' })
    const res = await exec.execute(
      'read_file',
      { path: join(extra, 'note.md') },
      silentCtx({ workingDirectory: dir, workingDirectories: [dir, extra] }),
    )
    expect(res.success).toBe(true)
    expect(String((res.output as any).content)).toContain('hello')
  })

  it('edit_file stays inside the pinned roots and refuses a path outside them', async () => {
    writeFileSync(join(dir, 'in.ts'), 'const x = 1\n')
    writeFileSync(join(extra, 'out.ts'), 'const y = 2\n')
    const registry = createToolRegistry()
    for (const t of createFileTools()) registry.register(t)
    const exec = createToolExecutor(registry, { authorization: 'disabled' })
    const ctx = silentCtx({
      workingDirectory: dir,
      workingDirectories: [dir],
    })
    const ok = await exec.execute(
      'edit_file',
      { path: 'in.ts', oldString: 'const x = 1', newString: 'const x = 2' },
      ctx,
    )
    expect((ok.output as any)?.error).toBeUndefined()
    const refused = await exec.execute(
      'edit_file',
      { path: join(extra, 'out.ts'), oldString: 'const y = 2', newString: 'const y = 3' },
      ctx,
    )
    expect(String((refused.output as any)?.error ?? refused.error ?? '')).toMatch(/escapes working directories/i)
  })

  it('toolWorkspaceFields maps first path to primary', () => {
    expect(toolWorkspaceFields(null)).toEqual({})
    expect(toolWorkspaceFields([dir, extra])).toEqual({
      workingDirectory: dir,
      workingDirectories: [dir, extra],
    })
  })
})

// ── B12: folder validation codes ────────────────────────────────────────
// A throw-away layout (tests/helpers/memory-sovereignty-fixture.ts): an
// operator home with other tools' stores, an Obsidian vault found by its
// marker, an EYAS repo whose data dir holds the vault, and a relocated
// workspaces root. Nothing here points at the real home.

describe('validateWorkingDirectories — refusal codes (B12)', () => {
  let f: SovereigntyFixture
  let owner: string
  let policy: PathPolicy

  const check = (path: string, opts: { policy?: PathPolicy } = {}) =>
    validateWorkingDirectories([path], { policy: opts.policy ?? policy, homeDir: f.home })
  const codeOf = (path: string, opts: { policy?: PathPolicy } = {}) => {
    const r = check(path, opts)
    return r.ok ? 'ok' : r.code
  }

  beforeEach(() => {
    f = createSovereigntyFixture()
    owner = join(f.root, 'owner-notes')
    mkdirSync(join(owner, 'inbox'), { recursive: true })
    policy = createPathPolicy({
      homeDir: f.home,
      env: {},
      dataDir: f.dataDir,
      databasePath: f.databasePath,
      extraForeignPaths: [owner],
      workspacesRoot: f.workspacesRoot,
      workAreaRoots: workAreaRootsOf({ dataDir: f.dataDir, workspacesDir: f.workspacesRoot }),
      providerHomes: [join(f.dataDir, 'cli-homes')],
      obsidianRegistryPaths: [],
    })
  })
  afterEach(() => f.cleanup())

  it('home: the filesystem root, the home itself and a folder above it', () => {
    expect(codeOf('/')).toBe('home')
    expect(codeOf(f.home)).toBe('home')
    expect(codeOf(`${f.home}/`)).toBe('home')
    expect(codeOf(f.root)).toBe('home')
    expect(codeOf(dirname(f.root))).toBe('home')
  })

  it('home: a symlink to the home is judged where it lands', () => {
    const link = join(f.root, 'home-link')
    symlinkSync(f.home, link)
    expect(codeOf(link)).toBe('home')
  })

  it("providerHome: inside another CLI tool's store or an EYAS-owned CLI home", () => {
    expect(codeOf(join(f.home, '.claude', 'projects'))).toBe('providerHome')
    expect(codeOf(join(f.home, '.grok'))).toBe('providerHome')
    const cliHome = join(f.dataDir, 'cli-homes', 'grok-cli')
    mkdirSync(cliHome, { recursive: true })
    expect(codeOf(cliHome)).toBe('providerHome')
    // A tool's memory folder inside an ordinary repository.
    const repoMemory = join(f.repo, '.claude', 'memory')
    mkdirSync(repoMemory, { recursive: true })
    expect(codeOf(repoMemory)).toBe('providerHome')
    // Refused as protected even when it does not exist (yet).
    expect(codeOf(join(f.home, '.codex', 'not-there'))).toBe('providerHome')
  })

  it('vault: an Obsidian vault (root and inside), an ai-memory folder and a security.foreignMemoryPaths entry', () => {
    expect(codeOf(f.vault)).toBe('vault')
    expect(codeOf(join(f.vault, 'daily'))).toBe('vault')
    expect(codeOf(owner)).toBe('vault')
    expect(codeOf(join(owner, 'inbox'))).toBe('vault')
    const aiMemory = join(f.root, 'work', 'ai-memory')
    mkdirSync(aiMemory, { recursive: true })
    expect(codeOf(aiMemory)).toBe('vault')
    // Obsidian's own app config (its vault registry) counts as a vault too.
    const obsidianConfig = join(f.home, 'Library', 'Application Support', 'obsidian')
    mkdirSync(obsidianConfig, { recursive: true })
    expect(codeOf(obsidianConfig)).toBe('vault')
  })

  it('vault: a symlink into a vault is refused', () => {
    const link = join(f.root, 'notes-link')
    symlinkSync(f.vault, link)
    expect(codeOf(link)).toBe('vault')
  })

  it('eyasData: the data dir, its vault and the workspaces root itself', () => {
    expect(codeOf(f.dataDir)).toBe('eyasData')
    expect(codeOf(join(f.dataDir, 'vault'))).toBe('eyasData')
    expect(codeOf(f.workspacesRoot)).toBe('eyasData')
    const runs = join(f.workspacesRoot, RUN_SCRATCH_DIR)
    mkdirSync(runs, { recursive: true })
    expect(codeOf(runs)).toBe('eyasData')
  })

  it('sensitive: an SSH folder outside every store', () => {
    const ssh = join(f.root, 'work', '.ssh')
    mkdirSync(ssh, { recursive: true })
    expect(codeOf(ssh)).toBe('sensitive')
  })

  it('notAbsolute: a relative path and a null byte', () => {
    expect(codeOf('rel/path')).toBe('notAbsolute')
    expect(codeOf(`${f.repo}\0x`)).toBe('notAbsolute')
  })

  it('notFound and notDirectory', () => {
    expect(codeOf(join(f.root, 'missing'))).toBe('notFound')
    expect(codeOf(join(f.repo, 'src', 'a.ts'))).toBe('notDirectory')
  })

  it('a refusal names the folder and stops at the first refused one', () => {
    const r = validateWorkingDirectories([join(f.repo, 'src'), join(f.home, '.claude'), f.vault], { policy, homeDir: f.home })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('providerHome')
      expect(r.path).toBe(join(f.home, '.claude'))
      expect(r.error).toContain(join(f.home, '.claude'))
    }
  })

  it('accepts an ordinary project, a folder inside the EYAS repo that holds no data, and a folder beside a vault', () => {
    const project = join(f.root, 'projects', 'app')
    mkdirSync(project, { recursive: true })
    expect(codeOf(project)).toBe('ok')
    // The fixture repo's own src/ (with .claude/settings.json, CLAUDE.md and
    // docs/MEMORY.md beside it — none of them a memory folder).
    expect(codeOf(join(f.repo, 'src'))).toBe('ok')
    const documents = join(f.home, 'Documents')
    mkdirSync(join(documents, 'Obsidian Vault', '.obsidian'), { recursive: true })
    mkdirSync(join(documents, 'Projects', 'app'), { recursive: true })
    expect(codeOf(join(documents, 'Projects'))).toBe('ok')
    expect(codeOf(join(documents, 'Obsidian Vault'))).toBe('vault')
  })

  it("accepts a conversation's workspace under a relocated and under the default (in-data) root", () => {
    mkdirSync(f.ownWorkspace, { recursive: true })
    expect(codeOf(f.ownWorkspace)).toBe('ok')
    const defaultRoot = join(f.dataDir, 'workspaces')
    const ws = join(defaultRoot, 'conv-9')
    mkdirSync(ws, { recursive: true })
    const inData = createPathPolicy({
      homeDir: f.home,
      env: {},
      dataDir: f.dataDir,
      databasePath: f.databasePath,
      workspacesRoot: defaultRoot,
      workAreaRoots: workAreaRootsOf({ dataDir: f.dataDir, workspacesDir: defaultRoot }),
      providerHomes: [join(f.dataDir, 'cli-homes')],
      obsidianRegistryPaths: [],
    })
    expect(codeOf(ws, { policy: inData })).toBe('ok')
    expect(codeOf(defaultRoot, { policy: inData })).toBe('eyasData')
    expect(codeOf(join(f.dataDir, 'vault'), { policy: inData })).toBe('eyasData')
  })

  it('uses the process-wide policy and $HOME by default', () => {
    f.stubInstanceEnv()
    installPathPolicy(policy)
    try {
      const r = validateWorkingDirectories([join(f.home, '.claude')])
      expect(r.ok === false && r.code).toBe('providerHome')
      const home = validateWorkingDirectories([f.home])
      expect(home.ok === false && home.code).toBe('home')
      const repo = validateWorkingDirectories([f.repo])
      expect(repo.ok === false && repo.code).toBe('containsEyasData')
      expect(validateWorkingDirectories([join(f.repo, 'src')]).ok).toBe(true)
    } finally {
      resetPathPolicyForTests()
      vi.unstubAllEnvs()
    }
  })
})

describe('checkWorkingDirectoriesBody (B12)', () => {
  let f: SovereigntyFixture
  beforeEach(() => {
    f = createSovereigntyFixture()
  })
  afterEach(() => f.cleanup())

  const opts = () => ({ policy: f.policy, homeDir: f.home })

  it('stores folders (named entries kept) and clears on undefined, null and []', () => {
    const project = join(f.root, 'proj')
    mkdirSync(project)
    const src = join(f.repo, 'src')
    const ok = checkWorkingDirectoriesBody([src, { name: 'app', path: project }], opts())
    expect(ok).toEqual({ ok: true, stored: [realpathSync(src), { name: 'app', path: realpathSync(project) }] })
    for (const empty of [undefined, null, []]) {
      expect(checkWorkingDirectoriesBody(empty, opts())).toEqual({ ok: true, stored: null })
    }
  })

  it('a refused folder gives {error, code, path}', () => {
    const r = checkWorkingDirectoriesBody([f.vault], opts())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.body).toMatchObject({ code: 'vault', path: f.vault })
      expect(r.body.found).toBeUndefined()
    }
  })

  it('a folder refused for what it contains also names the protected place found (found)', () => {
    const r = checkWorkingDirectoriesBody([f.repo], opts())
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.body).toMatchObject({ code: 'containsEyasData', path: f.repo, found: f.dataDir })
      expect(r.body.error).toContain(f.dataDir)
    }
  })

  it('a malformed body is refused before any folder is looked at (no code)', () => {
    for (const bad of ['/tmp', { path: f.repo }, [''], ['   '], [{ name: 'x' }], [42], 'null']) {
      const r = checkWorkingDirectoriesBody(bad, opts())
      expect(r.ok, JSON.stringify(bad)).toBe(false)
      if (!r.ok) expect(r.body.code).toBeUndefined()
    }
  })
})

// ── K2: a folder is judged by what it CONTAINS ──────────────────────────
// A CLI reads inside its cwd without asking and searches it recursively, so
// a folder that holds EYAS's home or data, another tool's store, a CLI home
// or a notes vault is refused — not only one that sits inside them.

describe('validateWorkingDirectories — what a folder contains (K2)', () => {
  let f: SovereigntyFixture
  let owner: string
  let policy: PathPolicy

  const makePolicy = (extra: { providerHomes?: string[]; obsidianRegistryPaths?: string[] } = {}) => createPathPolicy({
    homeDir: f.home,
    env: {},
    dataDir: f.dataDir,
    databasePath: f.databasePath,
    extraForeignPaths: [owner],
    workspacesRoot: f.workspacesRoot,
    workAreaRoots: workAreaRootsOf({ dataDir: f.dataDir, workspacesDir: f.workspacesRoot }),
    providerHomes: extra.providerHomes ?? [join(f.dataDir, 'cli-homes')],
    obsidianRegistryPaths: extra.obsidianRegistryPaths ?? [],
  })
  const verdict = (path: string, opts: { policy?: PathPolicy; eyasHome?: string } = {}) =>
    validateWorkingDirectories([path], { policy: opts.policy ?? policy, homeDir: f.home, eyasHome: opts.eyasHome ?? join(f.root, 'eyas-home-elsewhere') })
  const codeOf = (path: string, opts: { policy?: PathPolicy; eyasHome?: string } = {}) => {
    const r = verdict(path, opts)
    return r.ok ? 'ok' : r.code
  }
  const foundOf = (path: string, opts: { policy?: PathPolicy; eyasHome?: string } = {}) => {
    const r = verdict(path, opts)
    return r.ok ? null : r.found ?? null
  }

  beforeEach(() => {
    f = createSovereigntyFixture()
    owner = join(f.root, 'work', 'owner-notes')
    mkdirSync(owner, { recursive: true })
    policy = makePolicy()
  })
  afterEach(() => f.cleanup())

  it('(−) a checkout that holds the EYAS data dir is refused, naming the data dir', () => {
    expect(codeOf(f.repo)).toBe('containsEyasData')
    expect(foundOf(f.repo)).toBe(f.dataDir)
  })

  it('(−) the EYAS home itself and a folder above it, even with the data dir elsewhere', () => {
    const eyasHome = join(f.root, 'work', 'eyas-instance')
    mkdirSync(join(eyasHome, 'config'), { recursive: true })
    expect(codeOf(eyasHome, { eyasHome })).toBe('containsEyasData')
    expect(foundOf(eyasHome, { eyasHome })).toBe(eyasHome)
    expect(codeOf(join(f.root, 'work'), { eyasHome })).toBe('containsEyasData')
    // A folder inside the EYAS home does not contain it.
    expect(codeOf(join(eyasHome, 'config'), { eyasHome })).toBe('ok')
  })

  it('(−) a folder that holds the database file or the relocated workspaces root', () => {
    expect(codeOf(join(f.root, 'db'))).toBe('containsEyasData')
    expect(foundOf(join(f.root, 'db'))).toBe(f.databasePath)
    expect(codeOf(join(f.root, 'app-data'))).toBe('containsEyasData')
  })

  it('(−) ~/Documents holding an Obsidian vault (found by its .obsidian marker)', () => {
    const documents = join(f.home, 'Documents')
    const vault = join(documents, 'Obsidian Vault')
    mkdirSync(join(vault, '.obsidian'), { recursive: true })
    expect(codeOf(documents)).toBe('containsVault')
    expect(foundOf(documents)).toBe(vault)
  })

  it('(−) a folder holding a vault known only from Obsidian\'s registry (no marker)', () => {
    const vault = join(f.root, 'library', 'registered-vault')
    mkdirSync(join(vault, 'daily'), { recursive: true })
    const registry = join(f.root, 'obsidian.json')
    writeFileSync(registry, JSON.stringify({ vaults: { a: { path: vault } } }))
    const withRegistry = makePolicy({ obsidianRegistryPaths: [registry] })
    expect(codeOf(join(f.root, 'library'), { policy: withRegistry })).toBe('containsVault')
    expect(foundOf(join(f.root, 'library'), { policy: withRegistry })).toBe(vault)
    // Without the registry the same folder holds nothing protected.
    expect(codeOf(join(f.root, 'library'))).toBe('ok')
  })

  it('(−) a folder holding a vault deeper down, an ai-memory folder or a security.foreignMemoryPaths entry', () => {
    const deep = join(f.root, 'deep')
    mkdirSync(join(deep, 'a', 'b', 'c', 'notes', '.obsidian'), { recursive: true })
    expect(codeOf(deep)).toBe('containsVault')
    const withAiMemory = join(f.root, 'kb')
    mkdirSync(join(withAiMemory, 'meta', 'ai-memory'), { recursive: true })
    expect(codeOf(withAiMemory)).toBe('containsVault')
    // owner-notes is registered in security.foreignMemoryPaths.
    expect(codeOf(join(f.root, 'work'))).toBe('containsVault')
    expect(foundOf(join(f.root, 'work'))).toBe(owner)
  })

  it('(−) a symlink inside the folder that points into a vault or the EYAS data dir', () => {
    const project = join(f.root, 'linked-project')
    mkdirSync(project)
    symlinkSync(f.vault, join(project, 'notes'))
    expect(codeOf(project)).toBe('containsVault')
    const project2 = join(f.root, 'linked-project-2')
    mkdirSync(project2)
    symlinkSync(join(f.dataDir, 'vault'), join(project2, 'memory-link'))
    expect(codeOf(project2)).toBe('containsEyasData')
  })

  it('(−) a folder holding another tool\'s store (XDG location) or a tool memory folder', () => {
    const config = join(f.home, '.config')
    const opencode = join(config, 'opencode')
    mkdirSync(opencode, { recursive: true })
    expect(codeOf(config)).toBe('containsProviderHome')
    expect(foundOf(config)).toBe(opencode)
    const repo = join(f.root, 'repo-with-memory')
    mkdirSync(join(repo, '.claude', 'memory'), { recursive: true })
    expect(codeOf(repo)).toBe('containsProviderHome')
  })

  it('(−) a folder holding an EYAS-owned CLI home kept outside the data dir', () => {
    const cliHomes = join(f.root, 'cli', 'homes')
    mkdirSync(join(cliHomes, 'grok-cli'), { recursive: true })
    const withHomes = makePolicy({ providerHomes: [cliHomes] })
    expect(codeOf(join(f.root, 'cli'), { policy: withHomes })).toBe('containsProviderHome')
    expect(foundOf(join(f.root, 'cli'), { policy: withHomes })).toBe(cliHomes)
  })

  it('(+) a project with ordinary .claude settings, CLAUDE.md and a MEMORY.md file is accepted', () => {
    const project = join(f.root, 'projects', 'app')
    mkdirSync(join(project, '.claude', 'commands'), { recursive: true })
    writeFileSync(join(project, '.claude', 'settings.json'), '{}\n')
    writeFileSync(join(project, 'CLAUDE.md'), '# rules\n')
    mkdirSync(join(project, 'docs', 'memory'), { recursive: true })
    writeFileSync(join(project, 'docs', 'MEMORY.md'), '# index\n')
    expect(codeOf(project)).toBe('ok')
  })

  it("(+) a conversation's own workspace and a folder inside the EYAS repo that holds no data are accepted", () => {
    mkdirSync(f.ownWorkspace, { recursive: true })
    expect(codeOf(f.ownWorkspace)).toBe('ok')
    expect(codeOf(join(f.repo, 'src'))).toBe('ok')
  })

  it('stops at the first refused folder of a list', () => {
    const project = join(f.root, 'projects', 'ok')
    mkdirSync(project, { recursive: true })
    const r = validateWorkingDirectories([project, f.repo], { policy, homeDir: f.home, eyasHome: join(f.root, 'nowhere') })
    expect(r.ok === false && r.code).toBe('containsEyasData')
    expect(r.ok === false && r.path).toBe(f.repo)
  })
})

describe('stored folders at run time (K2)', () => {
  let f: SovereigntyFixture
  let project: string

  beforeEach(() => {
    f = createSovereigntyFixture()
    project = join(f.root, 'projects', 'app')
    mkdirSync(project, { recursive: true })
  })
  afterEach(() => f.cleanup())

  const opts = () => ({ policy: f.policy, homeDir: f.home, eyasHome: join(f.root, 'nowhere') })

  it('(+) screenStoredWorkingDirectories keeps allowed folders as stored — a missing one included', () => {
    const missing = join(f.root, 'gone')
    const screened = screenStoredWorkingDirectories([{ name: 'app', path: project }, missing], opts())
    expect(screened.refused).toEqual([])
    expect(screened.entries).toEqual([{ name: 'app', path: project }, { name: 'gone', path: missing }])
  })

  it('(−) screenStoredWorkingDirectories leaves out a folder a protection rule now refuses, with its code and what it found', () => {
    const documents = join(f.home, 'Documents')
    mkdirSync(join(documents, 'Vault', '.obsidian'), { recursive: true })
    const screened = screenStoredWorkingDirectories(JSON.stringify([f.repo, project, documents, f.home]), opts())
    expect(screened.entries.map((e) => e.path)).toEqual([project])
    expect(screened.refused).toEqual([
      { path: f.repo, code: 'containsEyasData', found: f.dataDir },
      { path: documents, code: 'containsVault', found: join(documents, 'Vault') },
      { path: f.home, code: 'home' },
    ])
  })

  it('(+) screenToolWorkspaceFields keeps the fields untouched when every folder is allowed', () => {
    expect(screenToolWorkspaceFields({ workingDirectory: project, workingDirectories: [project] }, opts()))
      .toEqual({ fields: { workingDirectory: project, workingDirectories: [project] }, refused: [] })
    expect(screenToolWorkspaceFields({ workingDirectory: project }, opts()))
      .toEqual({ fields: { workingDirectory: project }, refused: [] })
    expect(screenToolWorkspaceFields(undefined, opts())).toEqual({ fields: {}, refused: [] })
  })

  it('(−) screenToolWorkspaceFields drops a refused primary: the next allowed folder becomes the primary', () => {
    const r = screenToolWorkspaceFields({ workingDirectory: f.repo, workingDirectories: [f.repo, project] }, opts())
    expect(r.fields).toEqual({ workingDirectory: project, workingDirectories: [project] })
    expect(r.refused.map((x) => x.code)).toEqual(['containsEyasData'])
    // Only a refused primary: no folder is left.
    expect(screenToolWorkspaceFields({ workingDirectory: f.repo }, opts()).fields).toEqual({})
  })

  it('folderRefusedNotice is a valid chat notice (the path capped for the wire)', () => {
    const notice = folderRefusedNotice({ path: f.repo, code: 'containsEyasData', found: f.dataDir })
    expect(notice).toEqual({ type: 'notice', code: 'folderRefused', params: { path: f.repo, reason: 'containsEyasData' } })
    expect(NoticeSchema.safeParse({ code: notice.code, params: notice.params }).success).toBe(true)
    const long = `/${'x'.repeat(900)}`
    const capped = folderRefusedNotice({ path: long, code: 'home' })
    expect(capped.params.path.length).toBeLessThanOrEqual(500)
    expect(capped.params.path.endsWith('x'.repeat(100))).toBe(true)
    expect(NoticeSchema.safeParse({ code: capped.code, params: capped.params }).success).toBe(true)
  })
})

describe('screenToolWorkspaceFields — a primary outside the folder list (K2)', () => {
  let f: SovereigntyFixture
  let project: string
  beforeEach(() => {
    f = createSovereigntyFixture()
    project = join(f.root, 'projects', 'app')
    mkdirSync(project, { recursive: true })
  })
  afterEach(() => f.cleanup())
  const opts = () => ({ policy: f.policy, homeDir: f.home, eyasHome: join(f.root, 'nowhere') })

  it('(+) an allowed primary outside the list stays the primary', () => {
    const worktree = join(f.root, 'worktree')
    mkdirSync(worktree)
    expect(screenToolWorkspaceFields({ workingDirectory: worktree, workingDirectories: [project] }, opts()))
      .toEqual({ fields: { workingDirectory: worktree, workingDirectories: [project] }, refused: [] })
  })

  it('(−) a refused primary outside the list is screened too; the first allowed folder takes its place', () => {
    const r = screenToolWorkspaceFields({ workingDirectory: f.repo, workingDirectories: [project] }, opts())
    expect(r.fields).toEqual({ workingDirectory: project, workingDirectories: [project] })
    expect(r.refused).toEqual([{ path: f.repo, code: 'containsEyasData', found: f.dataDir }])
  })
})
