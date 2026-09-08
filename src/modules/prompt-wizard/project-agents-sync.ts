// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { projectAgentsPath, projectTypeAgentsPath } from './workspace-paths.js'

function writeOrRemove(path: string, prompt: string | null | undefined): void {
  const text = prompt ?? ''
  if (!text.trim()) {
    if (existsSync(path)) unlinkSync(path)
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, 'utf8')
}

export function writeProjectAgentsFile(dataDir: string, projectId: string, prompt: string | null | undefined): void {
  try {
    writeOrRemove(projectAgentsPath(projectId, dataDir), prompt)
  } catch {
    // Invalid id — the loader still has the DB prompt.
  }
}

export function writeProjectTypeAgentsFile(dataDir: string, typeId: string, prompt: string | null | undefined): void {
  try {
    writeOrRemove(projectTypeAgentsPath(typeId, dataDir), prompt)
  } catch {
    // Invalid id — the loader still has the DB prompt.
  }
}

export function syncMissingProjectAgentsFiles(
  dataDir: string,
  types: Array<{ id: string; prompt?: string | null }>,
  projects: Array<{ id: string; prompt?: string | null }>,
): void {
  for (const t of types) {
    if (!t.prompt?.trim()) continue
    try {
      const path = projectTypeAgentsPath(t.id, dataDir)
      if (!existsSync(path)) writeProjectTypeAgentsFile(dataDir, t.id, t.prompt)
    } catch { /* invalid id */ }
  }
  for (const p of projects) {
    if (!p.prompt?.trim()) continue
    try {
      const path = projectAgentsPath(p.id, dataDir)
      if (!existsSync(path)) writeProjectAgentsFile(dataDir, p.id, p.prompt)
    } catch { /* invalid id */ }
  }
}
