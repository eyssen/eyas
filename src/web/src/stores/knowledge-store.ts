import { create } from 'zustand'
import { api } from '@/lib/api'

interface PageTreeNode {
  id: string
  title: string
  slug: string
  icon: string | null
  sortOrder: number
  children: PageTreeNode[]
}

interface KnowledgeSpace {
  id: string
  name: string
  slug: string
  icon: string | null
}

interface KnowledgePage {
  id: string
  spaceId: string
  title: string
  slug: string
}

interface KnowledgeStore {
  spaces: KnowledgeSpace[]
  pageTree: Map<string, PageTreeNode[]>
  isLoading: boolean
  fetchSpaces: () => Promise<void>
  fetchPageTree: (spaceId: string) => Promise<void>
  refreshAllTrees: () => Promise<void>
  createPage: (spaceId: string, title: string) => Promise<KnowledgePage | null>
  deletePage: (id: string, spaceId: string) => Promise<void>
  movePage: (id: string, spaceId: string, parentId: string | null) => Promise<void>
  createSpace: (name: string) => Promise<void>
  renameSpace: (id: string, name: string) => Promise<void>
  deleteSpace: (id: string) => Promise<void>
}

export const useKnowledgeStore = create<KnowledgeStore>((set, get) => ({
  spaces: [],
  pageTree: new Map(),
  isLoading: false,

  fetchSpaces: async () => {
    set({ isLoading: true })
    try {
      const spaces = await api.get<KnowledgeSpace[]>('/knowledge/spaces')
      set({ spaces, isLoading: false })
      for (const space of spaces) {
        get().fetchPageTree(space.id)
      }
    } catch {
      set({ isLoading: false })
    }
  },

  fetchPageTree: async (spaceId: string) => {
    try {
      const tree = await api.get<PageTreeNode[]>(`/knowledge/pages?spaceId=${spaceId}&format=tree`)
      set(s => {
        const newMap = new Map(s.pageTree)
        newMap.set(spaceId, tree)
        return { pageTree: newMap }
      })
    } catch { /* silent */ }
  },

  refreshAllTrees: async () => {
    const { spaces } = get()
    for (const space of spaces) {
      await get().fetchPageTree(space.id)
    }
  },

  createPage: async (spaceId: string, title: string) => {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    try {
      const page = await api.post<KnowledgePage>('/knowledge/pages', {
        spaceId,
        title,
        slug: slug || 'untitled',
        contentJson: JSON.stringify([{ type: 'p', children: [{ text: '' }] }]),
        contentText: '',
      })
      get().fetchPageTree(spaceId)
      return page
    } catch {
      return null
    }
  },

  deletePage: async (id: string, spaceId: string) => {
    try {
      await api.delete(`/knowledge/pages/${id}`)
      get().fetchPageTree(spaceId)
    } catch { /* silent */ }
  },

  movePage: async (id: string, spaceId: string, parentId: string | null) => {
    try {
      await api.patch(`/knowledge/pages/${id}`, { parentId })
      get().fetchPageTree(spaceId)
    } catch { /* silent */ }
  },

  createSpace: async (name: string) => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    try {
      await api.post('/knowledge/spaces', { name, slug: slug || 'space' })
      get().fetchSpaces()
    } catch { /* silent */ }
  },

  renameSpace: async (id: string, name: string) => {
    try {
      await api.patch(`/knowledge/spaces/${id}`, { name })
      get().fetchSpaces()
    } catch { /* silent */ }
  },

  deleteSpace: async (id: string) => {
    try {
      await api.delete(`/knowledge/spaces/${id}`)
      set(s => {
        const newMap = new Map(s.pageTree)
        newMap.delete(id)
        return {
          spaces: s.spaces.filter(sp => sp.id !== id),
          pageTree: newMap,
        }
      })
    } catch { /* silent */ }
  },
}))
