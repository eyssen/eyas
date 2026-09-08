import { create } from 'zustand'
import { api } from '@/lib/api'

export type DocumentSource = 'user' | 'ai' | 'system'

export interface DocumentLink {
  id: string
  documentId: string
  ownerModule: string
  ownerId: string
  source: DocumentSource
  createdAt: string
}

export interface DocumentRecord {
  id: string
  links: DocumentLink[]
  filename: string
  mimeType: string
  sizeBytes: number
  storageKey: string
  remoteStatus: 'pending' | 'synced' | 'error' | 'not_configured'
  thumbnailKey: string | null
  createdBy: string | null
  createdAt: string
  deletedAt: string | null
}

export interface UploadProgress {
  id: string
  filename: string
  progress: number
  status: 'uploading' | 'done' | 'error'
  error?: string
}

export interface DocumentStats {
  totalFiles: number
  totalBytes: number
  syncedFiles: number
  pendingFiles: number
}

interface DocumentsStore {
  documents: DocumentRecord[]
  isLoading: boolean
  uploads: UploadProgress[]
  viewMode: 'grid' | 'list'
  fetchDocuments: (filters?: { ownerModule?: string; ownerId?: string }) => Promise<void>
  uploadFile: (file: File, ownerModule?: string, ownerId?: string, source?: DocumentSource) => Promise<DocumentRecord | null>
  deleteDocument: (id: string) => Promise<void>
  linkDocument: (docId: string, ownerModule: string, ownerId: string, source?: DocumentSource) => Promise<void>
  unlinkDocument: (docId: string, ownerModule: string, ownerId: string) => Promise<void>
  fetchStats: () => Promise<DocumentStats | null>
  setViewMode: (mode: 'grid' | 'list') => void
  clearUploads: () => void
}

export const useDocumentsStore = create<DocumentsStore>((set, get) => ({
  documents: [],
  isLoading: false,
  uploads: [],
  viewMode: 'grid',

  fetchDocuments: async (filters) => {
    set({ isLoading: true })
    try {
      const params = new URLSearchParams()
      if (filters?.ownerModule) params.set('owner_module', filters.ownerModule)
      if (filters?.ownerId) params.set('owner_id', filters.ownerId)
      const qs = params.toString()
      const docs = await api.get<DocumentRecord[]>(`/documents${qs ? `?${qs}` : ''}`)
      set({ documents: docs, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  uploadFile: async (file: File, ownerModule?: string, ownerId?: string, source: DocumentSource = 'user') => {
    const uploadId = crypto.randomUUID()

    set(s => ({
      uploads: [...s.uploads, { id: uploadId, filename: file.name, progress: 0, status: 'uploading' }],
    }))

    try {
      const formData = new FormData()
      formData.append('file', file)

      // Use fetch directly — api helper sends JSON, but we need multipart
      const res = await fetch('/api/v1/documents/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: { 'X-Eyas-Request': '1' },
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || res.statusText)
      }

      const doc = await res.json() as DocumentRecord

      // If owner context given, link after upload
      if (ownerModule && ownerId) {
        await api.post(`/documents/${doc.id}/link`, { owner_module: ownerModule, owner_id: ownerId, source })
        doc.links = [
          ...(doc.links ?? []),
          { id: crypto.randomUUID(), documentId: doc.id, ownerModule, ownerId, source, createdAt: new Date().toISOString() },
        ]
      }

      set(s => ({
        uploads: s.uploads.map(u => u.id === uploadId ? { ...u, progress: 100, status: 'done' } : u),
        documents: [doc, ...s.documents],
      }))

      return doc
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed'
      set(s => ({
        uploads: s.uploads.map(u => u.id === uploadId ? { ...u, status: 'error', error: message } : u),
      }))
      return null
    }
  },

  deleteDocument: async (id: string) => {
    try {
      await api.delete(`/documents/${id}`)
      set(s => ({ documents: s.documents.filter(d => d.id !== id) }))
    } catch { /* silent */ }
  },

  linkDocument: async (docId: string, ownerModule: string, ownerId: string, source: DocumentSource = 'user') => {
    try {
      const link = await api.post<DocumentLink>(`/documents/${docId}/link`, { owner_module: ownerModule, owner_id: ownerId, source })
      set(s => ({
        documents: s.documents.map(d =>
          d.id === docId ? { ...d, links: [...(d.links ?? []), link] } : d
        ),
      }))
    } catch { /* silent */ }
  },

  unlinkDocument: async (docId: string, ownerModule: string, ownerId: string) => {
    try {
      await api.post(`/documents/${docId}/unlink`, { owner_module: ownerModule, owner_id: ownerId })
      set(s => ({
        documents: s.documents.map(d =>
          d.id === docId
            ? { ...d, links: (d.links ?? []).filter(l => !(l.ownerModule === ownerModule && l.ownerId === ownerId)) }
            : d
        ),
      }))
    } catch { /* silent */ }
  },

  fetchStats: async () => {
    try {
      return await api.get<DocumentStats>('/documents/stats')
    } catch {
      return null
    }
  },

  setViewMode: (mode) => set({ viewMode: mode }),

  clearUploads: () => set({ uploads: [] }),
}))
