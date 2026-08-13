// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { Skill, SkillType } from './types.js'

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
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

export function createSkillLoader(db: any, logger: any) {
  return {
    async loadFromDirectory(dir: string): Promise<number> {
      const { readdir, readFile } = await import('fs/promises')
      const { parse: parseYaml } = await import('yaml')
      let count = 0
      try {
        const files = await readdir(dir, { recursive: true })
        for (const file of files) {
          // readdir with { recursive: true } always yields strings; defensive
          // String(file) handles any hypothetical Buffer return without the
          // narrowed-to-never .toString() call.
          const filePath = typeof file === 'string' ? file : String(file)
          if (!filePath.endsWith('.md')) continue
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

          // Upsert — always update bundled skills to keep them in sync with files
          const existing = db.all(sql`SELECT id, source FROM skills WHERE id = ${id}`) as any[]
          const now = new Date().toISOString()
          if (existing.length === 0) {
            db.run(sql`INSERT INTO skills (id, name, description, category, trigger_patterns, capabilities, version, content, skill_type, tool_config, integration_config, sources, source, enabled, created_at, updated_at)
              VALUES (${id}, ${frontmatter.name ?? id}, ${frontmatter.description ?? ''}, ${category ?? null},
                      ${JSON.stringify(frontmatter.trigger_patterns ?? [])},
                      ${JSON.stringify(frontmatter.capabilities ?? [])},
                      ${frontmatter.version ?? '1.0.0'}, ${body}, ${skillType}, ${toolConfig}, ${integrationConfig}, ${sources},
                      'bundled', 1, ${now}, ${now})`)
            count++
          } else if (existing[0].source === 'bundled') {
            // Update bundled skills — keep content in sync with source files
            db.run(sql`UPDATE skills SET name = ${frontmatter.name ?? id}, description = ${frontmatter.description ?? ''},
                      category = ${category ?? null},
                      trigger_patterns = ${JSON.stringify(frontmatter.trigger_patterns ?? [])},
                      capabilities = ${JSON.stringify(frontmatter.capabilities ?? [])},
                      version = ${frontmatter.version ?? '1.0.0'}, content = ${body},
                      skill_type = ${skillType}, tool_config = ${toolConfig}, integration_config = ${integrationConfig},
                      sources = ${sources},
                      updated_at = ${now} WHERE id = ${id}`)
            count++
          }
        }
      } catch {
        logger.debug(`No skills directory at ${dir}`)
      }
      return count
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

    toggle(id: string): void {
      const skill = this.get(id)
      if (!skill) return
      const now = new Date().toISOString()
      db.run(sql`UPDATE skills SET enabled = ${skill.enabled ? 0 : 1}, updated_at = ${now} WHERE id = ${id}`)
    },

    delete(id: string): void {
      db.run(sql`DELETE FROM skills WHERE id = ${id} AND source = 'user'`)
    },
  }
}
