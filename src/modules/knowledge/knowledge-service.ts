// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'
import type { EyasDb } from '@core/types'
import type {
  KnowledgeSpace, CreateSpaceInput,
  KnowledgePage, CreatePageInput, UpdatePageInput,
  PageVersion, PageTreeNode,
} from './types.js'

function rowToSpace(r: any): KnowledgeSpace {
  return {
    id: r.id, name: r.name, slug: r.slug, icon: r.icon,
    description: r.description, sortOrder: r.sort_order,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

function rowToPage(r: any): KnowledgePage {
  return {
    id: r.id, spaceId: r.space_id, parentId: r.parent_id,
    title: r.title, slug: r.slug,
    body: r.body ?? '',
    contentText: r.content_text ?? '',
    icon: r.icon, sortOrder: r.sort_order,
    version: r.version, isTemplate: !!r.is_template,
    fullWidth: !!r.full_width,
    createdBy: r.created_by, updatedBy: r.updated_by,
    createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at,
  }
}

function rowToVersion(r: any): PageVersion {
  return {
    id: r.id, pageId: r.page_id, version: r.version,
    body: r.body ?? '', contentText: r.content_text ?? '',
    changedBy: r.changed_by, changeSummary: r.change_summary,
    createdAt: r.created_at,
  }
}

function toSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100) || 'untitled'
}

export function createKnowledgeService(db: EyasDb) {
  return {
    // --- Spaces ---

    createSpace(input: CreateSpaceInput): KnowledgeSpace {
      const id = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO knowledge_spaces (id, name, slug, icon, description, created_at, updated_at)
        VALUES (${id}, ${input.name}, ${input.slug}, ${input.icon ?? null}, ${input.description ?? null}, ${now}, ${now})`)
      return this.getSpace(id)!
    },

    getSpace(id: string): KnowledgeSpace | null {
      const rows = (db as any).all(sql`SELECT * FROM knowledge_spaces WHERE id = ${id}`) as any[]
      return rows.length > 0 ? rowToSpace(rows[0]) : null
    },

    listSpaces(): KnowledgeSpace[] {
      return ((db as any).all(sql`SELECT * FROM knowledge_spaces ORDER BY sort_order, name`) as any[]).map(rowToSpace)
    },

    updateSpace(id: string, updates: Partial<Pick<KnowledgeSpace, 'name' | 'icon' | 'description' | 'sortOrder'>>) {
      const now = new Date().toISOString()
      const space = this.getSpace(id)
      if (!space) return
      db.run(sql`UPDATE knowledge_spaces SET
        name = ${updates.name ?? space.name}, icon = ${updates.icon ?? space.icon},
        description = ${updates.description ?? space.description},
        sort_order = ${updates.sortOrder ?? space.sortOrder}, updated_at = ${now}
        WHERE id = ${id}`)
    },

    deleteSpace(id: string) {
      db.run(sql`DELETE FROM knowledge_pages WHERE space_id = ${id}`)
      db.run(sql`DELETE FROM knowledge_spaces WHERE id = ${id}`)
    },

    // --- Pages ---

    createPage(input: CreatePageInput): KnowledgePage {
      const id = generateId()
      const now = new Date().toISOString()
      const slug = input.slug || toSlug(input.title)
      const body = input.body ?? '<p></p>'
      const contentText = input.contentText ?? ''

      db.run(sql`INSERT INTO knowledge_pages
        (id, space_id, parent_id, title, slug, body, content_text, icon, version, created_by, created_at, updated_at)
        VALUES (${id}, ${input.spaceId}, ${input.parentId ?? null}, ${input.title}, ${slug},
                ${body}, ${contentText}, ${input.icon ?? null}, 1,
                ${input.createdBy ?? null}, ${now}, ${now})`)

      const vId = generateId()
      db.run(sql`INSERT INTO knowledge_versions
        (id, page_id, version, body, content_text, changed_by, created_at)
        VALUES (${vId}, ${id}, 1, ${body}, ${contentText}, ${input.createdBy ?? null}, ${now})`)

      return this.getPage(id)!
    },

    getPage(id: string): KnowledgePage | null {
      const rows = (db as any).all(
        sql`SELECT * FROM knowledge_pages WHERE id = ${id} AND deleted_at IS NULL`
      ) as any[]
      return rows.length > 0 ? rowToPage(rows[0]) : null
    },

    listPages(spaceId: string): KnowledgePage[] {
      return ((db as any).all(
        sql`SELECT * FROM knowledge_pages WHERE space_id = ${spaceId} AND deleted_at IS NULL ORDER BY sort_order, title`
      ) as any[]).map(rowToPage)
    },

    /**
     * Title/body substring search across pages, optionally scoped to a space.
     * LIKE-based on purpose: knowledge pages are not in the FTS index, and the
     * agent-facing `search_knowledge` tool needs a working surface today.
     */
    searchPages(query: string, opts?: { spaceSlug?: string; limit?: number }): Array<{
      id: string; spaceId: string; title: string; slug: string; snippet: string
    }> {
      const limit = opts?.limit ?? 10
      const like = `%${query}%`
      const rows = (opts?.spaceSlug
        ? (db as any).all(sql`SELECT p.id AS id, p.space_id AS space_id, p.title AS title, p.slug AS slug,
              substr(p.content_text, 1, 200) AS snippet
            FROM knowledge_pages p JOIN knowledge_spaces s ON s.id = p.space_id
            WHERE p.deleted_at IS NULL AND s.slug = ${opts.spaceSlug}
              AND (p.title LIKE ${like} OR p.content_text LIKE ${like})
            ORDER BY p.updated_at DESC LIMIT ${limit}`)
        : (db as any).all(sql`SELECT id, space_id, title, slug,
              substr(content_text, 1, 200) AS snippet
            FROM knowledge_pages
            WHERE deleted_at IS NULL AND (title LIKE ${like} OR content_text LIKE ${like})
            ORDER BY updated_at DESC LIMIT ${limit}`)) as any[]

      return rows.map(r => ({
        id: r.id, spaceId: r.space_id, title: r.title, slug: r.slug, snippet: r.snippet ?? '',
      }))
    },

    updatePage(id: string, updates: UpdatePageInput) {
      const page = this.getPage(id)
      if (!page) return

      const now = new Date().toISOString()
      const newVersion = page.version + 1
      const body = updates.body ?? page.body
      const contentText = updates.contentText ?? page.contentText
      const title = updates.title ?? page.title

      db.run(sql`UPDATE knowledge_pages SET
        title = ${title}, body = ${body},
        content_text = ${contentText}, icon = ${updates.icon ?? page.icon},
        parent_id = ${updates.parentId !== undefined ? updates.parentId : page.parentId},
        sort_order = ${updates.sortOrder ?? page.sortOrder},
        full_width = ${updates.fullWidth !== undefined ? (updates.fullWidth ? 1 : 0) : (page.fullWidth ? 1 : 0)},
        version = ${newVersion}, updated_by = ${updates.updatedBy ?? null}, updated_at = ${now}
        WHERE id = ${id}`)

      if (updates.body) {
        const vId = generateId()
        db.run(sql`INSERT INTO knowledge_versions
          (id, page_id, version, body, content_text, changed_by, created_at)
          VALUES (${vId}, ${id}, ${newVersion}, ${body}, ${contentText}, ${updates.updatedBy ?? null}, ${now})`)
      }
    },

    deletePage(id: string) {
      db.run(sql`UPDATE knowledge_pages SET deleted_at = ${new Date().toISOString()} WHERE id = ${id}`)
    },

    getVersions(pageId: string): PageVersion[] {
      return ((db as any).all(
        sql`SELECT * FROM knowledge_versions WHERE page_id = ${pageId} ORDER BY version DESC`
      ) as any[]).map(rowToVersion)
    },

    getPageTree(spaceId: string): PageTreeNode[] {
      const pages = this.listPages(spaceId)
      const byParent = new Map<string | null, KnowledgePage[]>()

      for (const page of pages) {
        const key = page.parentId ?? '__root__'
        if (!byParent.has(key)) byParent.set(key, [])
        byParent.get(key)!.push(page)
      }

      function buildTree(parentId: string | null): PageTreeNode[] {
        const key = parentId ?? '__root__'
        const children = byParent.get(key) ?? []
        return children
          .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
          .map(page => ({
            id: page.id, title: page.title, slug: page.slug,
            icon: page.icon, sortOrder: page.sortOrder,
            children: buildTree(page.id),
          }))
      }

      return buildTree(null)
    },
  }
}

export type KnowledgeService = ReturnType<typeof createKnowledgeService>
