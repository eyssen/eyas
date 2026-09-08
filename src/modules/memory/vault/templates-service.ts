// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Lightweight template + daily-note helper for the vault.
 *
 * Templates live under `data/vault/templates/*.md`. They're regular vault
 * markdown files with frontmatter + body; the body may contain handlebars-style
 * placeholders that we expand:
 *   {{date}}       current local date (YYYY-MM-DD)
 *   {{time}}       current local time (HH:MM)
 *   {{title}}      the note title passed by the caller
 *   {{cursor}}     stripped; left empty so editors can locate the insertion point
 *
 * Intentionally NOT a full template engine — full Liquid/Handlebars is overkill
 * for this use case and would pull in a larger dep surface.
 */

import type { VaultService } from './vault-service.js'
import type { VaultFrontmatter } from '../types.js'
import { hasSecretsTag, SECRETS_TAG } from '../memory-index.js'
import { normaliseFrontmatterTags } from './frontmatter.js'

export interface TemplateSummary {
  path: string
  title: string
}

export interface NewFromTemplateInput {
  templatePath: string
  targetPath: string
  title: string
  extraFrontmatter?: Partial<VaultFrontmatter>
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function nowTime(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function expand(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? '')
}

export function createTemplatesService(vault: VaultService) {
  return {
    list(): TemplateSummary[] {
      return vault.listFiles()
        .filter(f => f.startsWith('templates/'))
        .map(f => {
          const entry = vault.read(f)
          return { path: f, title: entry?.frontmatter.title ?? f }
        })
    },

    createFromTemplate(input: NewFromTemplateInput): { path: string } | null {
      const template = vault.read(input.templatePath)
      if (!template) return null

      const today = todayISO()
      const body = expand(template.content, {
        date: today,
        time: nowTime(),
        title: input.title,
        cursor: '',
      })

      // D-7 — `contains-secrets` is importer-owned and CALLER-IMMUTABLE.
      //
      // `templatePath` is any vault note, not only one under `templates/`, and
      // the caller's `extraFrontmatter` is spread below. Inheriting the tag
      // inside the literal was not enough (`{"tags": []}` overrode it), and
      // merging it back after the spread was not enough either: the guard has
      // to ask its question in the shape the STORE will keep. `hasSecretsTag`
      // accepts a JSON-string encoding of the tag list, the reader accepts only
      // a real array, so `{"tags": "[\"contains-secrets\"]"}` read as
      // already-flagged and was then written as a value the reader discards —
      // an unflagged copy holding the credential. Normalising first, and
      // writing the normalised value, is what closes that: one canonical form,
      // asked and stored identically.
      const declared = input.extraFrontmatter && 'tags' in input.extraFrontmatter
        ? (input.extraFrontmatter as { tags?: unknown }).tags
        : template.frontmatter.tags
      const tags = normaliseFrontmatterTags(declared)

      const frontmatter: VaultFrontmatter = {
        title: input.title,
        tier: template.frontmatter.tier,
        links: [],
        created: today,
        updated: today,
        ...(input.extraFrontmatter ?? {}),
        // After the spread, and canonical: a caller may choose the copy's other
        // tags, it may not launder this one away or smuggle one past the reader.
        tags: hasSecretsTag(template.frontmatter.tags) && !tags.includes(SECRETS_TAG)
          ? [...tags, SECRETS_TAG]
          : tags,
      }

      vault.write(input.targetPath, frontmatter, body)
      return { path: input.targetPath }
    },

    /**
     * Create (or return existing) today's daily note under projects/daily/YYYY-MM-DD.md.
     * If a 'templates/daily.md' template exists, it's used; otherwise a minimal
     * placeholder is written.
     */
    getOrCreateDailyNote(): { path: string; created: boolean } {
      const today = todayISO()
      const path = `projects/daily/${today}.md`
      if (vault.exists(path)) return { path, created: false }

      const templatePath = 'templates/daily.md'
      if (vault.exists(templatePath)) {
        this.createFromTemplate({
          templatePath,
          targetPath: path,
          title: `Daily ${today}`,
        })
      } else {
        vault.write(path, {
          title: `Daily ${today}`,
          tags: ['daily'],
          tier: 'procedural',
          links: [],
          created: today,
          updated: today,
        }, `# ${today}\n\n## Tasks\n\n## Notes\n`)
      }

      return { path, created: true }
    },
  }
}

export type TemplatesService = ReturnType<typeof createTemplatesService>
