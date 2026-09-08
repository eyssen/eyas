// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'

/**
 * Conversation tags are a board filter (project + tag), not a project tree.
 * Category names such as `module` and `area` are instance-defined examples —
 * they are not seeded. Values live on the conversation, not in this table.
 */
export interface TagCategory {
  id: string
  name: string
  color: string
  sortOrder: number
  projectId: string | null
  createdAt: string
}

export interface Tag {
  id: string
  name: string
  color: string
  categoryId: string | null
  categoryName: string | null
  projectId: string | null
  createdAt: string
}

export interface CreateTagCategoryInput {
  name: string
  color?: string
  sortOrder?: number
  projectId?: string | null
}

export interface UpdateTagCategoryInput {
  name?: string
  color?: string
  sortOrder?: number
}

export interface CreateTagInput {
  name: string
  color?: string
  categoryId?: string | null
  projectId?: string | null
}

export interface UpdateTagInput {
  name?: string
  color?: string
  categoryId?: string | null
}

export interface TagService {
  createCategory(input: CreateTagCategoryInput): TagCategory
  listCategories(projectId?: string | null): TagCategory[]
  updateCategory(id: string, input: UpdateTagCategoryInput): void
  deleteCategory(id: string): void

  createTag(input: CreateTagInput): Tag
  listTags(projectId?: string | null): Tag[]
  updateTag(id: string, input: UpdateTagInput): void
  deleteTag(id: string): void

  setConversationTags(conversationId: string, tagIds: string[]): void
  getConversationTags(conversationId: string): Tag[]
}

function toTagCategory(raw: any): TagCategory {
  return {
    id: raw.id,
    name: raw.name,
    color: raw.color ?? '#8b949e',
    sortOrder: raw.sort_order ?? 0,
    projectId: raw.project_id ?? null,
    createdAt: raw.created_at,
  }
}

function toTag(raw: any): Tag {
  return {
    id: raw.id,
    name: raw.name,
    color: raw.color ?? '#8b949e',
    categoryId: raw.category_id ?? null,
    categoryName: raw.category_name ?? null,
    projectId: raw.project_id ?? null,
    createdAt: raw.created_at,
  }
}

export function createTagService(db: any): TagService {
  return {
    createCategory(input: CreateTagCategoryInput): TagCategory {
      const id = generateId()
      db.run(sql`INSERT INTO tag_categories (id, name, color, sort_order, project_id)
        VALUES (${id}, ${input.name}, ${input.color ?? '#8b949e'}, ${input.sortOrder ?? 0}, ${input.projectId ?? null})`)
      return toTagCategory((db.all(sql`SELECT * FROM tag_categories WHERE id = ${id}`) as any[])[0])
    },

    listCategories(projectId?: string | null): TagCategory[] {
      if (projectId !== undefined && projectId !== null) {
        return (db.all(sql`SELECT * FROM tag_categories WHERE project_id = ${projectId} ORDER BY sort_order, name`) as any[]).map(toTagCategory)
      }
      return (db.all(sql`SELECT * FROM tag_categories ORDER BY sort_order, name`) as any[]).map(toTagCategory)
    },

    updateCategory(id: string, input: UpdateTagCategoryInput): void {
      if (input.name !== undefined) db.run(sql`UPDATE tag_categories SET name = ${input.name} WHERE id = ${id}`)
      if (input.color !== undefined) db.run(sql`UPDATE tag_categories SET color = ${input.color} WHERE id = ${id}`)
      if (input.sortOrder !== undefined) db.run(sql`UPDATE tag_categories SET sort_order = ${input.sortOrder} WHERE id = ${id}`)
    },

    deleteCategory(id: string): void {
      // Tags with this category get category_id set to NULL (via ON DELETE SET NULL)
      db.run(sql`DELETE FROM tag_categories WHERE id = ${id}`)
    },

    createTag(input: CreateTagInput): Tag {
      const id = generateId()
      db.run(sql`INSERT INTO tags (id, name, color, category_id, project_id)
        VALUES (${id}, ${input.name}, ${input.color ?? '#8b949e'}, ${input.categoryId ?? null}, ${input.projectId ?? null})`)
      return toTag((db.all(sql`SELECT t.*, tc.name as category_name FROM tags t LEFT JOIN tag_categories tc ON t.category_id = tc.id WHERE t.id = ${id}`) as any[])[0])
    },

    listTags(projectId?: string | null): Tag[] {
      if (projectId !== undefined && projectId !== null) {
        return (db.all(sql`SELECT t.*, tc.name as category_name FROM tags t LEFT JOIN tag_categories tc ON t.category_id = tc.id WHERE t.project_id = ${projectId} ORDER BY tc.sort_order, t.name`) as any[]).map(toTag)
      }
      return (db.all(sql`SELECT t.*, tc.name as category_name FROM tags t LEFT JOIN tag_categories tc ON t.category_id = tc.id ORDER BY tc.sort_order, t.name`) as any[]).map(toTag)
    },

    updateTag(id: string, input: UpdateTagInput): void {
      if (input.name !== undefined) db.run(sql`UPDATE tags SET name = ${input.name} WHERE id = ${id}`)
      if (input.color !== undefined) db.run(sql`UPDATE tags SET color = ${input.color} WHERE id = ${id}`)
      if (input.categoryId !== undefined) db.run(sql`UPDATE tags SET category_id = ${input.categoryId} WHERE id = ${id}`)
    },

    deleteTag(id: string): void {
      // Junction rows deleted via ON DELETE CASCADE
      db.run(sql`DELETE FROM tags WHERE id = ${id}`)
    },

    setConversationTags(conversationId: string, tagIds: string[]): void {
      // Wrap the delete-all + re-insert in a single transaction so a bad/stale
      // tagId (FK enforcement is ON) rolls the whole change back instead of
      // leaving the conversation with a partially-wiped tag set.
      const apply = () => {
        db.run(sql`DELETE FROM conversation_tags WHERE conversation_id = ${conversationId}`)
        for (const tagId of tagIds) {
          db.run(sql`INSERT INTO conversation_tags (conversation_id, tag_id) VALUES (${conversationId}, ${tagId})`)
        }
      }
      const tx = (db as any).transaction
      if (typeof tx !== 'function') {
        apply()
        return
      }
      // drizzle/bun-sqlite runs the callback immediately; better-sqlite3 returns
      // a wrapper function that must be invoked to execute inside the transaction.
      const result = tx.call(db, apply)
      if (typeof result === 'function') result()
    },

    getConversationTags(conversationId: string): Tag[] {
      return (db.all(sql`SELECT t.*, tc.name as category_name FROM tags t LEFT JOIN tag_categories tc ON t.category_id = tc.id INNER JOIN conversation_tags ct ON ct.tag_id = t.id WHERE ct.conversation_id = ${conversationId} ORDER BY tc.sort_order, t.name`) as any[]).map(toTag)
    },
  }
}
