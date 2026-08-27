// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/conversations/workspace-outputs.ts
//
// Making what an agent wrote visible.
//
// A CLI provider writes files with its own file tool. EYAS never sees the
// write: no `write_file` call, no audit entry, nothing in the documents table
// — so the attachments panel, which lists documents, shows nothing, and the
// only record that a file exists at all is a sentence in the model's answer.
// Worse, a conversation with no working directory leaves the agent to pick
// somewhere: observed output landed in /tmp and on the Desktop.
//
// Neither half can be fixed by intercepting the write, because the write never
// comes through EYAS. So instead: give every conversation a directory, and
// after a turn, look in it for what appeared.
//
// Deliberately conservative. A working directory can be a whole repository,
// and a build that touched four thousand files must not become four thousand
// attachments — so this looks only at the top two levels, ignores everything
// that is obviously not a deliverable, and stops at a small cap.

import { mkdirSync } from 'node:fs'
import { readdir, stat, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

/**
 * Where a conversation works when its project names no directory.
 *
 * Without this the agent picks: observed output went to /tmp and to the
 * Desktop, in the same session. A directory of its own also gives the output
 * collector somewhere definite to look.
 */
export function ensureConversationWorkspace(dataDir: string, conversationId: string): string {
  const dir = join(dataDir, 'workspaces', conversationId)
  mkdirSync(dir, { recursive: true })
  return dir
}

export interface WorkspaceOutput {
  path: string
  relativePath: string
  bytes: number
  modifiedMs: number
}

export const MAX_OUTPUTS = 8
/**
 * How far before the stamp an mtime may still count as this turn's work.
 *
 * Two clocks are being compared: `Date.now()` and whatever the filesystem
 * recorded. They disagree — some filesystems keep mtime only to the second,
 * and rounding goes down as often as up, so a file written a moment after the
 * stamp can carry an mtime a moment before it. A strict comparison dropped
 * exactly that file, and the symptom was a test that passed alone and failed
 * in a warm suite.
 *
 * Two seconds is far wider than any rounding and far narrower than the age of
 * anything that was already sitting in the workspace.
 */
export const MTIME_TOLERANCE_MS = 2000
export const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const MAX_DEPTH = 2

/** Directories that are never a deliverable. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', 'dist', 'build', 'out', 'target',
  '.next', '.cache', 'coverage', '__pycache__', '.venv', 'venv', 'vendor',
])

/**
 * Extensions worth surfacing. An allow-list rather than a deny-list: the point
 * is "something a person would want to open", and guessing that from what a
 * build left behind is how four thousand attachments happen.
 */
const KEEP_EXT = new Set([
  '.html', '.htm', '.md', '.txt', '.csv', '.json', '.svg',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.ics', '.eml',
])

function keepable(name: string): boolean {
  if (name.startsWith('.')) return false
  const dot = name.lastIndexOf('.')
  return dot > 0 && KEEP_EXT.has(name.slice(dot).toLowerCase())
}

/**
 * Files under `root` created or changed since `sinceMs`, newest first.
 * Never throws: an unreadable directory yields nothing.
 */
export async function collectWorkspaceOutputs(
  root: string,
  sinceMs: number,
  limit = MAX_OUTPUTS,
): Promise<WorkspaceOutput[]> {
  const found: WorkspaceOutput[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return
    let entries: Awaited<ReturnType<typeof readdir>>
    try {
      entries = await readdir(dir, { withFileTypes: true } as any) as any
    } catch {
      return
    }
    for (const entry of entries as any[]) {
      const name = String(entry.name)
      const full = join(dir, name)
      if (entry.isDirectory?.()) {
        if (!SKIP_DIRS.has(name) && !name.startsWith('.')) await walk(full, depth + 1)
        continue
      }
      if (!keepable(name)) continue
      try {
        const info = await stat(full)
        if (info.mtimeMs < sinceMs - MTIME_TOLERANCE_MS) continue
        if (info.size > MAX_OUTPUT_BYTES || info.size === 0) continue
        found.push({ path: full, relativePath: relative(root, full), bytes: info.size, modifiedMs: info.mtimeMs })
      } catch {
        // Vanished between readdir and stat; nothing to report.
      }
    }
  }

  await walk(root, 0)
  return found.sort((a, b) => b.modifiedMs - a.modifiedMs).slice(0, limit)
}

export interface AttachDeps {
  documents: {
    upload(input: { file: Buffer; filename: string; metadata?: Record<string, unknown>; createdBy?: string }): Promise<{ id: string }>
    link(documentId: string, ownerModule: string, ownerId: string, source?: string): unknown
  }
  logger?: { warn: (o: unknown, m?: string) => void; info: (o: unknown, m?: string) => void }
}

/**
 * Register what a turn produced as documents on the conversation, so the
 * attachments panel can show it. Returns the document ids.
 *
 * A copy, not a reference: the panel then holds what was produced even if the
 * workspace moves on, which is what an artefact should be.
 */
export async function attachWorkspaceOutputs(
  deps: AttachDeps,
  conversationId: string,
  outputs: readonly WorkspaceOutput[],
  createdBy?: string,
): Promise<string[]> {
  const ids: string[] = []
  for (const output of outputs) {
    try {
      const doc = await deps.documents.upload({
        file: await readFile(output.path),
        filename: output.relativePath.split('/').pop() || 'output',
        metadata: { source: 'agent-output', workspacePath: output.path, conversationId },
        ...(createdBy ? { createdBy } : {}),
      })
      deps.documents.link(doc.id, 'conversations', conversationId, 'agent')
      ids.push(doc.id)
    } catch (err) {
      // One unreadable file must not cost the others their place in the panel.
      deps.logger?.warn({ err: String(err), path: output.path }, 'Could not attach an agent output')
    }
  }
  if (ids.length) deps.logger?.info({ conversationId, count: ids.length }, 'Agent outputs attached to the conversation')
  return ids
}
