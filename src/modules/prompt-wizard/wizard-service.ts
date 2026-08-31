// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import { buildPromptChain } from './prompt-builder.js'
import type { PromptTemplate, CreatePromptTemplateInput, PromptLevel } from './types.js'

function toTemplate(raw: any): PromptTemplate {
  return {
    id: raw.id,
    level: raw.level,
    targetId: raw.target_id ?? null,
    name: raw.name,
    content: raw.content,
    section: raw.section ?? undefined,
    locked: raw.locked === 1,
    isActive: raw.is_active === 1,
    createdBy: raw.created_by,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

export function createWizardService(db: any) {
  return {
    create(input: CreatePromptTemplateInput): PromptTemplate {
      const id = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO prompt_templates (id, level, target_id, name, content, is_active, created_by, created_at, updated_at)
        VALUES (${id}, ${input.level}, ${input.targetId ?? null}, ${input.name}, ${input.content}, 1, ${input.createdBy}, ${now}, ${now})`)
      return { id, level: input.level, targetId: input.targetId, name: input.name, content: input.content, section: input.section, locked: input.locked ?? false, isActive: true, createdBy: input.createdBy, createdAt: now, updatedAt: now }
    },

    get(id: string): PromptTemplate | null {
      const rows = db.all(sql`SELECT * FROM prompt_templates WHERE id = ${id}`) as any[]
      return rows.length > 0 ? toTemplate(rows[0]) : null
    },

    getMasterSection(section: string): string | null {
      const rows = db.all(sql`SELECT content FROM prompt_templates
        WHERE level = 'master' AND section = ${section} AND is_active = 1 LIMIT 1`) as any[]
      return rows.length > 0 ? (rows[0].content as string) : null
    },

    getActive(level: PromptLevel, targetId?: string): PromptTemplate | null {
      let rows: any[]
      if (targetId) {
        rows = db.all(sql`SELECT * FROM prompt_templates WHERE level = ${level} AND target_id = ${targetId} AND is_active = 1 ORDER BY updated_at DESC LIMIT 1`) as any[]
      } else {
        rows = db.all(sql`SELECT * FROM prompt_templates WHERE level = ${level} AND target_id IS NULL AND is_active = 1 ORDER BY updated_at DESC LIMIT 1`) as any[]
      }
      return rows.length > 0 ? toTemplate(rows[0]) : null
    },

    list(level?: PromptLevel): PromptTemplate[] {
      let rows: any[]
      if (level) {
        rows = db.all(sql`SELECT * FROM prompt_templates WHERE level = ${level} ORDER BY updated_at DESC`) as any[]
      } else {
        rows = db.all(sql`SELECT * FROM prompt_templates ORDER BY level, updated_at DESC`) as any[]
      }
      return rows.map(toTemplate)
    },

    update(id: string, patch: { name?: string; content?: string; isActive?: boolean }): void {
      const now = new Date().toISOString()
      if (patch.name !== undefined) db.run(sql`UPDATE prompt_templates SET name = ${patch.name}, updated_at = ${now} WHERE id = ${id}`)
      if (patch.content !== undefined) db.run(sql`UPDATE prompt_templates SET content = ${patch.content}, updated_at = ${now} WHERE id = ${id}`)
      if (patch.isActive !== undefined) db.run(sql`UPDATE prompt_templates SET is_active = ${patch.isActive ? 1 : 0}, updated_at = ${now} WHERE id = ${id}`)
    },

    delete(id: string): void {
      db.run(sql`DELETE FROM prompt_templates WHERE id = ${id}`)
    },

    /**
     * Build the full prompt chain for a conversation by resolving each level.
     * Walks up: conversation -> project -> project_type -> master
     */
    buildChainForConversation(conversationPrompt: string | null, projectId?: string, projectTypeId?: string): string {
      const master = this.getActive('master')
      const projectType = projectTypeId ? this.getActive('project_type', projectTypeId) : null
      const project = projectId ? this.getActive('project', projectId) : null

      return buildPromptChain({
        master: master?.content ?? null,
        projectType: projectType?.content ?? null,
        project: project?.content ?? null,
        conversation: conversationPrompt,
      })
    },
  }
}
