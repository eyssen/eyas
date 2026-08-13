// Part of eYssen. See LICENSE file for full copyright and licensing details.

// --- Space ---

export interface KnowledgeSpace {
  id: string
  name: string
  slug: string
  icon: string | null
  description: string | null
  sortOrder: number
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateSpaceInput {
  name: string
  slug: string
  icon?: string
  description?: string
}

// --- Page ---

export interface KnowledgePage {
  id: string
  spaceId: string
  parentId: string | null
  title: string
  slug: string
  body: string
  contentText: string
  icon: string | null
  sortOrder: number
  version: number
  isTemplate: boolean
  fullWidth: boolean
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface CreatePageInput {
  spaceId: string
  parentId?: string
  title: string
  /** Falls back to a slugified `title` when omitted. */
  slug?: string
  body?: string
  contentText?: string
  icon?: string
  createdBy?: string
}

export interface UpdatePageInput {
  title?: string
  body?: string
  contentText?: string
  icon?: string
  parentId?: string | null
  sortOrder?: number
  fullWidth?: boolean
  updatedBy?: string
}

// --- Version ---

export interface PageVersion {
  id: string
  pageId: string
  version: number
  body: string
  contentText: string
  changedBy: string | null
  changeSummary: string | null
  createdAt: string
}

// --- Tree ---

export interface PageTreeNode {
  id: string
  title: string
  slug: string
  icon: string | null
  sortOrder: number
  children: PageTreeNode[]
}
