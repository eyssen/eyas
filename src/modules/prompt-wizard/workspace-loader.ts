// src/modules/prompt-wizard/workspace-loader.ts
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentWorkspace, WorkspaceFile, WorkspaceFileName } from './workspace-types.js'
import { resolveWorkspaceRoot, resolveWorkspaceFile } from './workspace-paths.js'
import { parseFrontmatter, stripFrontmatter } from './frontmatter.js'

export interface WorkspaceLoaderOptions {
  dataDir: string
  maxBytesPerFile?: number
}

export interface WorkspaceLoader {
  load(agentId: string): Promise<AgentWorkspace>
  invalidate(agentId: string): void
  invalidateAll(): void
}

const TRUNCATION_MARKER = '\n\n[truncated — file exceeds workspace per-file budget]'
const FILE_NAMES: WorkspaceFileName[] = [
  'IDENTITY.md',
  'SOUL.md',
  'SOUL.style.json',
  'AGENTS.md',
  'TOOLS.md',
  'MEMORY.md',
]

export function createWorkspaceLoader(opts: WorkspaceLoaderOptions): WorkspaceLoader {
  const cache = new Map<string, AgentWorkspace>()
  const maxBytes = opts.maxBytesPerFile ?? 12_000

  async function readEntry(absPath: string, fileName: string): Promise<WorkspaceFile> {
    if (!existsSync(absPath)) {
      return {
        name: fileName,
        path: absPath,
        exists: false,
        frontmatter: null,
        body: '',
        byteSize: 0,
        truncated: false,
      }
    }
    const buf = await readFile(absPath)
    const truncated = buf.byteLength > maxBytes
    const text = truncated
      ? buf.subarray(0, maxBytes).toString('utf8') + TRUNCATION_MARKER
      : buf.toString('utf8')
    return {
      name: fileName,
      path: absPath,
      exists: true,
      frontmatter: parseFrontmatter(text),
      body: stripFrontmatter(text),
      byteSize: buf.byteLength,
      truncated,
    }
  }

  async function load(agentId: string): Promise<AgentWorkspace> {
    const cached = cache.get(agentId)
    if (cached) return cached
    const root = resolveWorkspaceRoot(agentId, opts.dataDir)
    const [identity, soulMd, soulStyleJson, agentsMd, toolsMd, memoryMd] = await Promise.all(
      FILE_NAMES.map((n) => readEntry(resolveWorkspaceFile(agentId, n, opts.dataDir), n)),
    )
    const memoryDir = join(root, 'memory')
    let dailyMemory: WorkspaceFile[] = []
    if (existsSync(memoryDir)) {
      const entries = (await readdir(memoryDir))
        .filter((e) => /^\d{4}-\d{2}-\d{2}\.md$/.test(e))
        .sort()
      dailyMemory = await Promise.all(
        entries.map((e) => readEntry(join(memoryDir, e), `memory/${e}`)),
      )
    }
    const ws: AgentWorkspace = {
      agentId,
      rootPath: root,
      identity,
      soulMd,
      soulStyleJson,
      agentsMd,
      toolsMd,
      memoryMd,
      dailyMemory,
    }
    cache.set(agentId, ws)
    return ws
  }

  return {
    load,
    invalidate: (id) => {
      cache.delete(id)
    },
    invalidateAll: () => {
      cache.clear()
    },
  }
}
