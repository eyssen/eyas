import { useEffect, useState } from 'react'
import { LayoutGrid, List, Search, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDocumentsStore } from '@/stores/documents-store'
import { DocumentCard } from './document-card'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

type MimeCategory = 'all' | 'images' | 'pdfs' | 'archives' | 'other'

function matchesCategory(mimeType: string, category: MimeCategory): boolean {
  if (category === 'all') return true
  if (category === 'images') return mimeType.startsWith('image/')
  if (category === 'pdfs') return mimeType === 'application/pdf'
  if (category === 'archives')
    return ['application/zip', 'application/x-tar', 'application/x-gzip',
      'application/x-7z-compressed', 'application/x-rar-compressed'].includes(mimeType)
  // 'other'
  return (
    !mimeType.startsWith('image/') &&
    mimeType !== 'application/pdf' &&
    !['application/zip', 'application/x-tar', 'application/x-gzip',
      'application/x-7z-compressed', 'application/x-rar-compressed'].includes(mimeType)
  )
}

const CATEGORIES: { labelKey: string; value: MimeCategory }[] = [
  { labelKey: 'documents.category.all', value: 'all' },
  { labelKey: 'documents.category.images', value: 'images' },
  { labelKey: 'documents.category.pdfs', value: 'pdfs' },
  { labelKey: 'documents.category.archives', value: 'archives' },
  { labelKey: 'documents.category.other', value: 'other' },
]

export default function DocumentsPage() {
  const { documents, isLoading, viewMode, fetchDocuments, setViewMode } = useDocumentsStore()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<MimeCategory>('all')

  useEffect(() => {
    fetchDocuments()
  }, [fetchDocuments])

  const filtered = documents.filter(doc => {
    if (doc.deletedAt) return false
    if (search && !doc.filename.toLowerCase().includes(search.toLowerCase())) return false
    if (!matchesCategory(doc.mimeType, category)) return false
    return true
  })

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--vibrancy-border)] flex-shrink-0">
        <h1 className="text-[18px] font-semibold text-foreground">{t('documents.title')} <ContextualHelp helpId="knowledge.documents" /></h1>
        <div className="flex items-center rounded-lg border border-[var(--vibrancy-border)] overflow-hidden">
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={cn(
              'p-1.5 transition-colors',
              viewMode === 'grid'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
            title={t('documents.gridView')}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={cn(
              'p-1.5 transition-colors',
              viewMode === 'list'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
            title={t('documents.listView')}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Search + filter bar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[var(--vibrancy-border)] flex-shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            placeholder={t('documents.searchFiles')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-[13px] rounded-[7px] border border-[var(--vibrancy-border)] bg-muted/30 placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[var(--vibrancy-border)]"
          />
        </div>
        <div className="flex items-center gap-1">
          {CATEGORIES.map(cat => (
            <button
              key={cat.value}
              type="button"
              onClick={() => setCategory(cat.value)}
              className={cn(
                'px-2.5 py-1 rounded-full text-[12px] transition-colors',
                category === cat.value
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              )}
            >
              {t(cat.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading && documents.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
            <p className="text-[14px]">
              {search || category !== 'all' ? t('documents.emptyFiltered') : t('documents.empty')}
            </p>
            <p className="text-[12px] opacity-70">
              {t('documents.emptyHint')}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {filtered.map(doc => (
              <DocumentCard key={doc.id} doc={doc} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {filtered.map(doc => (
              <DocumentCard key={doc.id} doc={doc} className="flex-row items-center gap-3 py-2" />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
