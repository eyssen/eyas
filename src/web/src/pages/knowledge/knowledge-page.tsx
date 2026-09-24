// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { useKnowledgeStore } from '@/stores/knowledge-store'
import { BlockNoteEditor } from './blocknote-editor'
import { AttachmentList } from '@/components/attachments/attachment-list'
import { cn } from '@/lib/utils'
import { Paperclip, ChevronUp } from 'lucide-react'
import { ContextualHelp } from '@/components/docs/contextual-help'
import { t } from './i18n'

interface PageData {
  id: string
  spaceId: string
  title: string
  slug: string
  body: string
  version: number
  updatedBy: string | null
  updatedAt: string
}

interface PageVersion {
  id: string
  version: number
  changedBy: string | null
  createdAt: string
  body?: string
  contentText?: string
}

interface BacklinkRecord {
  sourceType: string
  sourceId: string
  context: string | null
}

export default function KnowledgePage() {
  const { pageId } = useParams({ from: '/knowledge/$pageId' })
  const [page, setPage] = useState<PageData | null>(null)
  const [versions, setVersions] = useState<PageVersion[]>([])
  const [backlinks, setBacklinks] = useState<BacklinkRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const pageRef = useRef<PageData | null>(null)
  const { refreshAllTrees } = useKnowledgeStore()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  pageRef.current = page

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      setSelectedVersionId(null)
      try {
        const pageData = await api.get<PageData>(`/knowledge/pages/${pageId}`)
        setPage(pageData)

        const [vers, links] = await Promise.all([
          api.get<PageVersion[]>(`/knowledge/pages/${pageId}/versions`),
          api.get<BacklinkRecord[]>(`/knowledge/pages/${pageId}/backlinks`),
        ])
        setVersions(vers)
        setBacklinks(links)
      } catch (err) {
        console.error('Failed to load knowledge page:', err)
        setPage(null)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [pageId])

  useEffect(() => {
    if (page && titleRef.current) {
      titleRef.current.value = page.title
    }
  }, [page?.id])

  const handleTitleBlur = useCallback(async () => {
    if (!page || !titleRef.current) return
    const newTitle = titleRef.current.value.trim()
    if (!newTitle || newTitle === page.title) return

    try {
      await api.patch(`/knowledge/pages/${page.id}`, { title: newTitle })
      setPage(prev => prev ? { ...prev, title: newTitle } : null)
      refreshAllTrees()
    } catch (err) {
      console.error('Failed to update title:', err)
      if (titleRef.current) titleRef.current.value = page.title
    }
  }, [page, refreshAllTrees])

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    } else if (e.key === 'Escape' && page) {
      if (titleRef.current) {
        titleRef.current.value = page.title
        titleRef.current.blur()
      }
    }
  }, [page])

  const handleContentChange = useCallback((html: string) => {
    const currentPage = pageRef.current
    if (!currentPage) return

    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      // Extract plain text for FTS by stripping tags server-side or using a simple regex
      const contentText = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      try {
        await api.patch(`/knowledge/pages/${currentPage.id}`, { body: html, contentText })
      } catch (err) {
        console.error('Failed to save content:', err)
      }
    }, 1000)
  }, [])

  const [isFullWidth, setIsFullWidth] = useState(true)
  const [attachmentsOpen, setAttachmentsOpen] = useState(false)

  const handleExportMarkdown = useCallback(() => {
    if (!page) return
    const text = page.body.replace(/<[^>]*>/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${page.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`
    a.click()
    URL.revokeObjectURL(url)
  }, [page])

  const handleToggleFullWidth = useCallback(() => {
    setIsFullWidth(prev => !prev)
  }, [])

  const handleDeletePage = useCallback(async () => {
    if (!page) return
    if (!confirm(t('knowledge.moveToTrashConfirm'))) return
    try {
      await api.delete(`/knowledge/pages/${page.id}`)
      refreshAllTrees()
      window.history.back()
    } catch (err) {
      console.error('Failed to delete page:', err)
    }
  }, [page, refreshAllTrees])

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div>
  if (!page) return <div className="p-6 text-sm text-muted-foreground">{t('knowledge.pageNotFound')}</div>

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <div className="px-6 pt-4 text-xs text-muted-foreground">
        {t('knowledge.breadcrumb')} &rsaquo; {page.title}
      </div>

      {/* Editable title */}
      <div className="px-6 pt-2 pb-4 flex items-center gap-3">
        <input
          ref={titleRef}
          defaultValue={page.title}
          onBlur={handleTitleBlur}
          onKeyDown={handleTitleKeyDown}
          className="text-xl font-semibold bg-transparent border-none outline-none focus:ring-0 focus:underline decoration-muted-foreground/40 underline-offset-2 w-full min-w-0 text-foreground placeholder:text-muted-foreground"
          placeholder={t('knowledge.untitled')}
          aria-label={t('knowledge.pageTitleAria')}
        />
        <ContextualHelp helpId="knowledge.base" />
        <span className="text-[10px] bg-accent text-muted-foreground px-2 py-0.5 rounded-full whitespace-nowrap">
          v{page.version}
        </span>
        {page.updatedBy === 'system' && (
          <span className="text-[10px] bg-green-500/10 text-green-500 px-2 py-0.5 rounded-full whitespace-nowrap">
            {t('knowledge.aiEdited')}
          </span>
        )}
        <div className="flex items-center gap-1 ml-auto flex-shrink-0">
          <button
            type="button"
            onClick={handleExportMarkdown}
            className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-0.5 rounded border border-border hover:bg-accent transition-colors whitespace-nowrap"
            title={t('knowledge.exportTitle')}
          >
            ↓ {t('knowledge.export')}
          </button>
          <button
            type="button"
            onClick={handleToggleFullWidth}
            className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-0.5 rounded border border-border hover:bg-accent transition-colors whitespace-nowrap"
            title={t('knowledge.widthTitle')}
          >
            ↔ {t('knowledge.width')}
          </button>
          <button
            type="button"
            onClick={handleDeletePage}
            className="text-[10px] text-muted-foreground hover:text-destructive px-2 py-0.5 rounded border border-border hover:bg-destructive/10 transition-colors whitespace-nowrap"
            title={t('knowledge.deletePageTitle')}
          >
            🗑
          </button>
        </div>
      </div>

      {/* Saker Editor */}
      <div className={cn("flex-1 px-6 overflow-y-auto", isFullWidth && "px-2")}>
        <div className={cn("border border-border rounded-lg bg-card overflow-hidden", isFullWidth ? "max-w-none" : "max-w-4xl mx-auto")}>
          <BlockNoteEditor
            key={page.id}
            pageId={page.id}
            initialContent={page.body}
            onChange={handleContentChange}
            fullWidth={isFullWidth}
          />
        </div>
      </div>

      {/* Attachments panel */}
      <div className={cn('border-t border-[var(--vibrancy-border,hsl(var(--border)))]', isFullWidth ? 'mx-2' : 'mx-6')}>
        <button
          type="button"
          onClick={() => setAttachmentsOpen(prev => !prev)}
          className="flex items-center gap-1.5 w-full px-3 py-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Paperclip className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{t('knowledge.attachments')}</span>
          <ChevronUp
            className={cn('h-3 w-3 ml-auto transition-transform', !attachmentsOpen && 'rotate-180')}
          />
        </button>
        {attachmentsOpen && (
          <div className="px-3 pb-3">
            <AttachmentList ownerModule="knowledge" ownerId={page.id} />
          </div>
        )}
      </div>

      {/* Bottom panels */}
      <div className="px-6 py-3 flex gap-3">
        <div className="flex-1 p-3 bg-card border border-border rounded-lg">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
            {t('knowledge.backlinks', { count: backlinks.length })}
          </div>
          {backlinks.map((bl, i) => (
            <div key={i} className="text-xs text-primary py-0.5 cursor-pointer hover:underline">
              {bl.sourceType === 'vault' ? '🗂️' : '📄'} {bl.sourceId}
            </div>
          ))}
          {backlinks.length === 0 && <div className="text-xs text-muted-foreground">{t('knowledge.noBacklinks')}</div>}
        </div>
        <div className="flex-1 p-3 bg-card border border-border rounded-lg">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
            {t('knowledge.versions')}
          </div>
          {versions.slice(0, 5).map(v => {
            const isSelected = selectedVersionId === v.id
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedVersionId(isSelected ? null : v.id)}
                className={cn(
                  'block w-full text-left text-xs py-0.5 px-1 rounded transition-colors',
                  isSelected
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                )}
              >
                v{v.version} — {v.changedBy === 'system' ? t('knowledge.versionAi') : t('knowledge.versionYou')} · {new Date(v.createdAt).toLocaleDateString()}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
