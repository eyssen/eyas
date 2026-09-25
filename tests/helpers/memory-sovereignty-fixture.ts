// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// A throw-away instance layout for memory-sovereignty tests: an operator
// home with other tools' memory, an Obsidian vault found by its marker, an
// EYAS repo whose data dir holds the vault and the database, and a relocated
// workspaces root with two conversations. Generic names only; nothing here
// ever points at the real home.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { vi } from 'vitest'
import {
  createPathPolicy,
  workAreaRootsOf,
  type PathPolicy,
  type PathPolicyOptions,
} from '@shared/memory-sovereignty/path-policy.js'

export interface SovereigntyFixture {
  root: string
  /** The operator home (HOME). */
  home: string
  /** A note in another tool's memory: <home>/.claude/projects/x/memory/MEMORY.md */
  claudeMemory: string
  /** <home>/.grok/memory/a.md */
  grokMemory: string
  /** An Obsidian vault outside the home, found by its `.obsidian` marker. */
  vault: string
  vaultNote: string
  /** The EYAS repo (install root) that contains the data dir. */
  repo: string
  dataDir: string
  /** <dataDir>/vault/semantic/fact.md — EYAS's own memory, EYAS-only. */
  eyasVaultNote: string
  /** The database, deliberately outside the data dir. */
  databasePath: string
  /** Relocated workspaces root (outside the data dir). */
  workspacesRoot: string
  ownWorkspace: string
  ownFile: string
  otherWorkspace: string
  otherFile: string
  /** The policy for this layout (no Obsidian registry is read). */
  policy: PathPolicy
  /** Point HOME, EYAS_DATA_DIR and EYAS_WORKSPACES_DIR at the fixture (for code that resolves the instance itself). */
  stubInstanceEnv(): void
  cleanup(): void
}

function write(path: string, content: string): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
  return path
}

export function createSovereigntyFixture(overrides: Partial<PathPolicyOptions> = {}): SovereigntyFixture {
  const root = mkdtempSync(join(tmpdir(), 'eyas-sovereignty-'))
  const home = join(root, 'home')
  const repo = join(root, 'eyas')
  const dataDir = join(repo, 'data')
  const workspacesRoot = join(root, 'app-data', 'workspaces')
  const vault = join(root, 'notes')
  mkdirSync(join(vault, '.obsidian'), { recursive: true })

  const f = {
    root,
    home,
    claudeMemory: write(join(home, '.claude', 'projects', 'x', 'memory', 'MEMORY.md'), '- owner fact\n'),
    grokMemory: write(join(home, '.grok', 'memory', 'a.md'), 'grok fact\n'),
    vault,
    vaultNote: write(join(vault, 'daily', 'note.md'), 'vault sentinel\n'),
    repo,
    dataDir,
    eyasVaultNote: write(join(dataDir, 'vault', 'semantic', 'fact.md'), 'eyas fact\n'),
    databasePath: join(root, 'db', 'eyas.db'),
    workspacesRoot,
    ownWorkspace: join(workspacesRoot, 'conv-1'),
    ownFile: write(join(workspacesRoot, 'conv-1', 'out.md'), 'own workspace file\n'),
    otherWorkspace: join(workspacesRoot, 'conv-2'),
    otherFile: write(join(workspacesRoot, 'conv-2', 'secret.md'), 'other conversation\n'),
  }
  write(f.databasePath, '')
  write(join(repo, 'src', 'a.ts'), 'export {}\n')
  write(join(repo, 'CLAUDE.md'), '# project\n')
  write(join(repo, '.claude', 'settings.json'), '{}\n')
  write(join(repo, 'docs', 'MEMORY.md'), '# index\n')

  const policy = createPathPolicy({
    homeDir: home,
    env: {},
    dataDir,
    databasePath: f.databasePath,
    extraForeignPaths: [],
    workspacesRoot,
    workAreaRoots: workAreaRootsOf({ dataDir, workspacesDir: workspacesRoot }),
    providerHomes: [join(dataDir, 'cli-homes')],
    obsidianRegistryPaths: [],
    ...overrides,
  })

  return {
    ...f,
    policy,
    stubInstanceEnv() {
      vi.stubEnv('HOME', home)
      vi.stubEnv('EYAS_DATA_DIR', dataDir)
      vi.stubEnv('EYAS_WORKSPACES_DIR', workspacesRoot)
      vi.stubEnv('XDG_CONFIG_HOME', '')
      vi.stubEnv('XDG_DATA_HOME', '')
      vi.stubEnv('XDG_STATE_HOME', '')
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true })
    },
  }
}
