import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import MemoryGraphView from './graph-view'
import MemoryTagsView from './tags-view'
import MemoryReviewView from './review-view'
import BriefingCard from './briefing-card'
import { t } from './i18n'
import { ContextualHelp } from '@/components/docs/contextual-help'

interface Backlink {
  id: number
  sourceType: string
  sourceId: string
  context: string | null
}

interface WorkingBlock {
  key: string
  contentLength: number
  expiresAt: string
}

interface MemoryStats {
  tiers: {
    working: { count: number; blocks: WorkingBlock[] }
    episodic: {
      total: number; valid: number; invalidated: number
      avgSalience: number; minSalience: number; maxSalience: number
      bySourceType: Record<string, number>
      promotionCandidates: number; demotionCandidates: number
    }
    archive: { count: number }
    vault: { fileCount: number; files: string[] }
  }
  topTags: { tag: string; count: number }[]
  recentEpisodic: { id: string; content: string; salience: number; sourceType: string; createdAt: string }[]
}

function StatCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 bg-card border border-border rounded-lg">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-3 font-medium">{title}</div>
      {children}
    </div>
  )
}

function StatRow({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className="text-sm font-medium">{value}</span>
        {sub && <span className="text-[10px] text-muted-foreground ml-1">{sub}</span>}
      </div>
    </div>
  )
}

function SalienceBar({ value, max = 1 }: { value: number; max?: number }) {
  const pct = Math.min(100, (value / max) * 100)
  const color = value > 0.7 ? 'bg-green-500' : value > 0.3 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="w-full h-1.5 bg-accent rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
    </div>
  )
}

/**
 * Render vault content with clickable [[wikilinks]] and ![[embeds]].
 * Splits on `[[...]]` / `![[...]]` forms and renders plain text between them.
 */
function ClickableContent({ text, onLink }: { text: string; onLink: (target: string) => void }) {
  const pattern = /(!?)\[\[([^\]]+)\]\]/g
  const matches = Array.from(text.matchAll(pattern))
  if (matches.length === 0) return <>{text}</>

  const parts: React.ReactNode[] = []
  let cursor = 0
  matches.forEach((m, i) => {
    const idx = m.index ?? 0
    if (idx > cursor) parts.push(text.slice(cursor, idx))
    const isEmbed = m[1] === '!'
    const inner = m[2]
    const pipeIdx = inner.indexOf('|')
    const rawTarget = pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner
    const hashIdx = rawTarget.indexOf('#')
    const caretIdx = rawTarget.indexOf('^')
    const cut = [hashIdx, caretIdx].filter(n => n >= 0).sort((a, b) => a - b)[0]
    const target = (cut != null ? rawTarget.slice(0, cut) : rawTarget).trim()
    const display = pipeIdx >= 0 ? inner.slice(pipeIdx + 1).trim() : inner
    parts.push(
      <button
        key={`wl-${i}`}
        type="button"
        onClick={() => onLink(target)}
        className={`text-blue-400 hover:text-blue-300 hover:underline ${isEmbed ? 'italic' : ''}`}
      >
        {isEmbed ? '🖼 ' : ''}[[{display}]]
      </button>,
    )
    cursor = idx + m[0].length
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

interface WorkingMemoryDetail {
  key: string
  content: string
  /** Optional — some endpoints provide, others require computing from `content`. */
  contentLength?: number
  accessCount: number
  expiresAt: string
  createdAt: string
}

interface EpisodicMemory {
  id: string
  content: string
  sourceType: string
  sourceId: string | null
  salience: number
  tags: string[]
  validUntil: string | null
  invalidatedAt?: string | null
  createdAt: string
  // Full detail fields (present when fetched individually)
  accessCount?: number
  conversationCount?: number
  validFrom?: string
  embeddingHash?: string | null
  agentId?: string | null
  lastAccessedAt?: string | null
}

interface ArchivedMemory {
  id: string
  originalId: string
  content: string
  sourceType: string
  tags: string[]
  archivedAt: string
  originalCreatedAt: string
}

interface VaultFileEntry {
  path: string
  frontmatter: Record<string, unknown>
  content: string
}

type TabId = 'overview' | 'working' | 'episodic' | 'vault' | 'archive' | 'graph' | 'tags' | 'review'

export default function MemoryDashboard() {
  const [stats, setStats] = useState<MemoryStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isConsolidating, setIsConsolidating] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const [workingMemory, setWorkingMemory] = useState<WorkingMemoryDetail[] | null>(null)
  const [episodicMemory, setEpisodicMemory] = useState<EpisodicMemory[] | null>(null)
  const [vaultFiles, setVaultFiles] = useState<string[] | null>(null)
  const [selectedVaultFile, setSelectedVaultFile] = useState<VaultFileEntry | null>(null)
  const [backlinks, setBacklinks] = useState<Backlink[]>([])
  const [archiveMemory, setArchiveMemory] = useState<ArchivedMemory[] | null>(null)
  const [selectedEpisodic, setSelectedEpisodic] = useState<EpisodicMemory | null>(null)
  const [preselectedTag, setPreselectedTag] = useState<string | null>(null)
  const [loadingTab, setLoadingTab] = useState(false)

  const fetchStats = async () => {
    setIsLoading(true)
    try {
      const data = await api.get<MemoryStats>('/memory/stats')
      setStats(data)
    } catch (err) {
      console.error('Failed to fetch memory stats:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => { fetchStats() }, [])

  // Close the Episodic detail modal on Escape.
  useEffect(() => {
    if (!selectedEpisodic) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedEpisodic(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedEpisodic])

  const handleConsolidate = async () => {
    setIsConsolidating(true)
    try {
      await api.post('/memory/consolidate', {})
      await fetchStats()
    } catch (err) {
      console.error('Failed to consolidate:', err)
    } finally {
      setIsConsolidating(false)
    }
  }

  const loadWorkingMemory = useCallback(async () => {
    setLoadingTab(true)
    try {
      const data = await api.get<WorkingMemoryDetail[]>('/memory/working')
      setWorkingMemory(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load working memory:', err)
    } finally {
      setLoadingTab(false)
    }
  }, [])

  const loadEpisodicMemory = useCallback(async () => {
    setLoadingTab(true)
    try {
      const data = await api.get<EpisodicMemory[]>('/memory/episodic')
      setEpisodicMemory(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load episodic memory:', err)
    } finally {
      setLoadingTab(false)
    }
  }, [])

  const loadVaultFiles = useCallback(async () => {
    setLoadingTab(true)
    try {
      const data = await api.get<string[]>('/memory/vault')
      setVaultFiles(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load vault files:', err)
    } finally {
      setLoadingTab(false)
    }
  }, [])

  const loadArchiveMemory = useCallback(async () => {
    setLoadingTab(true)
    try {
      const data = await api.get<ArchivedMemory[]>('/memory/archive')
      setArchiveMemory(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Failed to load archive memory:', err)
    } finally {
      setLoadingTab(false)
    }
  }, [])

  const openEpisodicDetail = useCallback(async (id: string) => {
    try {
      const data = await api.get<EpisodicMemory>(`/memory/episodic/${id}`)
      setSelectedEpisodic(data)
    } catch (err) {
      console.error('Failed to load episodic detail:', err)
    }
  }, [])

  const loadVaultFile = useCallback(async (path: string) => {
    try {
      const data = await api.get<VaultFileEntry>(`/memory/vault/${path}`)
      setSelectedVaultFile(data)
      // Load backlinks in parallel — non-blocking for the main view
      api.get<{ target: string; backlinks: Backlink[] }>(`/memory/wikilinks/backlinks?target=${encodeURIComponent(path)}`)
        .then(res => setBacklinks(res.backlinks ?? []))
        .catch(() => setBacklinks([]))
    } catch (err) {
      console.error('Failed to load vault file:', err)
    }
  }, [])

  /**
   * Resolve a wikilink target (bare note name) to a full vault path by scanning
   * the current file list. Falls back to the target itself if no match — the
   * backend will 404 in that case, which the caller can treat as "ghost link".
   */
  const resolveWikilink = useCallback((target: string): string => {
    if (!vaultFiles) return target
    const lower = target.toLowerCase()
    const exact = vaultFiles.find(f => f === target)
    if (exact) return exact
    const byStem = vaultFiles.find(f => {
      const stem = f.replace(/\.md$/i, '').split('/').pop()?.toLowerCase() ?? ''
      return stem === lower
    })
    return byStem ?? target
  }, [vaultFiles])

  const openWikilink = useCallback((target: string) => {
    const path = resolveWikilink(target)
    if (path.endsWith('.md')) loadVaultFile(path)
  }, [resolveWikilink, loadVaultFile])

  const handleCreateDaily = useCallback(async () => {
    try {
      const res = await api.post<{ path: string; created: boolean }>('/memory/vault/daily', {})
      await loadVaultFiles()
      await loadVaultFile(res.path)
      setActiveTab('vault')
    } catch (err) {
      console.error('Failed to create daily note:', err)
    }
  }, [loadVaultFile, loadVaultFiles])

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab)
    if (tab === 'working' && !workingMemory) loadWorkingMemory()
    if (tab === 'episodic' && !episodicMemory) loadEpisodicMemory()
    if (tab === 'vault' && !vaultFiles) loadVaultFiles()
    if (tab === 'archive' && !archiveMemory) loadArchiveMemory()
  }, [workingMemory, episodicMemory, vaultFiles, archiveMemory, loadWorkingMemory, loadEpisodicMemory, loadVaultFiles, loadArchiveMemory])

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">{t('memory.loading')}</div>
  if (!stats) return <div className="p-6 text-sm text-muted-foreground">{t('memory.loadFailed')}</div>

  const { tiers, topTags, recentEpisodic } = stats

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">{t('memory.title')} <ContextualHelp helpId="knowledge.memory" /></h1>
          <p className="text-xs text-muted-foreground mt-1">{t('memory.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCreateDaily}
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            {t('memory.actions.today')}
          </button>
          <button
            type="button"
            onClick={handleConsolidate}
            disabled={isConsolidating}
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            {isConsolidating ? t('memory.actions.consolidating') : t('memory.actions.consolidate')}
          </button>
          <button
            type="button"
            onClick={() => {
              fetchStats()
              if (activeTab === 'working') loadWorkingMemory()
              else if (activeTab === 'episodic') loadEpisodicMemory()
              else if (activeTab === 'vault') loadVaultFiles()
            }}
            className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
          >
            {t('memory.actions.refresh')}
          </button>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 mb-6 border-b border-border pb-1">
        {(['overview', 'working', 'episodic', 'vault', 'archive', 'graph', 'tags', 'review'] as TabId[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => handleTabChange(tab)}
            className={`px-3 py-1.5 text-xs rounded-t-md transition-colors capitalize ${
              activeTab === tab
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            }`}
          >
            {t(`memory.tabs.${tab}`)}
          </button>
        ))}
      </div>

      <BriefingCard />

      {activeTab === 'graph' && (
        <MemoryGraphView
          onOpenNote={(path) => { setActiveTab('vault'); loadVaultFile(path) }}
        />
      )}
      {activeTab === 'tags' && (
        <MemoryTagsView
          preselected={preselectedTag}
          onOpenNote={(path) => { setActiveTab('vault'); loadVaultFile(path) }}
        />
      )}
      {activeTab === 'review' && <MemoryReviewView />}

      {/* Tab content */}
      {activeTab === 'working' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium">{t('memory.working.heading')}</h2>
            <button
              type="button"
              onClick={loadWorkingMemory}
              className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            >
              {t('common.refresh')}
            </button>
          </div>
          {loadingTab && <p className="text-sm text-muted-foreground">{t('common.loading')}</p>}
          {workingMemory && workingMemory.length === 0 && (
            <p className="text-sm text-muted-foreground italic">{t('memory.working.emptyDetail')}</p>
          )}
          {workingMemory && workingMemory.length > 0 && (
            <div className="space-y-2">
              {workingMemory.map((block) => (
                <div key={block.key} className="p-4 bg-card border border-border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm font-medium">{block.key}</span>
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                      <span>{t('memory.working.chars', { count: block.contentLength ?? block.content?.length ?? 0 })}</span>
                      <span>{t('memory.working.accessed', { count: block.accessCount })}</span>
                      <span>{t('memory.working.expires', { time: new Date(block.expiresAt).toLocaleTimeString() })}</span>
                    </div>
                  </div>
                  <pre className="text-[11px] text-muted-foreground bg-accent/30 rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-[150px] overflow-y-auto">
                    {block.content}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'episodic' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium">{t('memory.episodic.heading')}</h2>
            <button
              type="button"
              onClick={loadEpisodicMemory}
              className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            >
              {t('common.refresh')}
            </button>
          </div>
          {loadingTab && <p className="text-sm text-muted-foreground">{t('common.loading')}</p>}
          {episodicMemory && episodicMemory.length === 0 && (
            <p className="text-sm text-muted-foreground italic">{t('memory.episodic.emptyDetail')}</p>
          )}
          {episodicMemory && episodicMemory.length > 0 && (
            <div className="space-y-2">
              {episodicMemory.map((mem) => (
                <button
                  key={mem.id}
                  type="button"
                  onClick={() => openEpisodicDetail(mem.id)}
                  className="w-full text-left p-4 bg-card border border-border rounded-lg hover:bg-accent/30 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground">{mem.content}</p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <Badge variant="outline" className="text-[10px]">{mem.sourceType}</Badge>
                        {mem.tags.map((tag) => (
                          <span
                            key={tag}
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation()
                              setPreselectedTag(tag)
                              setActiveTab('tags')
                            }}
                            className="text-[10px] bg-accent text-muted-foreground hover:text-foreground px-2 py-0.5 rounded cursor-pointer"
                          >
                            #{tag}
                          </span>
                        ))}
                        {mem.validUntil && (
                          <Badge variant="destructive" className="text-[10px]">{t('memory.episodic.invalidated')}</Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 space-y-1 w-28">
                      <div className="text-[10px] text-muted-foreground">
                        {t('memory.episodic.salience', { value: mem.salience.toFixed(2) })}
                      </div>
                      <SalienceBar value={mem.salience} />
                      <div className="text-[10px] text-muted-foreground">
                        {new Date(mem.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'vault' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium">{t('memory.vault.heading')}</h2>
            <button
              type="button"
              onClick={() => { setSelectedVaultFile(null); loadVaultFiles() }}
              className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            >
              {t('common.refresh')}
            </button>
          </div>
          {loadingTab && <p className="text-sm text-muted-foreground">{t('common.loading')}</p>}

          <div className="grid grid-cols-3 gap-4">
            {/* File list */}
            <div className="col-span-1 p-4 bg-card border border-border rounded-lg max-h-[500px] overflow-y-auto">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">{t('memory.vault.files')}</div>
              {vaultFiles && vaultFiles.length === 0 && (
                <p className="text-xs text-muted-foreground italic">{t('memory.vault.empty')}</p>
              )}
              {vaultFiles && vaultFiles.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => loadVaultFile(f)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs font-mono truncate transition-colors ${
                    selectedVaultFile?.path === f
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            {/* File content */}
            <div className="col-span-2 p-4 bg-card border border-border rounded-lg max-h-[500px] overflow-y-auto">
              {!selectedVaultFile ? (
                <p className="text-xs text-muted-foreground italic">{t('memory.vault.selectFile')}</p>
              ) : (
                <>
                  <div className="text-sm font-medium font-mono mb-2">{selectedVaultFile.path}</div>
                  {Object.keys(selectedVaultFile.frontmatter).length > 0 && (
                    <div className="mb-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{t('memory.vault.frontmatter')}</div>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(selectedVaultFile.frontmatter).map(([key, val]) => {
                          // Tags + links get inline click targets.
                          if (key === 'tags' && Array.isArray(val)) {
                            return (
                              <div key={key} className="flex items-center gap-1 flex-wrap">
                                <span className="text-[10px] text-muted-foreground">{t('memory.vault.tagsLabel')}</span>
                                {(val as unknown[]).map((t, i) => (
                                  <button
                                    key={`${String(t)}-${i}`}
                                    type="button"
                                    onClick={() => { setPreselectedTag(String(t)); setActiveTab('tags') }}
                                    className="text-[10px] bg-accent text-muted-foreground hover:text-foreground px-2 py-0.5 rounded"
                                  >
                                    #{String(t)}
                                  </button>
                                ))}
                              </div>
                            )
                          }
                          if (key === 'links' && Array.isArray(val) && val.length > 0) {
                            return (
                              <div key={key} className="flex items-center gap-1 flex-wrap">
                                <span className="text-[10px] text-muted-foreground">{t('memory.vault.linksLabel')}</span>
                                {(val as unknown[]).map((t, i) => (
                                  <button
                                    key={`${String(t)}-${i}`}
                                    type="button"
                                    onClick={() => openWikilink(String(t))}
                                    className="text-[10px] text-blue-400 hover:text-blue-300 hover:underline bg-accent/50 px-2 py-0.5 rounded"
                                  >
                                    →{String(t)}
                                  </button>
                                ))}
                              </div>
                            )
                          }
                          return (
                            <div key={key} className="text-[10px] bg-accent/50 px-2 py-0.5 rounded">
                              <span className="text-muted-foreground">{key}:</span>{' '}
                              <span className="text-foreground">{Array.isArray(val) ? val.join(', ') : String(val)}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{t('memory.vault.content')}</div>
                  <div className="text-[11px] text-muted-foreground bg-accent/30 rounded-md p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                    <ClickableContent text={selectedVaultFile.content} onLink={openWikilink} />
                  </div>

                  {/* Backlinks panel */}
                  <div className="mt-4">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                      {t('memory.vault.backlinks', { count: backlinks.length })}
                    </div>
                    {backlinks.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground italic">{t('memory.vault.noBacklinks')}</p>
                    ) : (
                      <div className="space-y-1">
                        {backlinks.map(b => (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => b.sourceType === 'vault' && loadVaultFile(b.sourceId)}
                            className="w-full text-left p-2 rounded hover:bg-accent/50 transition-colors"
                          >
                            <div className="text-[11px] font-mono">{b.sourceId}</div>
                            {b.context && (
                              <div className="text-[10px] text-muted-foreground italic mt-1">…{b.context}…</div>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'archive' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium">{t('memory.archive.heading')}</h2>
            <button
              type="button"
              onClick={loadArchiveMemory}
              className="text-xs px-3 py-1.5 rounded border border-border hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
            >
              {t('common.refresh')}
            </button>
          </div>
          {loadingTab && <p className="text-sm text-muted-foreground">{t('common.loading')}</p>}
          {archiveMemory && archiveMemory.length === 0 && (
            <p className="text-sm text-muted-foreground italic">{t('memory.archive.emptyDetail')}</p>
          )}
          {archiveMemory && archiveMemory.length > 0 && (
            <div className="space-y-2">
              {archiveMemory.map((mem) => (
                <div key={mem.id} className="p-4 bg-card border border-border rounded-lg">
                  <p className="text-xs text-foreground">{mem.content}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <Badge variant="outline" className="text-[10px]">{mem.sourceType}</Badge>
                    {mem.tags.map((tag) => (
                      <span
                        key={tag}
                        role="button"
                        tabIndex={0}
                        onClick={() => { setPreselectedTag(tag); setActiveTab('tags') }}
                        className="text-[10px] bg-accent text-muted-foreground hover:text-foreground px-2 py-0.5 rounded cursor-pointer"
                      >
                        #{tag}
                      </span>
                    ))}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {t('memory.archive.metaLine', { archivedAt: new Date(mem.archivedAt).toLocaleString(), originalCreatedAt: new Date(mem.originalCreatedAt).toLocaleDateString() })}
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-muted-foreground mt-2">
                    {t('memory.archive.idLine', { id: mem.id, originalId: mem.originalId })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'overview' && (
      <>
      {/* Tier overview cards — clickable to jump to their tab */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <button
          type="button"
          onClick={() => handleTabChange('working')}
          className="p-4 bg-card border border-border rounded-lg text-center hover:bg-accent/30 transition-colors"
        >
          <div className="text-2xl font-bold">{tiers.working.count}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{t('memory.stats.workingBlocks')}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{t('memory.stats.workingTtl')}</div>
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('episodic')}
          className="p-4 bg-card border border-border rounded-lg text-center hover:bg-accent/30 transition-colors"
        >
          <div className="text-2xl font-bold">{tiers.episodic.valid}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{t('memory.stats.episodicFacts')}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {tiers.episodic.invalidated > 0 ? t('memory.overview.episodicInvalidated', { count: tiers.episodic.invalidated }) : t('memory.overview.clickToInspect')}
          </div>
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('vault')}
          className="p-4 bg-card border border-border rounded-lg text-center hover:bg-accent/30 transition-colors"
        >
          <div className="text-2xl font-bold">{tiers.vault.fileCount}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{t('memory.stats.vaultFiles')}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{t('memory.overview.semanticProcedural')}</div>
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('archive')}
          className="p-4 bg-card border border-border rounded-lg text-center hover:bg-accent/30 transition-colors"
        >
          <div className="text-2xl font-bold">{tiers.archive.count}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{t('memory.stats.archived')}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{t('memory.stats.archivedSub')}</div>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Working Memory */}
        <StatCard title={t('memory.overview.workingActiveBlocks')}>
          {tiers.working.blocks.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">{t('memory.overview.noActiveBlocks')}</div>
          ) : (
            tiers.working.blocks.map(b => (
              <button
                key={b.key}
                type="button"
                onClick={() => handleTabChange('working')}
                className="flex items-center justify-between py-1.5 border-b border-border last:border-0 w-full hover:bg-accent/30 rounded transition-colors px-2 -mx-2"
              >
                <span className="text-xs font-mono text-foreground">{b.key}</span>
                <div className="text-right">
                  <span className="text-[10px] text-muted-foreground">{t('memory.working.chars', { count: b.contentLength })}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">{t('memory.working.expires', { time: new Date(b.expiresAt).toLocaleTimeString() })}</span>
                </div>
              </button>
            ))
          )}
        </StatCard>

        {/* Episodic Salience */}
        <StatCard title={t('memory.overview.episodicSalience')}>
          <div className="mb-3">
            <SalienceBar value={tiers.episodic.avgSalience} />
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-muted-foreground">{t('memory.overview.min', { value: tiers.episodic.minSalience })}</span>
              <span className="text-[10px] text-foreground font-medium">{t('memory.overview.avg', { value: tiers.episodic.avgSalience })}</span>
              <span className="text-[10px] text-muted-foreground">{t('memory.overview.max', { value: tiers.episodic.maxSalience })}</span>
            </div>
          </div>
          <StatRow label={t('memory.overview.readyPromotion')} value={tiers.episodic.promotionCandidates} sub={t('memory.overview.toVault')} />
          <StatRow label={t('memory.overview.readyDemotion')} value={tiers.episodic.demotionCandidates} sub={t('memory.overview.toArchive')} />
        </StatCard>

        {/* Source Type Breakdown */}
        <StatCard title={t('memory.overview.episodicBySource')}>
          {Object.entries(tiers.episodic.bySourceType).length === 0 ? (
            <div className="text-xs text-muted-foreground italic">{t('memory.overview.noEpisodicYet')}</div>
          ) : (
            Object.entries(tiers.episodic.bySourceType).map(([type, count]) => (
              <StatRow key={type} label={type} value={count} />
            ))
          )}
        </StatCard>

        {/* Top Tags — click to pivot */}
        <StatCard title={t('memory.overview.topTags')}>
          {topTags.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">{t('memory.overview.noTagsYet')}</div>
          ) : (
            topTags.map(({ tag, count }) => (
              <button
                key={tag}
                type="button"
                onClick={() => { setPreselectedTag(tag); handleTabChange('tags') }}
                className="flex items-center justify-between py-1 w-full hover:bg-accent/30 rounded transition-colors px-2 -mx-2"
              >
                <span className="text-xs bg-accent px-2 py-0.5 rounded">{tag}</span>
                <span className="text-xs text-muted-foreground">{count}</span>
              </button>
            ))
          )}
        </StatCard>
      </div>

      {/* Vault Files — click to open */}
      {tiers.vault.fileCount > 0 && (
        <StatCard title={t('memory.overview.vaultFilesCount', { count: tiers.vault.fileCount })}>
          <div className="grid grid-cols-2 gap-1">
            {tiers.vault.files.map(f => (
              <button
                key={f}
                type="button"
                onClick={() => { setActiveTab('vault'); loadVaultFile(f) }}
                className="text-xs text-muted-foreground hover:text-foreground font-mono py-0.5 truncate text-left hover:bg-accent/30 rounded px-1 transition-colors"
              >
                📄 {f}
              </button>
            ))}
          </div>
        </StatCard>
      )}

      {/* Recent Episodic — click for detail */}
      {recentEpisodic.length > 0 && (
        <div className="mt-4">
          <StatCard title={t('memory.overview.recentEpisodic')}>
            {recentEpisodic.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => openEpisodicDetail(m.id)}
                className="py-2 border-b border-border last:border-0 w-full text-left hover:bg-accent/30 rounded transition-colors px-2 -mx-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="text-xs text-foreground flex-1">{m.content}</div>
                  <div className="text-right flex-shrink-0 w-24">
                    <div className="text-[10px] text-muted-foreground">{m.sourceType}</div>
                    <SalienceBar value={m.salience} />
                  </div>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">{new Date(m.createdAt).toLocaleString()}</div>
              </button>
            ))}
          </StatCard>
        </div>
      )}
      </>
      )}

      {/* Episodic detail modal */}
      {selectedEpisodic && (
        <div
          role="dialog"
          onClick={() => setSelectedEpisodic(null)}
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-background border border-border rounded-lg p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-2xl"
          >
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-sm font-medium">{t('memory.detail.heading')}</h3>
              <button
                type="button"
                onClick={() => setSelectedEpisodic(null)}
                className="text-muted-foreground hover:text-foreground text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{t('memory.vault.content')}</div>
                <p className="text-sm text-foreground bg-accent/30 rounded p-3">{selectedEpisodic.content}</p>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">{t('memory.detail.metadata')}</div>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                  <span className="text-muted-foreground">{t('memory.detail.id')}</span>
                  <span className="font-mono text-[10px] break-all">{selectedEpisodic.id}</span>

                  <span className="text-muted-foreground">{t('memory.detail.source')}</span>
                  <span>{selectedEpisodic.sourceType}</span>

                  {selectedEpisodic.sourceId && (
                    <>
                      <span className="text-muted-foreground">{t('memory.detail.sourceId')}</span>
                      <span className="font-mono text-[10px] break-all">{selectedEpisodic.sourceId}</span>
                    </>
                  )}

                  {selectedEpisodic.agentId && (
                    <>
                      <span className="text-muted-foreground">{t('memory.detail.agent')}</span>
                      <span className="font-mono text-[10px] break-all">{selectedEpisodic.agentId}</span>
                    </>
                  )}

                  <span className="text-muted-foreground">{t('memory.detail.salience')}</span>
                  <span>{selectedEpisodic.salience.toFixed(3)}</span>

                  {selectedEpisodic.accessCount !== undefined && (
                    <>
                      <span className="text-muted-foreground">{t('memory.detail.accessCount')}</span>
                      <span>{selectedEpisodic.accessCount}</span>
                    </>
                  )}

                  {selectedEpisodic.conversationCount !== undefined && (
                    <>
                      <span className="text-muted-foreground">{t('memory.detail.conversationCount')}</span>
                      <span>{selectedEpisodic.conversationCount}</span>
                    </>
                  )}

                  {selectedEpisodic.validFrom && (
                    <>
                      <span className="text-muted-foreground">{t('memory.detail.validFrom')}</span>
                      <span>{new Date(selectedEpisodic.validFrom).toLocaleString()}</span>
                    </>
                  )}

                  {selectedEpisodic.validUntil && (
                    <>
                      <span className="text-muted-foreground">{t('memory.detail.invalidatedAt')}</span>
                      <span className="text-red-400">{new Date(selectedEpisodic.validUntil).toLocaleString()}</span>
                    </>
                  )}

                  <span className="text-muted-foreground">{t('memory.detail.created')}</span>
                  <span>{new Date(selectedEpisodic.createdAt).toLocaleString()}</span>

                  {selectedEpisodic.lastAccessedAt && (
                    <>
                      <span className="text-muted-foreground">{t('memory.detail.lastAccessed')}</span>
                      <span>{new Date(selectedEpisodic.lastAccessedAt).toLocaleString()}</span>
                    </>
                  )}

                  <span className="text-muted-foreground">{t('memory.detail.embeddingHash')}</span>
                  <span className="font-mono text-[10px] break-all">{selectedEpisodic.embeddingHash ?? t('memory.detail.notEmbedded')}</span>
                </div>
              </div>

              {selectedEpisodic.tags.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{t('memory.detail.tags')}</div>
                  <div className="flex flex-wrap gap-1">
                    {selectedEpisodic.tags.map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => { setPreselectedTag(t); setActiveTab('tags'); setSelectedEpisodic(null) }}
                        className="text-[10px] bg-accent text-muted-foreground hover:text-foreground px-2 py-0.5 rounded"
                      >
                        #{t}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">{t('memory.detail.salienceBar')}</div>
                <SalienceBar value={selectedEpisodic.salience} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
