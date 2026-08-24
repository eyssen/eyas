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

      const frontmatter: VaultFrontmatter = {
        title: input.title,
        tier: template.frontmatter.tier,
        tags: template.frontmatter.tags,
        links: [],
        created: today,
        updated: today,
        ...(input.extraFrontmatter ?? {}),
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
