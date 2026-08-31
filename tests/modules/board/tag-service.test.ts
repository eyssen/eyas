import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../../helpers/test-db'
import { createProjectTypeService } from '@modules/board/services/project-type-service'
import { createProjectService } from '@modules/board/services/project-service'
import { createTagService, type TagService } from '@modules/board/services/tag-service'
import { sql } from 'drizzle-orm'
import { generateId } from '@shared/crypto'

const testDb = createTestDb('board-tags')
let db: ReturnType<typeof testDb.open>
let tagSvc: TagService
let projectId: string

beforeEach(() => {
  db = testDb.open()
  const typeService = createProjectTypeService(db)
  const projectService = createProjectService(db, typeService)
  tagSvc = createTagService(db)
  const project = projectService.create({ name: 'Test Project' })
  projectId = project.id
})
afterEach(() => testDb.cleanup())

describe('TagService', () => {
  describe('categories', () => {
    it('creates a category', () => {
      const cat = tagSvc.createCategory({ name: 'Priority', color: '#ff0000', projectId })
      expect(cat.id).toBeTruthy()
      expect(cat.name).toBe('Priority')
      expect(cat.color).toBe('#ff0000')
      expect(cat.projectId).toBe(projectId)
    })

    it('creates a category with defaults', () => {
      const cat = tagSvc.createCategory({ name: 'Status' })
      expect(cat.color).toBe('#8b949e')
      expect(cat.sortOrder).toBe(0)
      expect(cat.projectId).toBeNull()
    })

    it('lists categories by sort order', () => {
      tagSvc.createCategory({ name: 'C', sortOrder: 2 })
      tagSvc.createCategory({ name: 'A', sortOrder: 0 })
      tagSvc.createCategory({ name: 'B', sortOrder: 1 })
      const cats = tagSvc.listCategories()
      expect(cats.map(c => c.name)).toEqual(['A', 'B', 'C'])
    })

    it('filters categories by projectId', () => {
      tagSvc.createCategory({ name: 'Global' })
      tagSvc.createCategory({ name: 'Scoped', projectId })
      const scoped = tagSvc.listCategories(projectId)
      expect(scoped).toHaveLength(1)
      expect(scoped[0].name).toBe('Scoped')
    })

    it('updates a category', () => {
      const cat = tagSvc.createCategory({ name: 'Old' })
      tagSvc.updateCategory(cat.id, { name: 'New', color: '#00ff00', sortOrder: 5 })
      const cats = tagSvc.listCategories()
      const updated = cats.find(c => c.id === cat.id)!
      expect(updated.name).toBe('New')
      expect(updated.color).toBe('#00ff00')
      expect(updated.sortOrder).toBe(5)
    })

    it('deletes a category and orphans tags', () => {
      const cat = tagSvc.createCategory({ name: 'ToDelete' })
      const tag = tagSvc.createTag({ name: 'Orphan', categoryId: cat.id })
      tagSvc.deleteCategory(cat.id)
      const cats = tagSvc.listCategories()
      expect(cats.find(c => c.id === cat.id)).toBeUndefined()
      // Tag still exists but category_id is null
      const tags = tagSvc.listTags()
      const orphan = tags.find(t => t.id === tag.id)!
      expect(orphan).toBeTruthy()
      expect(orphan.categoryId).toBeNull()
    })
  })

  describe('tags', () => {
    it('creates a tag', () => {
      const tag = tagSvc.createTag({ name: 'Bug', color: '#e74c3c', projectId })
      expect(tag.id).toBeTruthy()
      expect(tag.name).toBe('Bug')
      expect(tag.color).toBe('#e74c3c')
      expect(tag.projectId).toBe(projectId)
    })

    it('creates a tag with category', () => {
      const cat = tagSvc.createCategory({ name: 'Type' })
      const tag = tagSvc.createTag({ name: 'Feature', categoryId: cat.id })
      expect(tag.categoryId).toBe(cat.id)
    })

    it('creates a tag with defaults', () => {
      const tag = tagSvc.createTag({ name: 'Plain' })
      expect(tag.color).toBe('#8b949e')
      expect(tag.categoryId).toBeNull()
      expect(tag.projectId).toBeNull()
    })

    it('lists tags ordered by name', () => {
      tagSvc.createTag({ name: 'Zeta' })
      tagSvc.createTag({ name: 'Alpha' })
      tagSvc.createTag({ name: 'Mid' })
      const tags = tagSvc.listTags()
      expect(tags.map(t => t.name)).toEqual(['Alpha', 'Mid', 'Zeta'])
    })

    it('filters tags by projectId', () => {
      tagSvc.createTag({ name: 'Global' })
      tagSvc.createTag({ name: 'Scoped', projectId })
      const scoped = tagSvc.listTags(projectId)
      expect(scoped).toHaveLength(1)
      expect(scoped[0].name).toBe('Scoped')
    })

    it('updates a tag', () => {
      const tag = tagSvc.createTag({ name: 'Old' })
      tagSvc.updateTag(tag.id, { name: 'New', color: '#123456' })
      const tags = tagSvc.listTags()
      const updated = tags.find(t => t.id === tag.id)!
      expect(updated.name).toBe('New')
      expect(updated.color).toBe('#123456')
    })

    it('updates tag category', () => {
      const cat = tagSvc.createCategory({ name: 'Type' })
      const tag = tagSvc.createTag({ name: 'Test' })
      tagSvc.updateTag(tag.id, { categoryId: cat.id })
      const tags = tagSvc.listTags()
      const updated = tags.find(t => t.id === tag.id)!
      expect(updated.categoryId).toBe(cat.id)
    })

    it('deletes a tag', () => {
      const tag = tagSvc.createTag({ name: 'ToDelete' })
      tagSvc.deleteTag(tag.id)
      const tags = tagSvc.listTags()
      expect(tags.find(t => t.id === tag.id)).toBeUndefined()
    })
  })

  describe('conversation tags', () => {
    let conversationId: string

    beforeEach(() => {
      // Insert a minimal conversation for junction testing
      conversationId = generateId()
      const now = new Date().toISOString()
      db.run(sql`INSERT INTO conversations (id, title, status, user_id, created_at, updated_at)
        VALUES (${conversationId}, 'Test Conv', 'idle', 'user1', ${now}, ${now})`)
    })

    it('sets conversation tags', () => {
      const t1 = tagSvc.createTag({ name: 'A' })
      const t2 = tagSvc.createTag({ name: 'B' })
      tagSvc.setConversationTags(conversationId, [t1.id, t2.id])
      const tags = tagSvc.getConversationTags(conversationId)
      expect(tags).toHaveLength(2)
      expect(tags.map(t => t.name)).toEqual(['A', 'B'])
    })

    it('replaces conversation tags', () => {
      const t1 = tagSvc.createTag({ name: 'Old' })
      const t2 = tagSvc.createTag({ name: 'New' })
      tagSvc.setConversationTags(conversationId, [t1.id])
      tagSvc.setConversationTags(conversationId, [t2.id])
      const tags = tagSvc.getConversationTags(conversationId)
      expect(tags).toHaveLength(1)
      expect(tags[0].name).toBe('New')
    })

    it('clears conversation tags with empty array', () => {
      const t1 = tagSvc.createTag({ name: 'Tag' })
      tagSvc.setConversationTags(conversationId, [t1.id])
      tagSvc.setConversationTags(conversationId, [])
      const tags = tagSvc.getConversationTags(conversationId)
      expect(tags).toHaveLength(0)
    })

    it('returns empty array for conversation with no tags', () => {
      const tags = tagSvc.getConversationTags(conversationId)
      expect(tags).toEqual([])
    })

    it('rolls back and keeps existing tags when a bogus tagId is passed', () => {
      const valid = tagSvc.createTag({ name: 'Valid' })
      tagSvc.setConversationTags(conversationId, [valid.id])
      expect(tagSvc.getConversationTags(conversationId)).toHaveLength(1)

      // A stale/non-existent tagId violates the FK to tags(id). The whole
      // delete+insert must roll back, leaving the original tag set intact
      // (not a partially-wiped/empty set).
      expect(() => tagSvc.setConversationTags(conversationId, [valid.id, 'does-not-exist'])).toThrow()
      const after = tagSvc.getConversationTags(conversationId)
      expect(after).toHaveLength(1)
      expect(after[0].id).toBe(valid.id)
    })
  })
})
