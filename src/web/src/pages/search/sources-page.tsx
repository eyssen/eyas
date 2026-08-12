import { useState, useEffect } from 'react'
import { useSearchStore } from '@/stores/search-store'
import { cn } from '@/lib/utils'
import { RefreshCw, Trash2, Plus, Database, X } from 'lucide-react'
import { t, tOr } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

const SOURCE_TYPES = ['filesystem', 'git', 'url', 'custom']
const INDEXER_TYPES = ['code', 'docs', 'files']

const STATUS_STYLES: Record<string, string> = {
  idle: 'bg-muted text-muted-foreground',
  indexing: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
  ready: 'bg-green-500/15 text-green-600 dark:text-green-400',
  error: 'bg-destructive/15 text-destructive',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium', STATUS_STYLES[status] ?? STATUS_STYLES.idle)}>
      {tOr(`search.status.${status}`, status)}
    </span>
  )
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString()
}

export default function SourcesPage() {
  const { sources, loadingSources, fetchSources, createSource, deleteSource, indexSource, stats, fetchStats } = useSearchStore()
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState('code')
  const [formIndexer, setFormIndexer] = useState('code')
  const [formPaths, setFormPaths] = useState('')
  const [formLabel, setFormLabel] = useState('')
  const [formVersion, setFormVersion] = useState('')
  const [formEdition, setFormEdition] = useState('')
  const [formFamily, setFormFamily] = useState('')
  const [formExclude, setFormExclude] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [indexingId, setIndexingId] = useState<string | null>(null)

  useEffect(() => {
    fetchSources()
    fetchStats()
  }, [fetchSources, fetchStats])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formName.trim()) return
    setSubmitting(true)
    try {
      const paths = formPaths.split('\n').map(s => s.trim()).filter(Boolean)
      const exclude = formExclude.split('\n').map(s => s.trim()).filter(Boolean)
      const config: Record<string, unknown> = { paths }
      if (formLabel.trim()) config.label = formLabel.trim()
      if (formVersion.trim()) config.version = formVersion.trim()
      if (formEdition.trim()) config.edition = formEdition.trim()
      if (formFamily.trim()) config.family = formFamily.trim()
      if (exclude.length) config.exclude = exclude
      if (formFamily.trim() === 'odoo' && !exclude.length) {
        config.exclude = ['i18n', 'static', '__pycache__', 'node_modules', '.git']
      }
      await createSource({ name: formName, type: formType, indexer: formIndexer, config })
      setFormName('')
      setFormPaths('')
      setFormLabel('')
      setFormVersion('')
      setFormEdition('')
      setFormFamily('')
      setFormExclude('')
      setShowForm(false)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await deleteSource(id)
    } finally {
      setDeletingId(null)
    }
  }

  const handleIndex = async (id: string) => {
    setIndexingId(id)
    try {
      await indexSource(id)
    } finally {
      setIndexingId(null)
    }
  }

  return (
    <div>
      <div className="flex items-baseline justify-between mb-5">
        <div>
          <h1 className="page-title inline-flex items-center gap-1.5">{t('search.sources.title')} <ContextualHelp helpId="daily.search" /></h1>
          <p className="text-sm text-muted-foreground">{t('search.sources.subtitle')}</p>
        </div>
        {stats && (
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span><strong className="text-foreground">{stats.sourceCount}</strong> {t('search.sources.wordSources')}</span>
            <span><strong className="text-foreground">{stats.totalChunks}</strong> {t('search.sources.wordChunks')}</span>
            {stats.collections.length > 0 && (
              <span><strong className="text-foreground">{stats.collections.length}</strong> {t('search.sources.wordCollections')}</span>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end mb-3">
        <button
          type="button"
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showForm ? t('common.cancel') : t('search.sources.add')}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="glass-card p-4 mb-4 flex flex-col gap-3">
          <div className="text-sm font-medium mb-1">{t('search.sources.new')}</div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('search.sources.name')}</label>
              <input
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder={t('search.sources.namePh')}
                required
                className="h-8 px-3 text-xs bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('search.sources.type')}</label>
              <select
                value={formType}
                onChange={e => setFormType(e.target.value)}
                className="h-8 px-3 text-xs bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {SOURCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('search.sources.indexer')}</label>
              <select
                value={formIndexer}
                onChange={e => setFormIndexer(e.target.value)}
                className="h-8 px-3 text-xs bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {INDEXER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('search.sources.paths')}</label>
            <textarea
              value={formPaths}
              onChange={e => setFormPaths(e.target.value)}
              rows={2}
              placeholder="/Users/me/odoo-odoo-18"
              className="px-3 py-2 text-xs bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring resize-none font-mono"
            />
            <p className="text-[10px] text-muted-foreground">{t('search.sources.pathsHint')}</p>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('search.sources.label')}</label>
              <input
                value={formLabel}
                onChange={e => setFormLabel(e.target.value)}
                placeholder={t('search.sources.labelPh')}
                className="h-8 px-3 text-xs bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring font-mono"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('search.sources.version')}</label>
              <input
                value={formVersion}
                onChange={e => setFormVersion(e.target.value)}
                placeholder="18"
                className="h-8 px-3 text-xs bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring font-mono"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('search.sources.edition')}</label>
              <input
                value={formEdition}
                onChange={e => setFormEdition(e.target.value)}
                placeholder={t('search.sources.editionPh')}
                className="h-8 px-3 text-xs bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t('search.sources.family')}</label>
              <select
                value={formFamily}
                onChange={e => setFormFamily(e.target.value)}
                className="h-8 px-3 text-xs bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{t('search.sources.familyNone')}</option>
                <option value="odoo">odoo</option>
                <option value="addons">addons</option>
                <option value="app">app</option>
              </select>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('search.sources.exclude')}</label>
            <textarea
              value={formExclude}
              onChange={e => setFormExclude(e.target.value)}
              rows={2}
              placeholder={'i18n\nstatic\nnode_modules'}
              className="px-3 py-2 text-xs bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring resize-none font-mono"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {submitting ? t('search.sources.creating') : t('search.sources.create')}
            </button>
          </div>
        </form>
      )}

      {loadingSources && sources.length === 0 && (
        <p className="text-sm text-muted-foreground mt-4">{t('search.sources.loading')}</p>
      )}

      {!loadingSources && sources.length === 0 && (
        <div className="glass-card p-8 text-center">
          <Database className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{t('search.sources.empty')}</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {sources.map(source => (
          <div key={source.id} className="glass-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-sm font-medium truncate">{source.name}</span>
                  <StatusBadge status={source.status} />
                  {typeof source.config?.label === 'string' && source.config.label && (
                    <span className="text-[11px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">{source.config.label as string}</span>
                  )}
                  {typeof source.config?.version === 'string' && source.config.version && (
                    <span className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">v{source.config.version as string}</span>
                  )}
                  {typeof source.config?.edition === 'string' && source.config.edition && (
                    <span className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{source.config.edition as string}</span>
                  )}
                  {typeof source.config?.family === 'string' && source.config.family && (
                    <span className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{source.config.family as string}</span>
                  )}
                  <span className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{source.type}</span>
                  <span className="text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{source.indexer}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span><strong className="text-foreground">{source.chunkCount}</strong> {t('search.sources.wordChunks')}</span>
                  <span>{t('search.sources.lastIndexed', { date: formatDate(source.lastIndexedAt) })}</span>
                  {source.errorMessage && (
                    <span className="text-destructive truncate max-w-[300px]">{source.errorMessage}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => handleIndex(source.id)}
                  disabled={indexingId === source.id || source.status === 'indexing'}
                  title={t('search.sources.reindex')}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 disabled:opacity-40 transition-colors"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', (indexingId === source.id || source.status === 'indexing') && 'animate-spin')} />
                  {t('search.sources.reindex')}
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(source.id)}
                  disabled={deletingId === source.id}
                  title={t('search.sources.deleteTitle')}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('common.delete')}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
