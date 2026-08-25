// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from '../../helpers/test-db'
import { createKnowledgeTables } from '../../../src/modules/knowledge/schema.js'
import { createKnowledgeService } from '../../../src/modules/knowledge/knowledge-service.js'

describe('KnowledgeService', () => {
  let db: ReturnType<typeof createMemoryDb>
  let service: ReturnType<typeof createKnowledgeService>

  beforeEach(() => {
    db = createMemoryDb()
    createKnowledgeTables(db)
    service = createKnowledgeService(db)
  })

  describe('Spaces', () => {
    it('creates and lists spaces', () => {
      service.createSpace({ name: 'Infrastructure', slug: 'infrastructure', icon: '🏗️' })
      service.createSpace({ name: 'Projects', slug: 'projects', icon: '📋' })
      const spaces = service.listSpaces()
      expect(spaces).toHaveLength(2)
    })

    it('updates a space', () => {
      const space = service.createSpace({ name: 'Old', slug: 'old' })
      service.updateSpace(space.id, { name: 'New' })
      expect(service.getSpace(space.id)!.name).toBe('New')
    })

    it('deletes a space', () => {
      const space = service.createSpace({ name: 'Delete', slug: 'delete' })
      service.deleteSpace(space.id)
      expect(service.getSpace(space.id)).toBeNull()
    })
  })

  describe('Pages', () => {
    let spaceId: string

    beforeEach(() => {
      const space = service.createSpace({ name: 'Test', slug: 'test' })
      spaceId = space.id
    })

    it('creates a page with version', () => {
      const page = service.createPage({
        spaceId, title: 'Ingress Setup', slug: 'ingress-setup',
        body: '{"type":"doc","children":[]}', contentText: 'Ingress setup content',
      })
      expect(page.version).toBe(1)
      const versions = service.getVersions(page.id)
      expect(versions).toHaveLength(1)
    })

    it('updates a page and creates new version', () => {
      const page = service.createPage({
        spaceId, title: 'Test', slug: 'test',
        body: '{"v":1}', contentText: 'v1',
      })
      service.updatePage(page.id, { body: '{"v":2}', contentText: 'v2', updatedBy: 'system' })
      const updated = service.getPage(page.id)
      expect(updated!.version).toBe(2)
      expect(service.getVersions(page.id)).toHaveLength(2)
    })

    it('soft deletes a page', () => {
      const page = service.createPage({
        spaceId, title: 'To Delete', slug: 'to-delete',
        body: '{}', contentText: '',
      })
      service.deletePage(page.id)
      expect(service.getPage(page.id)).toBeNull()
    })

    it('builds page tree', () => {
      const parent = service.createPage({
        spaceId, title: 'K8s Cluster', slug: 'k8s',
        body: '{}', contentText: '',
      })
      service.createPage({ spaceId, parentId: parent.id, title: 'Networking', slug: 'networking', body: '{}', contentText: '' })
      service.createPage({ spaceId, parentId: parent.id, title: 'Storage', slug: 'storage', body: '{}', contentText: '' })

      const tree = service.getPageTree(spaceId)
      expect(tree).toHaveLength(1)
      expect(tree[0].title).toBe('K8s Cluster')
      expect(tree[0].children).toHaveLength(2)
    })
  })
})
