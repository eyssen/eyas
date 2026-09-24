// Part of eYssen. See LICENSE file for full copyright and licensing details.
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import { projectTypes, projects } from '../../src/modules/board/schema.js'

export interface CascadeMigrationResult {
  projectTypesMigrated: number
  projectsMigrated: number
}

/**
 * Migrate legacy `project_types.prompt` and `projects.prompt` content into
 * the v2 cascade file layout: `data/project-types/<id>/AGENTS.md` and
 * `data/projects/<id>/AGENTS.md`.
 *
 * Non-destructive: the legacy `prompt` columns stay in place. Dropping them
 * is a separate (and riskier) operation handled by a later schema migration
 * once all runtime callers are off the legacy path.
 *
 * Skips rows whose prompt is empty or null.
 */
export async function migrateCascadeFiles(
  db: BunSQLiteDatabase,
  dataDir: string,
): Promise<CascadeMigrationResult> {
  let projectTypesMigrated = 0
  let projectsMigrated = 0

  const ptypes = await db.select().from(projectTypes)
  for (const pt of ptypes) {
    if (!pt.prompt || !pt.prompt.trim()) continue
    const dir = join(dataDir, 'project-types', pt.id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'AGENTS.md'), pt.prompt, 'utf8')
    projectTypesMigrated++
  }

  const projs = await db.select().from(projects)
  for (const p of projs) {
    if (!p.prompt || !p.prompt.trim()) continue
    const dir = join(dataDir, 'projects', p.id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'AGENTS.md'), p.prompt, 'utf8')
    projectsMigrated++
  }

  return { projectTypesMigrated, projectsMigrated }
}
