// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { Skill, SkillType } from './types.js'
import { wins } from './skill-inventory.js'

/**
 * Result of a directory scan. `complete` is load-bearing: orphan detection
 * (skills whose source file has disappeared) must never run on an incomplete
 * scan, or a single transient read error would make every unreached file
 * look orphaned. Only a missing root directory (ENOENT) counts as a normal,
 * fully-known empty scan (`complete: true`, zero counts). Any other failure —
 * listing the directory, or reading/parsing one file — sets `complete: false`
 * and, for a per-file failure, is recorded without aborting the rest of the scan.
 */
export interface ScanResult {
  inserted: number
  updated: number
  shadowed: number
  complete: boolean
  error?: string
}

function toSkill(raw: any): Skill {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? '',
    category: raw.category ?? undefined,
    triggerPatterns: raw.trigger_patterns ? JSON.parse(raw.trigger_patterns) : [],
    capabilities: raw.capabilities ? JSON.parse(raw.capabilities) : [],
    version: raw.version ?? '1.0.0',
    content: raw.content,
    skillType: (raw.skill_type as SkillType) ?? 'knowledge',
    toolConfig: raw.tool_config ? JSON.parse(raw.tool_config) : undefined,
    integrationConfig: raw.integration_config ? JSON.parse(raw.integration_config) : undefined,
    sources: raw.sources ? JSON.parse(raw.sources) : undefined,
    source: raw.source,
    enabled: raw.enabled === 1,
    disabledReason: raw.disabled_reason ?? undefined,
    disabledAt: raw.disabled_at ?? undefined,
    disabledBy: raw.disabled_by ?? undefined,
    useCount: raw.use_count ?? 0,
    lastUsedAt: raw.last_used_at ?? undefined,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

export function createSkillLoader(db: any, logger: any) {
  return {
    async loadFromDirectory(dir: string, rootId = 'config/skills'): Promise<ScanResult> {
      const { readdir, readFile } = await import('fs/promises')
      const { parse: parseYaml } = await import('yaml')
      let inserted = 0
      let updated = 0
      let shadowed = 0
      let complete = true
      let scanError: string | undefined

      // Listing the directory is its own failure domain: a missing directory is a
      // normal, fully-known empty scan; any other listing failure means we never
      // even got a file list, so the scan cannot be trusted as complete.
      let files: string[]
      try {
        files = (await readdir(dir, { recursive: true })).map((f) => (typeof f === 'string' ? f : String(f)))
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          logger.debug(`No skills directory at ${dir}`)
          return { inserted: 0, updated: 0, shadowed: 0, complete: true }
        }
        logger.error({ err, dir }, 'Skill scan failed to list directory')
        return { inserted: 0, updated: 0, shadowed: 0, complete: false, error: String(err?.message ?? err) }
      }

      for (const filePath of files) {
        if (!filePath.endsWith('.md')) continue
        // A per-file failure (unreadable file, malformed YAML, ...) must not abort
        // the loop — one bad file shouldn't hide every file after it from the scan.
        try {
          const content = await readFile(`${dir}/${filePath}`, 'utf-8')
          const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
          if (!match) continue
          const frontmatter = parseYaml(match[1])
          const body = match[2].trim()
          // Use category/name as id for nested skills (e.g. coding/typescript)
          const relativePath = filePath.replace(/\\/g, '/').replace('.md', '')
          const id = frontmatter.id ?? frontmatter.name ?? relativePath
          // Derive category from directory path (e.g. 'coding/languages/typescript' → 'coding/languages')
          const pathParts = relativePath.split('/')
          const category = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : undefined
          const skillType = frontmatter.skill_type ?? frontmatter.type ?? 'knowledge'
          const toolConfig = frontmatter.tool_config ? JSON.stringify(frontmatter.tool_config) : null
          const integrationConfig = frontmatter.integration_config ? JSON.stringify(frontmatter.integration_config) : null
          const sources = frontmatter.sources ? JSON.stringify(frontmatter.sources) : null
          const sourcePath = `${relativePath}.md`

          // Upsert — bundled files compete for an id via wins() (skill-inventory.ts).
          // A user/generated incumbent always outranks a bundled candidate by rank
          // alone, so it still wins and its row is never touched — but the shadowed
          // bundled file is now recorded too, so the inventory can answer "why do
          // my edits to this .md file have no effect?". Between two bundled files
          // mapping to the same id, the loser's path is recorded in
          // skill_shadowed_sources instead of being silently overwritten by
          // readdir order.
          const existing = db.all(sql`SELECT id, source, source_path, source_root FROM skills WHERE id = ${id}`) as any[]
          const now = new Date().toISOString()
          if (existing.length === 0) {
            db.run(sql`INSERT INTO skills (id, name, description, category, trigger_patterns, capabilities, version, content, skill_type, tool_config, integration_config, sources, source, source_path, source_root, last_seen_at, enabled, created_at, updated_at)
              VALUES (${id}, ${frontmatter.name ?? id}, ${frontmatter.description ?? ''}, ${category ?? null},
                      ${JSON.stringify(frontmatter.trigger_patterns ?? [])},
                      ${JSON.stringify(frontmatter.capabilities ?? [])},
                      ${frontmatter.version ?? '1.0.0'}, ${body}, ${skillType}, ${toolConfig}, ${integrationConfig}, ${sources},
                      'bundled', ${sourcePath}, ${rootId}, ${now}, 1, ${now}, ${now})`)
            inserted++
          } else if (existing[0].source === 'bundled') {
            const incumbent = existing[0]
            const sameFile = incumbent.source_root === rootId && incumbent.source_path === sourcePath
            if (sameFile) {
              // Re-scanning the same source file — refresh it in place, not a collision.
              db.run(sql`UPDATE skills SET name = ${frontmatter.name ?? id}, description = ${frontmatter.description ?? ''},
                        category = ${category ?? null},
                        trigger_patterns = ${JSON.stringify(frontmatter.trigger_patterns ?? [])},
                        capabilities = ${JSON.stringify(frontmatter.capabilities ?? [])},
                        version = ${frontmatter.version ?? '1.0.0'}, content = ${body},
                        skill_type = ${skillType}, tool_config = ${toolConfig}, integration_config = ${integrationConfig},
                        sources = ${sources},
                        source_path = ${sourcePath}, source_root = ${rootId}, last_seen_at = ${now},
                        updated_at = ${now} WHERE id = ${id}`)
              updated++
            } else {
              // Genuine collision: two different bundled files claim the same id.
              const candidateOrigin = { source: 'bundled', root: rootId, path: sourcePath }
              const incumbentOrigin = { source: 'bundled', root: incumbent.source_root ?? '', path: incumbent.source_path ?? '' }
              if (wins(candidateOrigin, incumbentOrigin)) {
                db.run(sql`UPDATE skills SET name = ${frontmatter.name ?? id}, description = ${frontmatter.description ?? ''},
                          category = ${category ?? null},
                          trigger_patterns = ${JSON.stringify(frontmatter.trigger_patterns ?? [])},
                          capabilities = ${JSON.stringify(frontmatter.capabilities ?? [])},
                          version = ${frontmatter.version ?? '1.0.0'}, content = ${body},
                          skill_type = ${skillType}, tool_config = ${toolConfig}, integration_config = ${integrationConfig},
                          sources = ${sources},
                          source_path = ${sourcePath}, source_root = ${rootId}, last_seen_at = ${now},
                          updated_at = ${now} WHERE id = ${id}`)
                updated++
                if (incumbent.source_path && incumbent.source_root) {
                  db.run(sql`INSERT OR IGNORE INTO skill_shadowed_sources (skill_id, path, root, seen_at)
                    VALUES (${id}, ${incumbent.source_path}, ${incumbent.source_root}, ${now})`)
                }
              } else {
                db.run(sql`INSERT OR IGNORE INTO skill_shadowed_sources (skill_id, path, root, seen_at)
                  VALUES (${id}, ${sourcePath}, ${rootId}, ${now})`)
              }
              shadowed++
            }
          } else {
            // Existing row is 'user' or 'generated' — it always outranks a bundled
            // candidate, so it keeps winning and is left untouched. Record the
            // shadowed bundled file so the inventory can surface the override.
            db.run(sql`INSERT OR IGNORE INTO skill_shadowed_sources (skill_id, path, root, seen_at)
              VALUES (${id}, ${sourcePath}, ${rootId}, ${now})`)
            shadowed++
          }
        } catch (err: any) {
          logger.error({ err, dir, file: filePath }, 'Skill scan failed to read or parse file')
          complete = false
          scanError = String(err?.message ?? err)
        }
      }

      return { inserted, updated, shadowed, complete, ...(scanError ? { error: scanError } : {}) }
    },

    get(id: string): Skill | null {
      const rows = db.all(sql`SELECT * FROM skills WHERE id = ${id}`) as any[]
      return rows.length > 0 ? toSkill(rows[0]) : null
    },

    list(enabled?: boolean): Skill[] {
      let rows: any[]
      if (enabled !== undefined) {
        rows = db.all(sql`SELECT * FROM skills WHERE enabled = ${enabled ? 1 : 0} ORDER BY name`) as any[]
      } else {
        rows = db.all(sql`SELECT * FROM skills ORDER BY name`) as any[]
      }
      return rows.map(toSkill)
    },

    create(input: {
      name: string
      description?: string
      category?: string
      triggerPatterns?: string[]
      capabilities?: string[]
      content: string
      skillType?: SkillType
      toolConfig?: Record<string, unknown>
      integrationConfig?: Record<string, unknown>
    }): Skill {
      const id = generateId()
      const now = new Date().toISOString()
      const skillType = input.skillType ?? 'knowledge'
      // User-created, imported, and AI-proposed skills default to the "own" category.
      const category = input.category?.trim() || 'own'
      db.run(sql`INSERT INTO skills (id, name, description, category, trigger_patterns, capabilities, content, skill_type, tool_config, integration_config, source, enabled, created_at, updated_at)
        VALUES (${id}, ${input.name}, ${input.description ?? ''}, ${category},
                ${JSON.stringify(input.triggerPatterns ?? [])},
                ${JSON.stringify(input.capabilities ?? [])}, ${input.content}, ${skillType},
                ${input.toolConfig ? JSON.stringify(input.toolConfig) : null},
                ${input.integrationConfig ? JSON.stringify(input.integrationConfig) : null},
                'user', 1, ${now}, ${now})`)
      return this.get(id)!
    },

    /**
     * Patch a skill's description and/or content in place. Used by the forge
     * apply path to persist adopted skill-description proposals. Only the
     * provided fields change; updated_at is bumped. Returns null if absent.
     */
    update(id: string, patch: { description?: string; content?: string }): Skill | null {
      const rows = db.all(sql`SELECT description, content FROM skills WHERE id = ${id}`) as any[]
      if (rows.length === 0) return null
      const now = new Date().toISOString()
      const description = patch.description ?? rows[0].description
      const content = patch.content ?? rows[0].content
      db.run(sql`UPDATE skills SET description = ${description}, content = ${content}, updated_at = ${now} WHERE id = ${id}`)
      return this.get(id)
    },

    /**
     * Idempotent enable/disable, with an optional reason and actor recorded on
     * disable. Re-enabling clears the disable metadata so a stale reason (e.g.
     * "disabled because orphan") never lingers on a live skill. `toggle()` is a
     * thin wrapper over this — it remains the API for the existing UI switch
     * and POST /skills/:id/toggle.
     */
    setEnabled(id: string, enabled: boolean, reason?: string, by?: string): void {
      const now = new Date().toISOString()
      if (enabled) {
        db.run(sql`UPDATE skills SET enabled = 1, disabled_reason = NULL, disabled_at = NULL,
          disabled_by = NULL, updated_at = ${now} WHERE id = ${id}`)
        return
      }
      db.run(sql`UPDATE skills SET enabled = 0, disabled_reason = ${reason ?? 'user'},
        disabled_at = ${now}, disabled_by = ${by ?? 'user'}, updated_at = ${now} WHERE id = ${id}`)
    },

    toggle(id: string): void {
      const skill = this.get(id)
      if (!skill) return
      this.setEnabled(id, !skill.enabled, skill.enabled ? 'user' : undefined, 'user')
    },

    delete(id: string): void {
      db.run(sql`DELETE FROM skills WHERE id = ${id} AND source = 'user'`)
    },
  }
}
