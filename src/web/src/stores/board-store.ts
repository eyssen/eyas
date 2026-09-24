import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '@/lib/api'
import { conversationHasBoardTag } from '@/pages/board/board-filter-utils'

export type BoardViewMode = 'kanban' | 'list' | 'timeline' | 'graph' | 'dashboard'

/** Sentinel project id for the board "All projects" view (also the default). */
export const BOARD_ALL_PROJECTS_ID = 'all'

export interface BoardConversation {
  id: string
  taskId: string
  title: string | null
  priority: string
  pinned: boolean
  position: number
  dueDate: string | null
  assignees: string[]
  tags: string[]
  /** Junction tag ids used by the board tag filter. */
  tagIds?: string[]
  tokensUsed: number
  /** Latest composition size; absent/null when none is on file. */
  estimatedTokens?: number | null
  /** Model context window used for the occupancy stripe. */
  contextWindow?: number
  providerId?: string | null
  modelId?: string | null
  messageCount: number
  status: string
  projectId?: string | null
  updatedAt?: string
  agentId?: string | null
  agentName?: string | null
  mode?: string | null
  complexity?: string | null
  totalCostUsd?: number
  childCount?: number
  childrenDone?: number
}

export interface BoardStage {
  id: string
  name: string
  color: string | null
  sortOrder: number
  isClosed: boolean
  isFolded: boolean
  wipLimit?: number | null
  conversations: BoardConversation[]
}

interface BoardProject {
  id: string
  name: string
  color: string | null
  prompt: string | null
  typeId: string | null
}

interface BoardFilters {
  priority: string | null
  tagId: string | null
  search: string
  contentSearch: string
  stageId: string | null
  state: 'active' | 'done' | 'all'
}

interface BoardState {
  currentProjectId: string | null
  project: BoardProject | null
  stages: BoardStage[]
  projects: { id: string; name: string; color: string | null }[]
  isLoading: boolean
  filters: BoardFilters
  viewMode: BoardViewMode

  fetchProjects: () => Promise<void>
  setProject: (id: string) => void
  fetchBoard: (projectId: string) => Promise<void>
  moveConversation: (convId: string, stageId: string, position: number) => void
  /** Project used when creating from the board (All → General fallback). */
  resolveCreateProjectId: () => string | null
  addConversation: (title: string) => Promise<void>
  addConversationToStage: (title: string, stageId: string) => Promise<void>
  setFilter: (key: keyof BoardFilters, value: string | null) => void
  setViewMode: (mode: BoardViewMode) => void
  filteredStages: () => BoardStage[]
}

export const useBoardStore = create<BoardState>()(
  persist(
    (set, get) => ({
  currentProjectId: null,
  project: null,
  stages: [],
  projects: [],
  isLoading: false,
  filters: { priority: null, tagId: null, search: '', contentSearch: '', stageId: null, state: 'all' },
  viewMode: 'kanban',

  fetchProjects: async () => {
    const data = await api.get<{ projects: { id: string; name: string; color: string | null }[] }>('/projects')
    set({ projects: data.projects })
    // Default board scope is "All projects" so every conversation is visible.
    if (!get().currentProjectId) {
      get().setProject(BOARD_ALL_PROJECTS_ID)
    } else {
      // Re-fetch current board after projects list is available (names for badges).
      get().fetchBoard(get().currentProjectId!)
    }
  },

  setProject: (id: string) => {
    set({ currentProjectId: id })
    get().fetchBoard(id)
  },

  fetchBoard: async (projectId: string) => {
    set({ isLoading: true })
    try {
      const data = await api.get<{ project: BoardProject; stages: BoardStage[] }>(`/projects/${projectId}/board`)
      set({ project: data.project, stages: data.stages, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  moveConversation: (convId: string, stageId: string, position: number) => {
    // Optimistic update
    set((state) => {
      const newStages = state.stages.map(stage => ({
        ...stage,
        conversations: stage.conversations.filter(c => c.id !== convId),
      }))
      const targetStage = newStages.find(s => s.id === stageId)
      const movedConv = state.stages.flatMap(s => s.conversations).find(c => c.id === convId)
      if (targetStage && movedConv) {
        targetStage.conversations.push({ ...movedConv, position })
        targetStage.conversations.sort((a, b) => a.position - b.position)
      }
      return { stages: newStages }
    })

    api.patch(`/conversations/${convId}/move`, { stageId, position }).catch(() => {
      const projectId = get().currentProjectId
      if (projectId) get().fetchBoard(projectId)
    })
  },

  /** When viewing All, new cards land on General (or the first real project). */
  resolveCreateProjectId: (): string | null => {
    const { currentProjectId, projects } = get()
    if (currentProjectId && currentProjectId !== BOARD_ALL_PROJECTS_ID) {
      return currentProjectId
    }
    const general = projects.find((p) => p.id === 'general-general' || p.name === 'General')
    return general?.id ?? projects[0]?.id ?? null
  },

  addConversation: async (title: string) => {
    const projectId = get().resolveCreateProjectId()
    if (!projectId) return
    await api.post(`/projects/${projectId}/conversations`, { title })
    const scope = get().currentProjectId ?? BOARD_ALL_PROJECTS_ID
    get().fetchBoard(scope)
  },

  addConversationToStage: async (title: string, stageId: string) => {
    const projectId = get().resolveCreateProjectId()
    if (!projectId) return
    await api.post(`/projects/${projectId}/conversations`, { title, stageId })
    const scope = get().currentProjectId ?? BOARD_ALL_PROJECTS_ID
    get().fetchBoard(scope)
  },

  setFilter: (key, value) => {
    set((state) => ({ filters: { ...state.filters, [key]: value } }))
  },

  setViewMode: (mode) => set({ viewMode: mode }),

  filteredStages: () => {
    const { stages, filters } = get()
    return stages
      .filter(stage => {
        // State filter: active = non-closed, done = closed, all = everything
        if (filters.state === 'active' && stage.isClosed) return false
        if (filters.state === 'done' && !stage.isClosed) return false
        // Stage filter
        if (filters.stageId && stage.id !== filters.stageId) return false
        return true
      })
      .map(stage => ({
        ...stage,
        conversations: stage.conversations.filter(c => {
          if (filters.priority && c.priority !== filters.priority) return false
          if (filters.tagId && !conversationHasBoardTag(c, filters.tagId)) return false
          if (filters.search) {
            const q = filters.search.toLowerCase()
            const matchTitle = (c.title ?? '').toLowerCase().includes(q)
            const matchTaskId = c.taskId.toLowerCase().includes(q)
            if (!matchTitle && !matchTaskId) return false
          }
          return true
        }),
      }))
  },
}),
    {
      // Only the chosen view survives a reload — board data is always refetched
      // from the API, and filters are deliberately per-session.
      name: 'eyas-board-preferences',
      partialize: (state) => ({ viewMode: state.viewMode }),
    },
  ),
)
