// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, isAbsolute } from 'node:path'
import { resolveWorkspacesDir, hasGitAncestor, detectInstallRoot } from '@core/instance.js'
import {
  ensureConversationWorkspace,
  resolveCliCwd,
  resolveWorkspacesRoot,
  RUN_SCRATCH_DIR,
} from '@modules/model/cli-runtime/workspaces.js'
import {
  createPathPolicy,
  installPathPolicy,
  resetPathPolicyForTests,
  workAreaRootsOf,
} from '@shared/memory-sovereignty/path-policy.js'
import { createSovereigntyFixture } from '../../../helpers/memory-sovereignty-fixture.js'

function inside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

let tmp: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-ws-')))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('resolveWorkspacesDir', () => {
  it('keeps workspaces under the data dir when no git work tree encloses it', () => {
    const dataDir = join(tmp, 'plain', 'data')
    expect(resolveWorkspacesDir({ dataDir, home: join(tmp, 'plain'), env: {} })).toBe(join(dataDir, 'workspaces'))
  })

  it('moves workspaces out of a data dir that sits inside a git checkout', () => {
    const repo = join(tmp, 'eyas-checkout')
    mkdirSync(join(repo, '.git'), { recursive: true })
    const userHome = join(tmp, 'user')
    const root = resolveWorkspacesDir({ dataDir: join(repo, 'data'), home: repo, env: {}, platform: 'darwin', userHome })
    expect(inside(root, repo)).toBe(false)
    expect(hasGitAncestor(root)).toBe(false)
    expect(inside(root, join(userHome, 'Library', 'Application Support', 'eyas'))).toBe(true)
    expect(root.endsWith('workspaces')).toBe(true)
  })

  it('uses XDG_DATA_HOME on Linux and LOCALAPPDATA on Windows', () => {
    const repo = join(tmp, 'checkout')
    mkdirSync(join(repo, '.git'), { recursive: true })
    const linux = resolveWorkspacesDir({ dataDir: join(repo, 'data'), home: repo, env: { XDG_DATA_HOME: join(tmp, 'xdg') }, platform: 'linux', userHome: join(tmp, 'u') })
    expect(inside(linux, join(tmp, 'xdg', 'eyas'))).toBe(true)
    const linuxDefault = resolveWorkspacesDir({ dataDir: join(repo, 'data'), home: repo, env: {}, platform: 'linux', userHome: join(tmp, 'u') })
    expect(inside(linuxDefault, join(tmp, 'u', '.local', 'share', 'eyas'))).toBe(true)
    const win = resolveWorkspacesDir({ dataDir: join(repo, 'data'), home: repo, env: { LOCALAPPDATA: join(tmp, 'local') }, platform: 'win32', userHome: join(tmp, 'u') })
    expect(inside(win, join(tmp, 'local', 'eyas'))).toBe(true)
  })

  it('gives two instances on one machine different roots', () => {
    const repoA = join(tmp, 'a')
    const repoB = join(tmp, 'b')
    mkdirSync(join(repoA, '.git'), { recursive: true })
    mkdirSync(join(repoB, '.git'), { recursive: true })
    const common = { env: {}, platform: 'linux' as const, userHome: join(tmp, 'u') }
    const a = resolveWorkspacesDir({ ...common, dataDir: join(repoA, 'data'), home: repoA })
    const b = resolveWorkspacesDir({ ...common, dataDir: join(repoB, 'data'), home: repoB })
    expect(a).not.toBe(b)
    // Stable across calls.
    expect(resolveWorkspacesDir({ ...common, dataDir: join(repoA, 'data'), home: repoA })).toBe(a)
  })

  it('honours EYAS_WORKSPACES_DIR over everything', () => {
    const repo = join(tmp, 'checkout')
    mkdirSync(join(repo, '.git'), { recursive: true })
    const chosen = join(tmp, 'chosen')
    expect(resolveWorkspacesDir({ dataDir: join(repo, 'data'), home: repo, env: { EYAS_WORKSPACES_DIR: chosen } })).toBe(chosen)
  })

  it('never returns a root inside this source checkout', () => {
    const install = detectInstallRoot()
    const root = resolveWorkspacesDir({ dataDir: join(install, 'data'), home: install, env: {} })
    if (hasGitAncestor(install)) expect(inside(root, install)).toBe(false)
  })
})

describe('hasGitAncestor', () => {
  it('finds a .git directory or file above a path that does not exist yet', () => {
    mkdirSync(join(tmp, 'repo', '.git'), { recursive: true })
    expect(hasGitAncestor(join(tmp, 'repo', 'data', 'workspaces', 'x'))).toBe(true)
  })

  it('is false outside any work tree', () => {
    expect(hasGitAncestor(join(tmp, 'nowhere', 'deep'))).toBe(false)
  })
})

describe('resolveWorkspacesRoot', () => {
  it('is InstancePaths.workspacesDir (EYAS_WORKSPACES_DIR in tests)', () => {
    expect(resolveWorkspacesRoot()).toBe(process.env.EYAS_WORKSPACES_DIR)
  })
})

describe('ensureConversationWorkspace', () => {
  it('creates the conversation folder under the root, idempotently', () => {
    const root = join(tmp, 'root')
    const dir = ensureConversationWorkspace('01ABCDEF', { root })
    expect(dir).toBe(join(root, '01ABCDEF'))
    expect(existsSync(dir)).toBe(true)
    expect(ensureConversationWorkspace('01ABCDEF', { root })).toBe(dir)
  })

  it('refuses an id that is not a single safe path segment', () => {
    const root = join(tmp, 'root')
    for (const bad of ['../escape', 'a/b', '.hidden', '_runs', '', 'x'.repeat(200)]) {
      expect(() => ensureConversationWorkspace(bad, { root }), bad).toThrow(/invalid conversation id/)
    }
  })
})

describe('resolveCliCwd', () => {
  let root: string
  let dataDir: string

  beforeEach(() => {
    dataDir = join(tmp, 'data')
    root = join(tmp, 'workspaces')
    mkdirSync(dataDir, { recursive: true })
  })

  it('gives a request with no metadata a fresh run scratch folder — never process.cwd(), the install root or the data dir', () => {
    const cwd = resolveCliCwd({}, { root, dataDir })
    expect(inside(cwd, join(root, RUN_SCRATCH_DIR))).toBe(true)
    expect(existsSync(cwd)).toBe(true)
    expect(cwd).not.toBe(process.cwd())
    expect(cwd).not.toBe(detectInstallRoot())
    expect(cwd).not.toBe(dataDir)
    expect(resolveCliCwd({}, { root, dataDir })).not.toBe(cwd)
  })

  it('uses the instance roots by default', () => {
    const cwd = resolveCliCwd({})
    expect(inside(cwd, process.env.EYAS_WORKSPACES_DIR!)).toBe(true)
  })

  it('an explicit valid folder wins', () => {
    const folder = join(tmp, 'project')
    mkdirSync(folder)
    const cwd = resolveCliCwd({ metadata: { workingDirectories: [folder], conversationId: 'conv1', runId: 'run1' } }, { root, dataDir })
    expect(cwd).toBe(folder)
  })

  it('falls back to the singular workingDirectory', () => {
    const folder = join(tmp, 'single')
    mkdirSync(folder)
    expect(resolveCliCwd({ metadata: { workingDirectory: folder } }, { root, dataDir })).toBe(folder)
  })

  it('skips a stored folder that no longer passes validation, with a warning', () => {
    const gone = join(tmp, 'deleted-project')
    const sensitive = join(tmp, '.ssh')
    mkdirSync(sensitive)
    const valid = join(tmp, 'second')
    mkdirSync(valid)
    const logger = { warn: vi.fn() }
    const cwd = resolveCliCwd({ metadata: { workingDirectories: [gone, sensitive, valid] } }, { root, dataDir, logger })
    expect(cwd).toBe(valid)
    expect(logger.warn).toHaveBeenCalledTimes(2)
  })

  it('refuses a folder inside the EYAS data dir and uses the conversation workspace instead', () => {
    const vault = join(dataDir, 'vault')
    mkdirSync(vault)
    const logger = { warn: vi.fn() }
    const cwd = resolveCliCwd({ metadata: { workingDirectories: [dataDir, vault], conversationId: 'conv-1' } }, { root, dataDir, logger })
    expect(cwd).toBe(join(root, 'conv-1'))
    expect(logger.warn).toHaveBeenCalledTimes(2)
    expect(logger.warn.mock.calls[0][0]).toMatchObject({ code: 'eyasData' })
  })

  it('accepts a workspace inside the data dir when the workspaces root lives there', () => {
    const inDataRoot = join(dataDir, 'workspaces')
    const ws = ensureConversationWorkspace('conv-2', { root: inDataRoot })
    expect(resolveCliCwd({ metadata: { workingDirectories: [ws] } }, { root: inDataRoot, dataDir })).toBe(ws)
  })

  it('uses the conversation workspace when no folder is stored', () => {
    const cwd = resolveCliCwd({ metadata: { conversationId: 'conv-3', runId: 'run-3' } }, { root, dataDir })
    expect(cwd).toBe(join(root, 'conv-3'))
    expect(existsSync(cwd)).toBe(true)
  })

  it('uses the run scratch folder for a run without a conversation', () => {
    expect(resolveCliCwd({ metadata: { runId: 'run-4' } }, { root, dataDir })).toBe(join(root, RUN_SCRATCH_DIR, 'run-4'))
  })

  it('never builds a path from an unsafe conversation id', () => {
    const cwd = resolveCliCwd({ metadata: { conversationId: '../../etc' } }, { root, dataDir })
    expect(inside(cwd, join(root, RUN_SCRATCH_DIR))).toBe(true)
  })

  it('refuses a stored folder inside an Obsidian vault with the folder code (B12)', () => {
    const vault = join(tmp, 'notes')
    mkdirSync(join(vault, '.obsidian'), { recursive: true })
    mkdirSync(join(vault, 'daily'))
    const logger = { warn: vi.fn() }
    const cwd = resolveCliCwd({ metadata: { workingDirectories: [join(vault, 'daily')], conversationId: 'conv-6' } }, { root, dataDir, logger })
    expect(cwd).toBe(join(root, 'conv-6'))
    expect(logger.warn.mock.calls[0][0]).toMatchObject({ code: 'vault' })
  })

  it("judges the instance's own layout with the installed policy (it knows security.foreignMemoryPaths)", () => {
    const f = createSovereigntyFixture()
    const owner = join(f.root, 'owner-notes')
    mkdirSync(owner)
    const project = join(f.root, 'project')
    mkdirSync(project)
    f.stubInstanceEnv()
    installPathPolicy(createPathPolicy({
      homeDir: f.home,
      env: {},
      dataDir: f.dataDir,
      databasePath: f.databasePath,
      extraForeignPaths: [owner],
      workspacesRoot: f.workspacesRoot,
      workAreaRoots: workAreaRootsOf({ dataDir: f.dataDir, workspacesDir: f.workspacesRoot }),
      providerHomes: [join(f.dataDir, 'cli-homes')],
      obsidianRegistryPaths: [],
    }))
    try {
      const logger = { warn: vi.fn() }
      const cwd = resolveCliCwd({ metadata: { workingDirectories: [owner, f.home], conversationId: 'conv-7' } }, { logger })
      expect(cwd).toBe(join(f.workspacesRoot, 'conv-7'))
      expect(logger.warn.mock.calls.map((c) => (c[0] as { code: string }).code)).toEqual(['vault', 'home'])
      // Negative: an ordinary folder passes.
      expect(resolveCliCwd({ metadata: { workingDirectories: [project] } })).toBe(realpathSync(project))
    } finally {
      resetPathPolicyForTests()
      vi.unstubAllEnvs()
      f.cleanup()
    }
  })

  it('delegates validation to the injected folder check (B12 seam)', () => {
    const folder = join(tmp, 'allowed-by-default')
    mkdirSync(folder)
    const checkFolder = vi.fn(() => ({ ok: false as const, code: 'providerHome' }))
    const cwd = resolveCliCwd({ metadata: { workingDirectories: [folder], conversationId: 'conv-5' } }, { root, dataDir, checkFolder })
    expect(checkFolder).toHaveBeenCalledWith(folder, { dataDir, root })
    expect(cwd).toBe(join(root, 'conv-5'))
  })
})
