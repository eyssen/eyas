import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '@/lib/api'

export const SEARCH_COLLECTIONS = [
  { id: 'conversations', label: 'Conversations' },
  { id: 'code', label: 'Code' },
  { id: 'docs', label: 'Documentation' },
  { id: 'files', label: 'Files' },
] as const

export type SearchCollectionId = (typeof SEARCH_COLLECTIONS)[number]['id']

interface SearchSource {
  id: string
  name: string
  type: string
  indexer: string
  config: Record<string, unknown>
  status: 'idle' | 'indexing' | 'ready' | 'error'
  chunkCount: number
  errorMessage: string | null
  lastIndexedAt: string | null
}

interface SearchResult {
  chunk: {
    id: string
    sourceId: string
    collection: string
    content: string
    metadata: Record<string, unknown>
  }
  score: number
  matchType: 'fts' | 'vector' | 'both'
}

interface SearchState {
  sources: SearchSource[]
  loadingSources: boolean
  fetchSources: () => Promise<void>
  createSource: (input: { name: string; type: string; indexer: string; config: Record<string, unknown> }) => Promise<void>
  deleteSource: (id: string) => Promise<void>
  indexSource: (id: string) => Promise<void>

  open: boolean
  setOpen: (open: boolean) => void
  toggleOpen: () => void

  enabledCollections: Record<SearchCollectionId, boolean>
  toggleCollection: (id: SearchCollectionId) => void

  query: string
  results: SearchResult[]
  searching: boolean
  setQuery: (q: string) => void
  search: (query: string) => Promise<void>

  stats: { sourceCount: number; totalChunks: number; collections: string[] } | null
  fetchStats: () => Promise<void>

  fetchFileContent: (path: string) => Promise<{ content: string; path: string; language: string; totalLines: number }>
}

const defaultCollections: Record<SearchCollectionId, boolean> = {
  conversations: true,
  code: true,
  docs: true,
  files: true,
}

export const useSearchStore = create<SearchState>()(
  persist(
    (set, get) => ({
  sources: [],
  loadingSources: false,

  async fetchSources() {
    set({ loadingSources: true })
    try {
      const sources = await api.get<SearchSource[]>('/search/sources')
      set({ sources })
    } finally {
      set({ loadingSources: false })
    }
  },

  async createSource(input) {
    await api.post('/search/sources', input)
    await get().fetchSources()
  },

  async deleteSource(id) {
    await api.delete(`/search/sources/${id}`)
    await get().fetchSources()
  },

  async indexSource(id) {
    await api.post(`/search/sources/${id}/index`)
    setTimeout(() => get().fetchSources(), 1000)
  },

  open: false,
  setOpen(open) { set({ open }) },
  toggleOpen() { set((s) => ({ open: !s.open })) },

  enabledCollections: { ...defaultCollections },
  toggleCollection(id) {
    set((s) => ({
      enabledCollections: { ...s.enabledCollections, [id]: !s.enabledCollections[id] },
    }))
  },

  query: '',
  results: [],
  searching: false,

  setQuery(q) {
    set({ query: q })
  },

  async search(query) {
    if (!query.trim()) {
      set({ results: [] })
      return
    }
    set({ searching: true })
    try {
      const enabled = get().enabledCollections
      const cols = Object.entries(enabled).filter(([, v]) => v).map(([k]) => k)
      const colsParam = cols.length > 0 && cols.length < SEARCH_COLLECTIONS.length
        ? `&collections=${cols.join(',')}`
        : ''
      const data = await api.get<{ results: SearchResult[] }>(
        `/search?query=${encodeURIComponent(query)}${colsParam}`
      )
      set({ results: data.results })
    } finally {
      set({ searching: false })
    }
  },

  stats: null,

  async fetchStats() {
    const stats = await api.get<{ sourceCount: number; totalChunks: number; collections: string[] }>('/search/stats')
    set({ stats })
  },

  async fetchFileContent(path) {
    return api.get<{ content: string; path: string; language: string; totalLines: number }>(
      `/search/file-content?path=${encodeURIComponent(path)}`
    )
  },
}),
    {
      name: 'eyas-search-preferences',
      partialize: (state) => ({ enabledCollections: state.enabledCollections }),
    },
  ),
)
