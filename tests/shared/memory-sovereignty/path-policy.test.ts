// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  createPathPolicy,
  getPathPolicy,
  installPathPolicy,
  pathPolicyOptionsFromInstance,
  resetPathPolicyForTests,
  RUN_SCRATCH_SEGMENT,
  workAreaRootsOf,
  type PathPolicy,
  type PathPolicyOptions,
} from '@shared/memory-sovereignty/path-policy.js'
import { RUN_SCRATCH_DIR } from '@modules/model/cli-runtime/workspaces.js'

let root: string
let home: string
let repo: string
let dataDir: string
let defaultWs: string
let relocatedWs: string
let vault: string
let registeredVault: string
let xdgConfig: string

function mk(...parts: string[]): string {
  const dir = join(...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

function policy(overrides: Partial<PathPolicyOptions> = {}): PathPolicy {
  const workspacesRoot = overrides.workspacesRoot ?? defaultWs
  return createPathPolicy({
    homeDir: home,
    env: {},
    dataDir,
    databasePath: join(dataDir, 'sqlite', 'eyas.db'),
    extraForeignPaths: [],
    workspacesRoot,
    workAreaRoots: workAreaRootsOf({ dataDir, workspacesDir: workspacesRoot }),
    providerHomes: [join(dataDir, 'cli-homes')],
    ...overrides,
  })
}

/** Every form (as given and realpath) of a path, for comparisons on macOS's /var → /private/var. */
function forms(p: string): string[] {
  try {
    return [p, realpathSync(p)]
  } catch {
    return [p]
  }
}

function insideOrEqual(path: string, dir: string): boolean {
  return forms(dir).some((d) => forms(path).some((p) => p === d || p.startsWith(`${d}/`)))
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'eyas-path-policy-'))
  home = mk(root, 'home')
  repo = mk(root, 'eyas')
  dataDir = mk(repo, 'data')
  defaultWs = mk(dataDir, 'workspaces')
  relocatedWs = mk(root, 'app-support', 'eyas', 'inst-1', 'workspaces')
  for (const ws of [defaultWs, relocatedWs]) {
    mk(ws, 'conv-1')
    mk(ws, 'conv-2')
    mk(ws, RUN_SCRATCH_SEGMENT, 'run-a')
    mk(ws, RUN_SCRATCH_SEGMENT, 'run-b')
  }
  mk(dataDir, 'vault', 'semantic')
  mk(dataDir, 'sqlite')
  mk(dataDir, 'studio', 'proj-1')
  mk(dataDir, 'browser', 'downloads')
  mk(dataDir, 'browser', 'profile')
  mk(dataDir, 'cli-homes', 'grok-cli', '.grok')
  mk(dataDir, 'cli-homes', 'kimi-cli')
  mk(home, '.claude', 'projects', 'x', 'memory')
  writeFileSync(join(home, '.claude.json'), '{}')
  mk(home, '.grok', 'memory')
  mk(home, '.codex', 'sessions')
  // A vault with its marker, somewhere unremarkable.
  vault = mk(root, 'notes', 'Some Vault')
  mk(vault, '.obsidian')
  mk(vault, 'deep', 'a')
  // A vault Obsidian knows only from its registry (no marker).
  registeredVault = mk(root, 'registered-vault')
  mk(home, '.config', 'obsidian')
  writeFileSync(
    join(home, '.config', 'obsidian', 'obsidian.json'),
    JSON.stringify({ vaults: { abc123: { path: registeredVault, ts: 1, open: true } } }),
  )
  xdgConfig = mk(root, 'xdg-config')
  mk(xdgConfig, 'opencode')
  // Ordinary repo content that must stay reachable.
  mk(repo, '.claude', 'agents')
  writeFileSync(join(repo, '.claude', 'settings.json'), '{}')
  mk(repo, 'docs')
  mk(repo, 'src')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

afterEach(() => {
  vi.unstubAllEnvs()
  resetPathPolicyForTests()
})

describe('classify — protected', () => {
  it('another tool\'s memory in the home directory', () => {
    const p = policy()
    const hit = p.classify(join(home, '.claude', 'projects', 'x', 'memory', 'MEMORY.md'))
    expect(hit).toMatchObject({ kind: 'foreign-memory', rule: 'foreign-store', ruleId: 'claude', category: 'cli' })
    expect(p.classify(join(home, '.claude.json'))).toMatchObject({ kind: 'foreign-memory', ruleId: 'claude-json' })
    expect(p.classify(join(home, '.claude.json.backup'))).toMatchObject({ kind: 'foreign-memory', ruleId: 'claude-json' })
    expect(p.classify(join(home, '.grok', 'memory', 'a.md'))).toMatchObject({ kind: 'foreign-memory', ruleId: 'grok' })
    expect(p.classify(join(home, '.codex', 'sessions', 'x'))).toMatchObject({ kind: 'foreign-memory', ruleId: 'codex' })
  })

  it('OpenCode under $XDG_CONFIG_HOME and under the fallback', () => {
    const p = policy({ env: { XDG_CONFIG_HOME: xdgConfig } })
    expect(p.classify(join(xdgConfig, 'opencode', 'opencode.json'))).toMatchObject({ kind: 'foreign-memory', ruleId: 'opencode-config' })
    expect(p.classify(join(home, '.config', 'opencode', 'x.json'))).toMatchObject({ kind: 'foreign-memory', ruleId: 'opencode-config' })
  })

  it('the same dot-folders under another user\'s home', () => {
    const p = policy()
    expect(p.classify('/home/other/.claude/settings.json')).toMatchObject({ kind: 'foreign-memory', rule: 'foreign-store-other-home' })
    expect(p.classify('/Users/other/.grok/memory/x.md')).toMatchObject({ kind: 'foreign-memory', rule: 'foreign-store-other-home' })
    expect(p.classify('/root/.claude.json')).toMatchObject({ kind: 'foreign-memory', ruleId: 'claude-json' })
  })

  it('a vault found by its .obsidian marker, at any depth, even for a new file', () => {
    const p = policy()
    expect(p.classify(join(vault, 'deep', 'a', 'note.md'))).toMatchObject({ kind: 'foreign-memory', rule: 'obsidian-vault' })
    expect(p.classify(join(vault, 'deep', 'a', 'b', 'c', 'new.md'))).toMatchObject({ kind: 'foreign-memory', rule: 'obsidian-vault' })
    expect(p.classify(vault)).toMatchObject({ kind: 'foreign-memory', rule: 'obsidian-vault' })
  })

  it('a vault registered only in obsidian.json', () => {
    const p = policy()
    expect(p.classify(join(registeredVault, 'note.md'))).toMatchObject({ kind: 'foreign-memory', rule: 'obsidian-vault' })
  })

  it('a workspace symlink into a vault (realpath), a new file under it and a dangling link', () => {
    const ws = join(defaultWs, 'conv-1')
    symlinkSync(vault, join(ws, 'vault-link'))
    symlinkSync(join(vault, 'not-yet.md'), join(ws, 'dangling.md'))
    const p = policy()
    const ctx = { workingDirectories: [ws] }
    expect(p.classify(join(ws, 'vault-link', 'deep', 'a'), ctx)).toMatchObject({ kind: 'foreign-memory', rule: 'obsidian-vault' })
    expect(p.classify(join(ws, 'vault-link', 'brand-new.md'), ctx)).toMatchObject({ kind: 'foreign-memory' })
    expect(p.classify(join(ws, 'dangling.md'), ctx)).toMatchObject({ kind: 'foreign-memory' })
  })

  it('(−) a link whose target walks ".." out of another link into a foreign store', () => {
    // ws/sub -> ~/.claude/projects ; ws/evil -> 'sub/../x' → a write to
    // ws/evil/newfile lands in ~/.claude/x/newfile.
    const ws = join(defaultWs, 'conv-2')
    symlinkSync(join(home, '.claude', 'projects'), join(ws, 'sub'))
    symlinkSync('sub/../x', join(ws, 'evil'))
    const p = policy()
    const ctx = { workingDirectories: [ws] }
    expect(p.classify(join(ws, 'evil', 'newfile'), ctx)).toMatchObject({ kind: 'foreign-memory', ruleId: 'claude' })
    // The same '..' written in the path itself (not folded by text).
    expect(p.classify(`${join(ws, 'sub')}/../settings.json`, ctx)).toMatchObject({ kind: 'foreign-memory', ruleId: 'claude' })
    // (+) the workspace's own new file stays allowed.
    expect(p.classify(join(ws, 'notes', 'new.md'), ctx)).toMatchObject({ kind: 'ok' })
  })

  it('a security.foreignMemoryPaths entry, absolute or ~-rooted', () => {
    const custom = mk(root, 'custom-store')
    const p = policy({ extraForeignPaths: [custom, '~/private-notes'] })
    expect(p.classify(join(custom, 'a.txt'))).toMatchObject({ kind: 'foreign-memory', rule: 'owner-path' })
    expect(p.classify(join(home, 'private-notes', 'x.md'))).toMatchObject({ kind: 'foreign-memory', rule: 'owner-path' })
  })

  it('memory segments anywhere: ai-memory, .obsidian, .<tool>/…/memory', () => {
    const p = policy()
    expect(p.classify(join(root, 'elsewhere', 'ai-memory', 'x.md'))).toMatchObject({ rule: 'memory-segment', ruleId: 'ai-memory' })
    expect(p.classify(join(repo, '.claude', 'memory', 'x.md'))).toMatchObject({ rule: 'memory-segment', ruleId: 'tool-memory' })
    expect(p.classify(join(repo, '.codex', 'nested', 'memories', 'x.md'))).toMatchObject({ rule: 'memory-segment', ruleId: 'tool-memory' })
    expect(p.classify(join(root, 'x', '.obsidian', 'app.json'))).toMatchObject({ rule: 'memory-segment', ruleId: 'obsidian-config' })
  })

  it('EYAS data: vault, database folder, provider homes', () => {
    const p = policy()
    expect(p.classify(join(dataDir, 'vault', 'semantic', 'x.md'))).toMatchObject({ kind: 'eyas-data', label: 'vault', rule: 'eyas-data' })
    expect(p.classify(join(dataDir, 'sqlite'))).toMatchObject({ kind: 'eyas-data', label: 'sqlite' })
    expect(p.classify(join(dataDir, 'browser', 'profile', 'Cookies'))).toMatchObject({ kind: 'eyas-data', label: 'browser' })
    expect(p.classify(join(dataDir, 'cli-homes', 'grok-cli', '.grok', 'auth.json'))).toMatchObject({ kind: 'provider-home', rule: 'provider-home' })
  })

  it('a database outside the data dir, with its WAL files', () => {
    const db = join(mk(root, 'db'), 'eyas.db')
    const p = policy({ databasePath: db })
    expect(p.classify(db)).toMatchObject({ kind: 'eyas-data', rule: 'eyas-database' })
    expect(p.classify(`${db}-wal`)).toMatchObject({ kind: 'eyas-data', rule: 'eyas-database' })
    expect(p.classify(`${db}.txt`)).toMatchObject({ kind: 'ok' })
  })

  it.each([
    ['default root (inside the data dir)', () => defaultWs],
    ['relocated root (outside the data dir)', () => relocatedWs],
  ])('another conversation\'s workspace — %s', (_name, wsOf) => {
    const ws = wsOf()
    const p = policy({ workspacesRoot: ws })
    const ctx = { workingDirectories: [join(ws, 'conv-1')] }
    expect(p.classify(join(ws, 'conv-2', 'x.md'), ctx)).toMatchObject({ kind: 'eyas-data', rule: 'other-workspace' })
    expect(p.classify(join(ws, RUN_SCRATCH_SEGMENT, 'run-a', 'x'), ctx)).toMatchObject({ rule: 'other-workspace' })
    expect(p.classify(ws, ctx)).toMatchObject({ rule: 'other-workspace' })
  })
})

describe('classify — allowed', () => {
  it.each([
    ['default root', () => defaultWs],
    ['relocated root', () => relocatedWs],
  ])('the model\'s own workspace — %s', (_name, wsOf) => {
    const ws = wsOf()
    const p = policy({ workspacesRoot: ws })
    const ctx = { workingDirectories: [join(ws, 'conv-1')] }
    expect(p.classify(join(ws, 'conv-1', 'out.md'), ctx).kind).toBe('ok')
    expect(p.classify(join(ws, 'conv-1', 'CLAUDE.md'), ctx).kind).toBe('ok')
    const runCtx = { workingDirectories: [join(ws, RUN_SCRATCH_SEGMENT, 'run-a')] }
    expect(p.classify(join(ws, RUN_SCRATCH_SEGMENT, 'run-a', 'x'), runCtx).kind).toBe('ok')
    expect(p.classify(join(ws, RUN_SCRATCH_SEGMENT, 'run-b', 'x'), runCtx).kind).toBe('eyas-data')
  })

  it('another workspace is not judged when the working directories are unknown', () => {
    expect(policy().classify(join(defaultWs, 'conv-2', 'x.md')).kind).toBe('ok')
  })

  it('Studio projects and browser downloads', () => {
    const p = policy()
    expect(p.classify(join(dataDir, 'studio', 'proj-1', 'index.html')).kind).toBe('ok')
    expect(p.classify(join(dataDir, 'browser', 'downloads', 'report.pdf')).kind).toBe('ok')
  })

  it('ordinary repository content, including .claude project config', () => {
    const p = policy()
    const ctx = { workingDirectories: [repo] }
    for (const path of [
      join(repo, '.claude', 'settings.json'),
      join(repo, '.claude', 'agents', 'x.md'),
      join(repo, 'docs', 'MEMORY.md'),
      join(repo, 'src', 'ai-memory-service.ts'),
      join(repo, 'src', 'modules', 'memory', 'index.ts'),
      join(repo, 'CLAUDE.md'),
      join(home, '.claude.jsonx'),
      join(home, 'Documents', 'plain.md'),
    ]) {
      expect(p.classify(path, ctx), path).toMatchObject({ kind: 'ok' })
    }
  })

  it('an EYAS work area is not a vault because some vault encloses it', () => {
    const enclosing = mk(root, 'vault-home')
    mk(enclosing, '.obsidian')
    const ws = mk(enclosing, 'eyas-workspaces')
    mk(ws, 'conv-1')
    const p = policy({ workspacesRoot: ws })
    expect(p.classify(join(ws, 'conv-1', 'x.md'), { workingDirectories: [join(ws, 'conv-1')] }).kind).toBe('ok')
    expect(p.classify(join(enclosing, 'note.md')).kind).toBe('foreign-memory')
  })

  it('a relative path gets the segment rules only', () => {
    const p = policy()
    expect(p.classify('docs/notes.md').kind).toBe('ok')
    expect(p.classify('x/ai-memory/y.md').kind).toBe('foreign-memory')
  })

  it('a work area that encloses the data dir is ignored', () => {
    const p = policy({ workAreaRoots: [repo] })
    expect(p.classify(join(dataDir, 'vault', 'x.md')).kind).toBe('eyas-data')
  })
})

describe('evaluateToolInput', () => {
  const wsCtx = () => ({ workingDirectories: [join(defaultWs, 'conv-1')] })

  it('checks path fields of every tool, ~ expanded', () => {
    const p = policy()
    expect(p.evaluateToolInput('Read', { file_path: '~/.claude/projects/x/memory/MEMORY.md' }, wsCtx())).toMatchObject({
      kind: 'foreign-memory',
      field: 'file_path',
      path: join(home, '.claude', 'projects', 'x', 'memory', 'MEMORY.md'),
    })
    expect(p.evaluateToolInput('mcp__eyas__read_file', { path: join(vault, 'deep', 'a') }, wsCtx())).toMatchObject({ field: 'path' })
    expect(p.evaluateToolInput('browser_upload', { paths: ['a.txt', join(dataDir, 'vault', 'x')] }, wsCtx())).toMatchObject({ kind: 'eyas-data', field: 'paths' })
  })

  it('reads Grok ACP rawInput shapes (ReadFile, ListDir, Task cwd)', () => {
    const p = policy()
    expect(p.evaluateToolInput('read_file', { variant: 'ReadFile', target_file: join(home, '.grok', 'memory', 'a.md') }, wsCtx())).toMatchObject({ field: 'target_file' })
    expect(p.evaluateToolInput('list_dir', { variant: 'ListDir', target_directory: join(home, '.codex') }, wsCtx())).toMatchObject({ field: 'target_directory' })
    expect(p.evaluateToolInput('Task', { prompt: 'x', cwd: join(dataDir, 'vault') }, wsCtx())).toMatchObject({ field: 'cwd' })
  })

  it('resolves relative paths against the working directory', () => {
    const p = policy()
    expect(p.evaluateToolInput('Read', { file_path: '../conv-2/secret.md' }, wsCtx())).toMatchObject({ rule: 'other-workspace' })
    expect(p.evaluateToolInput('Read', { file_path: 'notes/out.md' }, wsCtx())).toBeNull()
  })

  it('reads shell commands and argv', () => {
    const p = policy()
    expect(p.evaluateToolInput('Bash', { command: 'cat ~/.grok/memory/x' }, wsCtx())).toMatchObject({ field: 'command', ruleId: 'grok' })
    expect(p.evaluateToolInput('run_command', { command: 'ls', args: ['-la', '~/.codex'] }, wsCtx())).toMatchObject({ field: 'args' })
    expect(p.evaluateToolInput('Bash', { command: 'git status && ls src' }, wsCtx())).toBeNull()
    expect(p.evaluateToolInput('Bash', { command: 'grep -r ai-memory src' }, wsCtx())).toBeNull()
  })

  it('treats a Glob pattern as a path, a Grep pattern never', () => {
    const p = policy()
    expect(p.evaluateToolInput('Glob', { pattern: `${vault}/**/*.md` }, wsCtx())).toMatchObject({ field: 'pattern', rule: 'obsidian-vault' })
    expect(p.evaluateToolInput('glob', { pattern: '**/ai-memory/**' }, wsCtx())).toMatchObject({ field: 'pattern', ruleId: 'ai-memory' })
    // (The repository root holds the EYAS data dir: its searches are judged in 'searches' below.)
    const src = join(repo, 'src')
    expect(p.evaluateToolInput('Glob', { pattern: '**/*.ts', path: src }, wsCtx())).toBeNull()
    expect(p.evaluateToolInput('Grep', { pattern: 'ai-memory', path: src }, { workingDirectories: [repo] })).toBeNull()
    expect(p.evaluateToolInput('grep', { variant: 'Grep', pattern: '.claude/memory', path: src, glob: '*.md' }, { workingDirectories: [repo] })).toBeNull()
  })

  it('only file: URLs are paths', () => {
    const p = policy()
    expect(p.evaluateToolInput('browser_navigate', { url: `file://${join(home, '.claude.json')}` }, wsCtx())).toMatchObject({ field: 'url' })
    expect(p.evaluateToolInput('browser_navigate', { url: 'https://example.com/.claude/memory' }, wsCtx())).toBeNull()
  })

  it('looks into nested input objects', () => {
    const p = policy()
    expect(p.evaluateToolInput('MultiEdit', { edits: [{ file_path: join(home, '.gemini', 'GEMINI.md') }] }, wsCtx())).toMatchObject({ ruleId: 'gemini' })
  })

  it('ignores non-object input and non-path fields', () => {
    const p = policy()
    expect(p.evaluateToolInput('Read', 'not an object', wsCtx())).toBeNull()
    expect(p.evaluateToolInput('Write', { file_path: join(defaultWs, 'conv-1', 'a.md'), content: 'see ~/.claude/memory' }, wsCtx())).toBeNull()
  })
})

describe('evaluateToolInput — searches rooted above a protected place (K1)', () => {
  let proj: string
  let notesParent: string
  let linked: string
  let regParent: string
  let regFile: string

  beforeAll(() => {
    // An ordinary project: nothing protected below it.
    proj = mk(root, 'proj')
    mk(proj, 'src', 'lib')
    writeFileSync(join(proj, 'src', 'lib', 'a.ts'), 'export const a = 1\n')
    writeFileSync(join(proj, 'README.md'), '# proj\n')
    mk(proj, '.claude', 'commands')
    writeFileSync(join(proj, '.claude', 'settings.json'), '{}')
    mk(proj, 'node_modules', 'pkg', 'ai-memory')
    // A folder holding a vault known only by its .obsidian marker.
    notesParent = mk(root, 'marker-parent')
    mk(notesParent, 'src')
    mk(notesParent, 'Private Notes', '.obsidian')
    writeFileSync(join(notesParent, 'Private Notes', 'n.md'), 'secret\n')
    // A project with a symlink into another tool's memory.
    linked = mk(root, 'linked-proj')
    symlinkSync(join(home, '.claude'), join(linked, 'claude-link'))
    // A vault known only from a registry (no marker), inside an ordinary folder.
    regParent = mk(root, 'reg-parent')
    mk(regParent, 'Vault Two', 'daily')
    mk(regParent, 'code')
    regFile = join(root, 'reg-obsidian.json')
    writeFileSync(regFile, JSON.stringify({ vaults: { v2: { path: join(regParent, 'Vault Two') } } }))
  })

  const inProj = () => ({ workingDirectories: [proj] })
  const inRepo = () => ({ workingDirectories: [repo] })

  it('(+) Claude Code Grep and Glob rooted at the home reach other tools\' memory', () => {
    const p = policy()
    const grep = p.evaluateToolInput('Grep', { pattern: 'token', path: home, glob: '**/memory/*.md', output_mode: 'content' }, inProj())
    expect(grep).toMatchObject({ kind: 'foreign-memory', field: 'path', searchRoot: home })
    const glob = p.evaluateToolInput('Glob', { pattern: '**/MEMORY.md', path: '~' }, inProj())
    expect(glob).toMatchObject({ kind: 'foreign-memory', field: 'path', searchRoot: home })
    // An absolute pattern searches from its literal part.
    expect(p.evaluateToolInput('Glob', { pattern: `${home}/**/MEMORY.md` }, inProj())).toMatchObject({ field: 'pattern', searchRoot: home })
    // No glob at all: everything below the home.
    expect(p.evaluateToolInput('LS', { path: home }, inProj())).toMatchObject({ kind: 'foreign-memory', searchRoot: home })
  })

  it('(+) Grok grep and list_dir (ACP rawInput) rooted above a store are refused', () => {
    const p = policy()
    expect(p.evaluateToolInput('Grep', { variant: 'Grep', pattern: 'x', path: home, glob: null, '-i': false }, inProj()))
      .toMatchObject({ kind: 'foreign-memory', searchRoot: home })
    expect(p.evaluateToolInput('AcpUnmappedTool', { variant: 'ListDir', target_directory: home, _acp: { kind: 'other' } }, inProj()))
      .toMatchObject({ field: 'target_directory', searchRoot: home })
  })

  it('(+) a folder holding a vault: by its registry entry and by its .obsidian marker (bounded scan)', () => {
    const p = policy({ obsidianRegistryPaths: [regFile] })
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: regParent }, inProj())).toMatchObject({
      kind: 'foreign-memory', rule: 'obsidian-vault', path: join(regParent, 'Vault Two'), searchRoot: regParent,
    })
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: notesParent }, inProj())).toMatchObject({
      kind: 'foreign-memory', rule: 'obsidian-vault', path: join(notesParent, 'Private Notes'), searchRoot: notesParent,
    })
  })

  it('(−) globs that cannot reach the protected place keep the search allowed; ones that may, do not', () => {
    const p = policy({ obsidianRegistryPaths: [regFile] })
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: regParent, glob: 'code/**/*.ts' }, inProj())).toBeNull()
    expect(p.evaluateToolInput('Glob', { pattern: 'src/**', path: notesParent }, inProj())).toBeNull()
    // A glob without a slash matches at any depth, like ripgrep's.
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: regParent, glob: '*.md' }, inProj())).toMatchObject({ searchRoot: regParent })
    // Brace alternatives: one reaching branch is enough.
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: regParent, glob: '{code,Vault Two}/**' }, inProj())).toMatchObject({ searchRoot: regParent })
    // Exclusions never narrow the set.
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: home, glob: '!**/.claude/**' }, inProj())).toMatchObject({ searchRoot: home })
  })

  it('(+) a symlink below the folder into a protected place', () => {
    const p = policy()
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: linked }, inProj())).toMatchObject({ kind: 'foreign-memory', searchRoot: linked })
  })

  it('(+) a Grep include glob naming a memory folder is refused by its segments', () => {
    const p = policy()
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: join(proj, 'src'), glob: '.claude/**/memory/**' }, inProj()))
      .toMatchObject({ kind: 'foreign-memory', field: 'glob', ruleId: 'tool-memory' })
  })

  it('(+) shell searches: recursive programs, cd chains, wrappers, glob words and argv', () => {
    const p = policy()
    const refused = [
      'grep -r token ~',
      'grep -rn token $HOME',
      `rg --hidden token ${home}`,
      'find ~ -name MEMORY.md',
      'ls -R ~',
      'du -a ~',
      'tree ~',
      'cd ~ && grep -rn token .',
      'FOO=1 xargs -0 grep -R token ~ < list',
      `bash -c "grep -r token ${home}"`,
      'cat ~/.*/projects/*/memory/*.md',
      'cp -r ~ /tmp/copy',
      'locate MEMORY.md',
    ]
    for (const command of refused) {
      expect(p.evaluateToolInput('Bash', { command, description: 'x' }, inProj()), command).toMatchObject({ field: 'command' })
    }
    expect(p.evaluateToolInput('run_command', { command: 'grep', args: ['-r', 'token', home] }, inProj())).toMatchObject({ field: 'args', searchRoot: home })
    expect(p.evaluateToolInput('AcpUnmappedTool', { variant: 'Bash', command: `rg token ${home}` }, inProj())).toMatchObject({ searchRoot: home })
  })

  it('(−) ordinary searches in an ordinary project are untouched, on every channel', () => {
    const p = policy()
    expect(p.evaluateToolInput('Grep', { pattern: 'x' }, inProj())).toBeNull()
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: proj, glob: '*.ts', output_mode: 'content' }, inProj())).toBeNull()
    expect(p.evaluateToolInput('Glob', { pattern: '**/*.ts' }, inProj())).toBeNull()
    expect(p.evaluateToolInput('LS', { path: proj }, inProj())).toBeNull()
    expect(p.evaluateToolInput('Grep', { variant: 'Grep', pattern: 'x', path: proj, glob: null }, inProj())).toBeNull()
    for (const command of ['grep -rn token .', 'rg token', 'find . -name "*.ts"', 'ls -R', 'tree src', 'ls ~', 'cat src/lib/*.ts', 'git grep token']) {
      expect(p.evaluateToolInput('Bash', { command }, inProj()), command).toBeNull()
    }
    expect(p.evaluateToolInput('run_command', { command: 'rg', args: ['token', 'src'] }, inProj())).toBeNull()
    // A search pointed at a file is not a folder search.
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: join(proj, 'README.md') }, inProj())).toBeNull()
  })

  it('(+) a folder that encloses the EYAS data dir (a dev checkout): default-rooted and data-reaching searches are refused, narrowed ones pass', () => {
    const p = policy()
    expect(p.evaluateToolInput('Grep', { pattern: 'x' }, inRepo())).toMatchObject({ kind: 'eyas-data', field: 'cwd', searchRoot: repo })
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: repo, glob: 'data/vault/**' }, inRepo())).toMatchObject({ kind: 'eyas-data', searchRoot: repo })
    expect(p.evaluateToolInput('Glob', { pattern: '*.md', path: repo }, inRepo())).toMatchObject({ kind: 'eyas-data' })
    expect(p.evaluateToolInput('Bash', { command: 'grep -rn token .' }, inRepo())).toMatchObject({ kind: 'eyas-data', field: 'command' })
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: repo, glob: 'src/**/*.ts' }, inRepo())).toBeNull()
    expect(p.evaluateToolInput('Glob', { pattern: 'docs/**', path: repo }, inRepo())).toBeNull()
    expect(p.evaluateToolInput('Bash', { command: 'grep -rn token src docs' }, inRepo())).toBeNull()
    expect(p.evaluateToolInput('Bash', { command: 'ls *.md' }, inRepo())).toBeNull()
  })

  it('(−) writing a file through a here-document is no search, even in a folder that holds EYAS\'s data (JSDoc, CSS comments, commit messages, scripts for other programs)', () => {
    const p = policy()
    for (const command of [
      "cat > src/foo.ts <<'EOF'\n/**\n * Doc\n */\nexport const a = 1\nEOF",
      "cat > src/a.css <<'EOF'\n/* header */\nbody {}\nEOF",
      'git commit -m "$(cat <<\'EOF\'\nfix: scope (K1)\n\n* bullet\nEOF\n)"',
      "python3 - <<'EOF'\nimport os\nprint(os.getcwd())\nEOF",
      "cat > scripts/find.sh <<'EOF'\nfind / -name x\ngrep -r x ~\nEOF",
    ]) {
      expect(p.evaluateToolInput('Bash', { command }, inRepo()), command).toBeNull()
      expect(p.evaluateToolInput('Bash', { command }, inProj()), command).toBeNull()
    }
  })

  it('(+) shell grammar does not hide a search: reserved words, groups, eval, redirections, xargs, braces, stdin scripts', () => {
    const p = policy()
    for (const command of [
      'if true; then grep -r token ~; fi',
      '{ grep -r token ~; }',
      '! grep -r token ~',
      'while true; do grep -r token ~; break; done',
      'coproc grep -r token ~',
      'eval grep -r token ~',
      'grep -r token 2>/dev/null ~',
      'grep -r token &>/dev/null ~',
      'grep -r token < /dev/null ~',
      '>/tmp/o grep -r token ~',
      'ls -d ~ | xargs grep -r token',
      'find . -maxdepth 0 | xargs -I{} grep -r token {}/..',
      'grep -r token ~/{.,}',
      "bash <<'EOF'\ngrep -r token ~\nEOF",
      "bash <<< 'grep -r token ~'",
      "cat > a.md <<'EOF'\ndon't\nEOF\ngrep -r token ~",
    ]) {
      expect(p.evaluateToolInput('Bash', { command }, inProj()), command).toMatchObject({ field: 'command' })
    }
  })

  it('(+) a script run as one quoted word names paths like the line itself: sh -c, eval, a here-document for a shell', () => {
    const p = policy()
    for (const command of [
      "bash -c 'cat ~/.claude/CLAUDE.md'",
      "sh -lc 'head ~/.grok/memory/a.md'",
      'eval "cat ~/.claude/CLAUDE.md"',
      "bash <<'EOF'\ncat ~/.claude/CLAUDE.md\nEOF",
      'cat ~/{.claude,x}/CLAUDE.md',
    ]) {
      expect(p.evaluateToolInput('Bash', { command }, inProj()), command).toMatchObject({ kind: 'foreign-memory', field: 'command' })
    }
    expect(p.evaluateToolInput('Bash', { command: "bash -c 'echo hello'" }, inProj())).toBeNull()
  })

  it('(−) EYAS\'s own grep and glob are never refused for an enclosing folder: their walk leaves protected places out', () => {
    const p = policy()
    expect(p.evaluateToolInput('grep', { pattern: 'x', path: repo }, inRepo())).toBeNull()
    expect(p.evaluateToolInput('mcp__eyas__glob', { pattern: '**/*.md', path: repo }, inRepo())).toBeNull()
    expect(p.evaluateToolInput('glob', { pattern: '**/*.md' }, { workingDirectories: [home] })).toBeNull()
  })

  it('(+) a folder above a relocated workspaces root reaches other conversations\' workspaces', () => {
    const p = policy({ workspacesRoot: relocatedWs })
    const parent = join(relocatedWs, '..')
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: parent }, { workingDirectories: [join(relocatedWs, 'conv-1')] }))
      .toMatchObject({ kind: 'eyas-data', rule: 'other-workspace', searchRoot: resolve(parent) })
  })

  it('(−) the scan never descends node_modules or VCS folders', () => {
    const p = policy()
    // proj/node_modules/pkg/ai-memory would be an ai-memory folder.
    expect(p.evaluateToolInput('Grep', { pattern: 'x', path: proj }, inProj())).toBeNull()
  })
})

describe('kernelDenyList', () => {
  it('lists private data, stores, vaults and sibling workspaces — never a work area or an excluded home', () => {
    const odd = mk(root, 'stores', 'weird[1]')
    const p = policy({ extraForeignPaths: [odd] })
    // Warm the marker cache so the marker-found vault is known.
    p.classify(join(vault, 'deep', 'a'))
    const own = join(defaultWs, 'conv-1')
    const grokHome = join(dataDir, 'cli-homes', 'grok-cli')
    const list = p.kernelDenyList({ exclude: [grokHome], workingDirectories: [own] })

    const has = (path: string): boolean => list.some((e) => forms(path).includes(e))
    expect(has(join(dataDir, 'vault'))).toBe(true)
    expect(has(join(dataDir, 'sqlite'))).toBe(true)
    expect(has(join(dataDir, 'browser', 'profile'))).toBe(true)
    expect(has(join(dataDir, 'cli-homes', 'kimi-cli'))).toBe(true)
    expect(has(join(home, '.claude'))).toBe(true)
    expect(has(join(home, '.claude.json'))).toBe(true)
    expect(has(vault)).toBe(true)
    expect(has(registeredVault)).toBe(true)
    expect(has(join(defaultWs, 'conv-2'))).toBe(true)
    expect(has(join(defaultWs, RUN_SCRATCH_SEGMENT, 'run-a'))).toBe(true)
    expect(has(join(root, 'stores'))).toBe(true)

    for (const entry of list) {
      expect(entry, entry).not.toMatch(/[*?[]/)
      // A work-area root is never denied or enclosed (its sibling workspaces are listed on purpose).
      for (const area of workAreaRootsOf({ dataDir, workspacesDir: defaultWs })) {
        expect(insideOrEqual(area, entry), `${entry} covers ${area}`).toBe(false)
      }
      for (const keep of [grokHome, own]) {
        expect(insideOrEqual(keep, entry) || insideOrEqual(entry, keep), `${entry} vs ${keep}`).toBe(false)
      }
      expect(insideOrEqual(home, entry), `${entry} covers the home`).toBe(false)
    }
    expect(list.some((e) => insideOrEqual(e, join(dataDir, 'browser', 'downloads')))).toBe(false)
  })

  it('lists no workspace at all without the working directories', () => {
    const list = policy().kernelDenyList()
    expect(list.some((e) => insideOrEqual(e, defaultWs))).toBe(false)
  })
})

describe('isProtectedDir and describe', () => {
  it('flags protected folders for folder walks', () => {
    const p = policy()
    expect(p.isProtectedDir(join(dataDir, 'vault'))).toBe(true)
    expect(p.isProtectedDir(vault)).toBe(true)
    expect(p.isProtectedDir(join(repo, 'src'))).toBe(false)
    expect(p.isProtectedDir(join(dataDir, 'studio'))).toBe(false)
  })

  it('describes stores, owner paths and detected vaults', () => {
    const p = policy({ extraForeignPaths: [join(root, 'custom-2'), 'relative/path'] })
    p.classify(join(vault, 'deep'))
    const d = p.describe()
    expect(d.foreignStores.find((s) => s.id === 'claude')).toMatchObject({ present: true, paths: [join(home, '.claude')] })
    expect(d.foreignStores.find((s) => s.id === 'cursor')).toMatchObject({ present: false })
    expect(d.foreignMemoryPaths).toEqual([{ path: join(root, 'custom-2'), present: false }])
    expect(d.ignoredForeignMemoryPaths).toEqual(['relative/path'])
    expect(d.detectedVaults).toEqual(expect.arrayContaining([
      { path: registeredVault, source: 'registry' },
      expect.objectContaining({ source: 'marker' }),
    ]))
    expect(d.workAreaRoots).toContain(join(dataDir, 'studio'))
  })

  it('stays within the 5 ms budget once warm', () => {
    const p = policy()
    const paths = [join(repo, 'src', 'a.ts'), join(vault, 'deep', 'a', 'n.md'), join(defaultWs, 'conv-1', 'x.md')]
    for (const path of paths) p.classify(path)
    const started = performance.now()
    for (let i = 0; i < 100; i++) for (const path of paths) p.classify(path)
    expect((performance.now() - started) / 300).toBeLessThan(5)
  })
})

describe('process-global policy', () => {
  it('lazily builds a default from the instance layout — never no policy', () => {
    const lazyHome = mk(root, 'lazy-home')
    const lazyData = mk(root, 'lazy-data')
    const lazyWs = mk(root, 'lazy-ws')
    vi.stubEnv('HOME', lazyHome)
    vi.stubEnv('EYAS_DATA_DIR', lazyData)
    vi.stubEnv('EYAS_WORKSPACES_DIR', lazyWs)
    resetPathPolicyForTests()
    const p = getPathPolicy()
    const d = p.describe()
    expect(d.dataDir).toBe(resolve(lazyData))
    expect(d.workspacesRoot).toBe(resolve(lazyWs))
    expect(d.workAreaRoots).toEqual([resolve(lazyWs), join(lazyData, 'studio'), join(lazyData, 'browser', 'downloads')])
    expect(d.providerHomes).toEqual([join(lazyData, 'cli-homes')])
    expect(p.classify(join(lazyData, 'vault', 'x.md')).kind).toBe('eyas-data')
    expect(p.classify(join(lazyHome, '.claude', 'x')).kind).toBe('foreign-memory')
    expect(getPathPolicy()).toBe(p)
  })

  it('an installed policy wins over the default', () => {
    const custom = policy()
    installPathPolicy(custom)
    expect(getPathPolicy()).toBe(custom)
  })

  it('options from an instance resolve the configured database path', () => {
    const opts = pathPolicyOptionsFromInstance(
      { dataDir, databasePath: join(dataDir, 'sqlite', 'eyas.db'), workspacesDir: relocatedWs, cliHomesDir: join(dataDir, 'cli-homes') },
      { databasePath: 'rel/eyas.db', foreignMemoryPaths: ['/x'], homeDir: home, env: {} },
    )
    expect(opts.databasePath).toBe(resolve('rel/eyas.db'))
    expect(opts.workspacesRoot).toBe(relocatedWs)
    expect(opts.extraForeignPaths).toEqual(['/x'])
  })

  it('keeps the run scratch segment in step with the CLI runtime', () => {
    expect(RUN_SCRATCH_SEGMENT).toBe(RUN_SCRATCH_DIR)
  })
})
