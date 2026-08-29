// src/modules/prompt-wizard/workspace-writer.ts
import { writeFile, mkdir, readFile, readdir, unlink, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { resolveWorkspaceFile, historyPath, resolveWorkspaceRoot } from './workspace-paths.js'
import { injectFrontmatter } from './frontmatter.js'

export interface WriteRequest {
  agentId: string
  file: string
  body: string
  skipHistory?: boolean
  skipFrontmatter?: boolean
}

export interface WorkspaceWriterOptions {
  dataDir: string
  now?: () => Date
  historyCap?: number
}

export interface WorkspaceWriter {
  write(req: WriteRequest): Promise<void>
  delete(agentId: string, file: string): Promise<void>
}

function targetPath(agentId: string, file: string, dataDir: string): string {
  return file.includes('/')
    ? join(resolveWorkspaceRoot(agentId, dataDir), file)
    : resolveWorkspaceFile(agentId, file, dataDir)
}

export function createWorkspaceWriter(opts: WorkspaceWriterOptions): WorkspaceWriter {
  const now = opts.now ?? (() => new Date())
  const cap = opts.historyCap ?? 30

  async function snapshot(agentId: string, file: string): Promise<void> {
    const target = targetPath(agentId, file, opts.dataDir)
    if (!existsSync(target)) return
    const ts = now().toISOString()
    const snap = historyPath(agentId, basename(file), ts, opts.dataDir)
    await mkdir(dirname(snap), { recursive: true })
    await writeFile(snap, await readFile(target))
    const histDir = dirname(snap)
    const entries = (await readdir(histDir))
      .filter((e) => e.startsWith(`${basename(file)}.`))
      .sort()
    while (entries.length > cap) {
      await unlink(join(histDir, entries.shift()!))
    }
  }

  async function write(req: WriteRequest): Promise<void> {
    const target = targetPath(req.agentId, req.file, opts.dataDir)
    await mkdir(dirname(target), { recursive: true })
    if (!req.skipHistory) await snapshot(req.agentId, req.file)
    const isJson = req.file.endsWith('.json') || req.skipFrontmatter
    const content = isJson
      ? req.body
      : injectFrontmatter(req.body, {
          schema: 'eyas.workspace.v1',
          agentId: req.agentId,
          generatedAt: now().toISOString(),
        })
    const tmp = `${target}.tmp`
    await writeFile(tmp, content)
    await rename(tmp, target)
  }

  async function deleteFile(agentId: string, file: string): Promise<void> {
    const target = targetPath(agentId, file, opts.dataDir)
    if (existsSync(target)) await unlink(target)
  }

  return { write, delete: deleteFile }
}
