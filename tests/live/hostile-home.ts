// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Shared builder of a HOSTILE temporary home for CLI isolation proofs.
 *
 * It plants the operator-side configuration a CLI provider must NOT pick up
 * when EYAS spawns it: an always-approve Grok config with memory and Claude
 * compatibility on, sentinel rules and AGENTS files, a Claude settings file
 * that allows everything and runs a Stop hook, a Claude MCP server, host
 * CLAUDE.md, a Claude project memory file, Claude skills and agents, Kimi and
 * OpenCode configs, an agent-skills dir and an Obsidian-style vault. It also
 * creates an in-root project fixture (the conversation workspace) with its own
 * AGENTS.md, CLAUDE.md, repo-local Grok MCP/hook config and Claude project
 * config.
 *
 * Every command a CLI could execute from these files (MCP servers, hooks) only
 * appends one line to a file under `<root>/markers/`, so a proof can assert
 * "nothing ran" by checking that directory stays empty.
 *
 * Used by scripts/cli-isolation-spike.ts (A1) and by the single live lane
 * tests/live/cli-isolation.live.test.ts (A14). It never reads, writes or
 * points at the real home: the target is refused when it resolves to the real
 * home directory, to an ancestor of it, or to anywhere inside it outside the
 * OS temp dir.
 */

import { createHash, randomBytes } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Thrown before anything is written when a target would touch the real home. */
export class HostileHomeRefusedError extends Error {
  constructor(
    readonly target: string,
    readonly reason: 'real-home' | 'real-home-ancestor' | 'inside-real-home' | 'not-empty',
  ) {
    super(`Refusing to build a hostile home at ${target}: ${reason}`)
    this.name = 'HostileHomeRefusedError'
  }
}

/** Sentinel strings planted in files a CLI must never load. */
export interface HostileSentinels {
  grokHomeAgents: string
  grokHomeRule: string
  claudeHomeMd: string
  claudeProjectMemory: string
  claudeHomeSkill: string
  claudeHomeAgent: string
  agentsHomeSkill: string
  opencodeHomeAgents: string
  vaultNote: string
  projectAgents: string
  projectClaudeMd: string
}

/** Names of the MCP servers the hostile files declare (each writes a marker when spawned). */
export const HOSTILE_MCP_SERVERS = {
  grokHome: 'eyas-sentinel-grok-home',
  claudeHome: 'eyas-sentinel-claude-home',
  grokProject: 'eyas-sentinel-grok-project',
  claudeProject: 'eyas-sentinel-claude-project',
  opencodeHome: 'eyas-sentinel-opencode-home',
} as const

/** Marker file names written by the hostile hooks and MCP servers. */
export const HOSTILE_MARKERS = {
  grokHomeMcp: 'grok-home-mcp',
  grokHomeHook: 'grok-home-hook',
  claudeHomeMcp: 'claude-home-mcp',
  claudeHomeStopHook: 'claude-home-stop-hook',
  claudeHomeSessionHook: 'claude-home-session-hook',
  grokProjectMcp: 'grok-project-mcp',
  grokProjectHook: 'grok-project-hook',
  claudeProjectMcp: 'claude-project-mcp',
  claudeProjectHook: 'claude-project-hook',
  opencodeHomeMcp: 'opencode-home-mcp',
} as const

export interface HostileHome {
  /** Temp root holding everything below. */
  root: string
  /** The hostile HOME (stands in for the operator's machine). */
  home: string
  /** In-root project fixture (a conversation workspace with hostile project config). */
  project: string
  /** Obsidian-style vault inside the hostile home. */
  vault: string
  /** Directory the hostile MCP servers and hooks append to. Must stay empty under isolation. */
  markers: string
  /** Parent directory for candidate EYAS-owned CLI homes (`<root>/eyas/cli-homes`). */
  eyasHomes: string
  /** Claude Code's project slug for `project` (its ~/.claude/projects/<slug> dir name). */
  claudeProjectSlug: string
  sentinels: HostileSentinels
  /** Absolute path of every file the builder planted. */
  files: string[]
  /** Removes the whole root. */
  cleanup(): void
}

export interface BuildHostileHomeOptions {
  /**
   * Directory to build into. It must not exist yet or be empty. Default: a
   * fresh `mkdtemp` under the OS temp dir.
   */
  root?: string
}

/** The real home directories of the current user: HOME and the passwd entry. */
export function realHomeDirs(): string[] {
  const dirs = new Set<string>()
  const candidates: Array<() => string> = [() => homedir(), () => userInfo().homedir]
  for (const read of candidates) {
    try {
      const dir = read()
      if (dir) dirs.add(resolveExisting(dir))
    } catch {
      /* no passwd entry, e.g. in some containers */
    }
  }
  return [...dirs]
}

/**
 * Resolves a path through symlinks even when its tail does not exist yet:
 * the nearest existing ancestor is realpath'd and the rest is appended.
 */
export function resolveExisting(target: string): string {
  const abs = resolve(target)
  let head = abs
  const tail: string[] = []
  while (!existsSync(head)) {
    const parent = dirname(head)
    if (parent === head) break
    tail.unshift(basename(head))
    head = parent
  }
  let real = head
  try {
    real = realpathSync(head)
  } catch {
    /* unreadable ancestor: keep the lexical path */
  }
  return tail.length > 0 ? join(real, ...tail) : real
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Throws HostileHomeRefusedError when `target` is (or resolves to) a real home
 * directory, an ancestor of one, or a path inside one that is not also inside
 * the OS temp dir. Pure check: never writes.
 */
export function assertNotRealHome(target: string): void {
  const resolved = resolveExisting(target)
  const temp = resolveExisting(tmpdir())
  for (const home of realHomeDirs()) {
    if (resolved === home) throw new HostileHomeRefusedError(target, 'real-home')
    if (isInside(home, resolved)) throw new HostileHomeRefusedError(target, 'real-home-ancestor')
    if (isInside(resolved, home) && !isInside(resolved, temp)) {
      throw new HostileHomeRefusedError(target, 'inside-real-home')
    }
  }
}

/** TOML basic string (ASCII-safe; paths from mkdtemp are ASCII). */
export function tomlString(value: string): string {
  let out = '"'
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (ch === '"') out += '\\"'
    else if (ch === '\\') out += '\\\\'
    else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).padStart(4, '0')}`
    else out += ch
  }
  return out + '"'
}

/** Single-quoted POSIX shell word. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Claude Code's directory name for a project path under ~/.claude/projects. */
export function claudeProjectSlug(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, '-')
}

export function buildHostileHome(opts: BuildHostileHomeOptions = {}): HostileHome {
  let root: string
  if (opts.root) {
    assertNotRealHome(opts.root)
    assertNotRealHome(join(opts.root, 'home'))
    if (existsSync(opts.root) && readdirSync(opts.root).length > 0) {
      throw new HostileHomeRefusedError(opts.root, 'not-empty')
    }
    mkdirSync(opts.root, { recursive: true })
    root = realpathSync(opts.root)
  } else {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'eyas-hostile-')))
  }
  // Re-check after creation: a racing symlink swap must not redirect writes.
  assertNotRealHome(root)

  const home = join(root, 'home')
  const project = join(root, 'project')
  const markers = join(root, 'markers')
  const eyasHomes = join(root, 'eyas', 'cli-homes')
  const vault = join(home, 'Documents', 'EyasSentinelVault')
  for (const dir of [home, project, markers, eyasHomes]) mkdirSync(dir, { recursive: true, mode: 0o700 })

  const nonce = randomBytes(6).toString('hex')
  const sentinel = (kind: string) => `EYAS-SENTINEL-${kind}-${nonce}`
  const sentinels: HostileSentinels = {
    grokHomeAgents: sentinel('grok-home-agents'),
    grokHomeRule: sentinel('grok-home-rule'),
    claudeHomeMd: sentinel('claude-home-md'),
    claudeProjectMemory: sentinel('claude-project-memory'),
    claudeHomeSkill: sentinel('claude-home-skill'),
    claudeHomeAgent: sentinel('claude-home-agent'),
    agentsHomeSkill: sentinel('agents-home-skill'),
    opencodeHomeAgents: sentinel('opencode-home-agents'),
    vaultNote: sentinel('vault-note'),
    projectAgents: sentinel('project-agents'),
    projectClaudeMd: sentinel('project-claude-md'),
  }

  const files: string[] = []
  const plant = (path: string, content: string) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    // 'wx': never overwrite, never follow a pre-existing file.
    writeFileSync(path, content, { flag: 'wx', mode: 0o600 })
    files.push(path)
  }
  const markerCmd = (name: string) => `echo ${name} >> ${shellQuote(join(markers, name))}`
  const shArgs = (name: string) => ['-c', markerCmd(name)]

  // ── Grok: operator config with every isolation switch in the wrong position ──
  plant(
    join(home, '.grok', 'config.toml'),
    [
      '# HOSTILE fixture: an operator config EYAS must never inherit.',
      '[ui]',
      'permission_mode = "always-approve"',
      'remember_tool_approvals = true',
      '',
      '[memory]',
      'enabled = true',
      '',
      '[memory_v2]',
      'enabled = true',
      '',
      '[cli]',
      'use_leader = true',
      '',
      '[telemetry]',
      'trace_upload = true',
      '',
      '[compat.claude]',
      'skills = true',
      'rules = true',
      'agents = true',
      'mcps = true',
      'hooks = true',
      'sessions = true',
      '',
      '[compat.cursor]',
      'skills = true',
      'rules = true',
      'mcps = true',
      'hooks = true',
      '',
      `[mcp_servers.${HOSTILE_MCP_SERVERS.grokHome}]`,
      'command = "/bin/sh"',
      `args = [${shArgs(HOSTILE_MARKERS.grokHomeMcp).map(tomlString).join(', ')}]`,
      '',
    ].join('\n'),
  )
  plant(join(home, '.grok', 'AGENTS.md'), `# Host Grok rules\n\n${sentinels.grokHomeAgents}\n`)
  plant(join(home, '.grok', 'rules', 'x.md'), `# Host Grok rule\n\n${sentinels.grokHomeRule}\n`)
  plant(
    join(home, '.grok', 'hooks', 'eyas-sentinel.json'),
    JSON.stringify(
      { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: markerCmd(HOSTILE_MARKERS.grokHomeHook) }] }] } },
      null,
      2,
    ) + '\n',
  )

  // ── Claude Code: allow-all settings with hooks, host MCP, memory, skills ──
  plant(
    join(home, '.claude', 'settings.json'),
    JSON.stringify(
      {
        permissions: { allow: ['Read(*)', 'Bash', 'Edit'], defaultMode: 'bypassPermissions' },
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: markerCmd(HOSTILE_MARKERS.claudeHomeStopHook) }] }],
          SessionStart: [{ hooks: [{ type: 'command', command: markerCmd(HOSTILE_MARKERS.claudeHomeSessionHook) }] }],
        },
      },
      null,
      2,
    ) + '\n',
  )
  plant(
    join(home, '.claude.json'),
    JSON.stringify(
      {
        mcpServers: {
          [HOSTILE_MCP_SERVERS.claudeHome]: {
            type: 'stdio',
            command: '/bin/sh',
            args: shArgs(HOSTILE_MARKERS.claudeHomeMcp),
          },
        },
      },
      null,
      2,
    ) + '\n',
  )
  plant(join(home, '.claude', 'CLAUDE.md'), `# Host Claude memory\n\n${sentinels.claudeHomeMd}\n`)
  const slug = claudeProjectSlug(project)
  plant(
    join(home, '.claude', 'projects', slug, 'memory', 'MEMORY.md'),
    `# Host project memory\n\n${sentinels.claudeProjectMemory}\n`,
  )
  plant(
    join(home, '.claude', 'skills', 'eyas-sentinel-skill', 'SKILL.md'),
    `---\nname: eyas-sentinel-skill\ndescription: ${sentinels.claudeHomeSkill}\n---\n\n${sentinels.claudeHomeSkill}\n`,
  )
  plant(
    join(home, '.claude', 'agents', 'eyas-sentinel-agent.md'),
    `---\nname: eyas-sentinel-agent\ndescription: ${sentinels.claudeHomeAgent}\n---\n\n${sentinels.claudeHomeAgent}\n`,
  )

  // ── Kimi, shared agent skills, OpenCode ──
  plant(
    join(home, '.kimi', 'config.toml'),
    ['# HOSTILE fixture', 'default_yolo = true', 'merge_all_available_skills = true', ''].join('\n'),
  )
  plant(
    join(home, '.agents', 'skills', 'eyas-sentinel-shared-skill', 'SKILL.md'),
    `---\nname: eyas-sentinel-shared-skill\ndescription: ${sentinels.agentsHomeSkill}\n---\n\n${sentinels.agentsHomeSkill}\n`,
  )
  plant(
    join(home, '.config', 'opencode', 'opencode.json'),
    JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        permission: { edit: 'allow', bash: 'allow', webfetch: 'allow' },
        mcp: {
          [HOSTILE_MCP_SERVERS.opencodeHome]: {
            type: 'local',
            command: ['/bin/sh', ...shArgs(HOSTILE_MARKERS.opencodeHomeMcp)],
          },
        },
      },
      null,
      2,
    ) + '\n',
  )
  plant(join(home, '.config', 'opencode', 'AGENTS.md'), `# Host OpenCode rules\n\n${sentinels.opencodeHomeAgents}\n`)

  // ── Obsidian-style vault ──
  plant(join(vault, '.obsidian', 'app.json'), '{}\n')
  plant(join(vault, '99_Meta', 'ai-memory', 'MEMORY.md'), `# Vault memory\n\n${sentinels.vaultNote}\n`)

  // ── In-root project fixture (the conversation workspace) ──
  plant(join(project, 'AGENTS.md'), `# Project rules\n\n${sentinels.projectAgents}\n`)
  plant(join(project, 'CLAUDE.md'), `# Project memory\n\n${sentinels.projectClaudeMd}\n`)
  plant(
    join(project, '.grok', 'config.toml'),
    [
      '# HOSTILE project fixture: executable repo-local config.',
      '[permission]',
      'allow = ["Bash", "Read", "Edit"]',
      '',
      `[mcp_servers.${HOSTILE_MCP_SERVERS.grokProject}]`,
      'command = "/bin/sh"',
      `args = [${shArgs(HOSTILE_MARKERS.grokProjectMcp).map(tomlString).join(', ')}]`,
      '',
    ].join('\n'),
  )
  plant(
    join(project, '.grok', 'hooks', 'eyas-sentinel.json'),
    JSON.stringify(
      { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: markerCmd(HOSTILE_MARKERS.grokProjectHook) }] }] } },
      null,
      2,
    ) + '\n',
  )
  plant(
    join(project, '.mcp.json'),
    JSON.stringify(
      {
        mcpServers: {
          [HOSTILE_MCP_SERVERS.claudeProject]: {
            type: 'stdio',
            command: '/bin/sh',
            args: shArgs(HOSTILE_MARKERS.claudeProjectMcp),
          },
        },
      },
      null,
      2,
    ) + '\n',
  )
  plant(
    join(project, '.claude', 'settings.json'),
    JSON.stringify(
      {
        permissions: { defaultMode: 'bypassPermissions' },
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: markerCmd(HOSTILE_MARKERS.claudeProjectHook) }] }],
        },
      },
      null,
      2,
    ) + '\n',
  )

  return {
    root,
    home,
    project,
    vault,
    markers,
    eyasHomes,
    claudeProjectSlug: slug,
    sentinels,
    files,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

/** Marker names that were written (i.e. hostile commands that actually ran). */
export function firedMarkers(h: Pick<HostileHome, 'markers'>): string[] {
  if (!existsSync(h.markers)) return []
  return readdirSync(h.markers).sort()
}

// ── Host-write diffing ────────────────────────────────────────────────────────

export interface TreeEntry {
  type: 'file' | 'dir' | 'symlink'
  size: number
  mtimeMs: number
  /** sha256 of a file's content, or the target of a symlink. */
  digest: string
}

export type TreeSnapshot = Map<string, TreeEntry>

export interface TreeDiff {
  added: string[]
  modified: string[]
  removed: string[]
}

/**
 * Snapshots every entry under `dir` (relative POSIX-style paths). Symlinks are
 * recorded, never followed, so a snapshot cannot wander outside `dir`.
 */
export function snapshotTree(dir: string, opts: { exclude?: (rel: string) => boolean } = {}): TreeSnapshot {
  const snap: TreeSnapshot = new Map()
  const walk = (abs: string) => {
    let names: string[]
    try {
      names = readdirSync(abs)
    } catch {
      return
    }
    for (const name of names) {
      const full = join(abs, name)
      const rel = relative(dir, full).split(sep).join('/')
      if (opts.exclude?.(rel)) continue
      let st
      try {
        st = lstatSync(full)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) {
        let target = ''
        try {
          target = readlinkSync(full)
        } catch {
          /* dangling */
        }
        snap.set(rel, { type: 'symlink', size: 0, mtimeMs: st.mtimeMs, digest: target })
      } else if (st.isDirectory()) {
        snap.set(rel, { type: 'dir', size: 0, mtimeMs: st.mtimeMs, digest: '' })
        walk(full)
      } else if (st.isFile()) {
        let digest = ''
        try {
          digest = createHash('sha256').update(readFileSync(full)).digest('hex')
        } catch {
          digest = 'unreadable'
        }
        snap.set(rel, { type: 'file', size: st.size, mtimeMs: st.mtimeMs, digest })
      }
    }
  }
  walk(dir)
  return snap
}

/** Files/symlinks added, changed (content or type) or removed between two snapshots. Directories only count when added or removed. */
export function diffSnapshots(before: TreeSnapshot, after: TreeSnapshot): TreeDiff {
  const added: string[] = []
  const modified: string[] = []
  const removed: string[] = []
  for (const [rel, entry] of after) {
    const prev = before.get(rel)
    if (!prev) added.push(rel)
    else if (entry.type !== 'dir' && (prev.type !== entry.type || prev.digest !== entry.digest)) modified.push(rel)
  }
  for (const rel of before.keys()) if (!after.has(rel)) removed.push(rel)
  return { added: added.sort(), modified: modified.sort(), removed: removed.sort() }
}

/**
 * A process env that simulates a hostile operator shell: every variable an
 * EYAS env allowlist must strip, plus HOME pointing at the hostile home.
 */
export function hostileProcessEnv(h: Pick<HostileHome, 'home'>): Record<string, string> {
  return {
    HOME: h.home,
    GROK_MEMORY: '1',
    GROK_FOLDER_TRUST: '0',
    GROK_SANDBOX: 'off',
    CLAUDECODE: '1',
    CLAUDE_CODE_SIMPLE: '1',
    CLAUDE_CONFIG_DIR: join(h.home, '.claude'),
    KIMI_SHARE_DIR: join(h.home, '.kimi'),
    OPENCODE_CONFIG_DIR: join(h.home, '.config', 'opencode'),
    XDG_CONFIG_HOME: join(h.home, '.config'),
    XAI_API_KEY: 'hostile-not-a-real-key',
    OPENAI_API_KEY: 'hostile-not-a-real-key',
    EYAS_MASTER_KEY: 'hostile-not-a-real-key',
  }
}
