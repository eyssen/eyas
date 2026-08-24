// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { EyasDb } from '@core/types'
import { createSkillLoader } from '@modules/skills/skill-loader.js'
import { parseFrontmatter } from './skill-generator.js'
import type { GeneratedSkill, SkillRegistryPort } from './types.js'

/**
 * Real skills-registry adapter (Task 2). Writes an ADOPTED GeneratedSkill
 * into the real `skills` table (src/modules/skills/schema) so the running
 * skill-matcher/loader picks it up immediately — list()/get() query the DB
 * live, there's no cache to refresh.
 *
 * The `skills` table has no unique column besides `id` (TEXT PRIMARY KEY),
 * so the generated skill's stable `slug` doubles as the skills-table id —
 * the same trick skill-loader's loadFromDirectory() uses to key bundled
 * skills off frontmatter id/name. That makes isRegistered(slug) a plain id
 * lookup via the real loader's get().
 *
 * loader.create() always mints a fresh generateId() and has no parameter
 * for a caller-supplied id, so register() inserts directly instead of
 * extending the loader for this one caller.
 *
 * SAFETY: only ever construct this alongside a real approvalQueue — see the
 * header comment on adopter.ts and index.ts's onStart. Never wire it as the
 * ungated default (that stays createStubRegistry()).
 */
export function createRealSkillRegistry(deps: { db: EyasDb; logger: Logger }): SkillRegistryPort {
  const { db, logger } = deps
  const loader = createSkillLoader(db, logger)

  return {
    async register(skill: GeneratedSkill): Promise<void> {
      if (loader.get(skill.slug)) {
        logger.warn(
          { slug: skill.slug },
          'skill-generation: registry.register called for an already-registered slug, skipping',
        )
        return
      }

      // The frontmatter carries the model/deterministically-authored name and
      // description; fall back to the slug/empty string if it fails to parse
      // so a malformed SKILL.md never blocks an owner-approved adoption.
      let name = skill.slug
      let description = ''
      try {
        const fm = parseFrontmatter(skill.skillMdContent) as { name?: unknown; description?: unknown }
        if (typeof fm.name === 'string' && fm.name) name = fm.name
        if (typeof fm.description === 'string') description = fm.description
      } catch (err) {
        logger.warn(
          { err, slug: skill.slug },
          'skill-generation: failed to parse SKILL.md frontmatter, registering with slug as name',
        )
      }

      const now = new Date().toISOString()
      // Adopted / AI-proposed skills land in the user-owned "own" category.
      db.run(sql`INSERT INTO skills (id, name, description, category, content, source, enabled, created_at, updated_at)
        VALUES (${skill.slug}, ${name}, ${description}, 'own', ${skill.skillMdContent}, 'generated', 1, ${now}, ${now})`)
    },

    async unregister(slug: string): Promise<void> {
      db.run(sql`DELETE FROM skills WHERE id = ${slug} AND source = 'generated'`)
    },

    async isRegistered(slug: string): Promise<boolean> {
      return loader.get(slug) !== null
    },
  }
}
