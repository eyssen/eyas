// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useEffect, useRef, useState } from 'react'
import { History, ListTodo, Paperclip, Code2, Folder, Swords } from 'lucide-react'
import { ChatterMessageList, type HistoryFilter } from '@/components/chatter/chatter-messages'
import { ChatterComposer } from '@/components/chatter/chatter-composer'
import { ActivityList } from '@/components/activity/activity-list'
import { AttachmentList } from '@/components/attachments/attachment-list'
import { SearchSourcesTab, type SearchContextSpec } from './search-sources-tab'
import { WorkingDirectoriesTab } from './working-directories-tab'
import { GodModeTab, visibleGodTab } from './god-mode-tab'
import { t } from './i18n'

interface ChatterPanelProps {
  conversationId: string
  externalRefreshKey?: number
  searchContext?: SearchContextSpec | null
  onSearchContextUpdate?: (fields: Record<string, unknown>) => void | Promise<void>
  workingDirectories?: unknown
  projectHasDirectories?: boolean
  godMode?: boolean
  conversationStatus?: string
  hasGodRuns?: boolean
}

export type ChatterTab = 'history' | 'sources' | 'folders' | 'next' | 'files' | 'god'

const TABS: { id: ChatterTab; labelKey: string; icon: React.ReactNode }[] = [
  { id: 'history', labelKey: 'conversations.chatter.history', icon: <History className="h-3.5 w-3.5" /> },
  { id: 'sources', labelKey: 'conversations.chatter.sources', icon: <Code2 className="h-3.5 w-3.5" /> },
  { id: 'folders', labelKey: 'conversations.chatter.folders', icon: <Folder className="h-3.5 w-3.5" /> },
  { id: 'next', labelKey: 'conversations.chatter.next', icon: <ListTodo className="h-3.5 w-3.5" /> },
  { id: 'files', labelKey: 'conversations.chatter.files', icon: <Paperclip className="h-3.5 w-3.5" /> },
  { id: 'god', labelKey: 'conversations.chatter.god', icon: <Swords className="h-3.5 w-3.5" /> },
]

const FILTERS: { id: HistoryFilter; labelKey: string }[] = [
  { id: 'all', labelKey: 'conversations.chatter.filterAll' },
  { id: 'notes', labelKey: 'conversations.chatter.filterNotes' },
  { id: 'changes', labelKey: 'conversations.chatter.filterChanges' },
]

export function ChatterPanel({
  conversationId,
  externalRefreshKey = 0,
  searchContext = null,
  onSearchContextUpdate,
  workingDirectories = null,
  projectHasDirectories = false,
  godMode = false,
  conversationStatus,
  hasGodRuns = false,
}: ChatterPanelProps) {
  const [activeTab, setActiveTab] = useState<ChatterTab>('history')
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const [refreshKey, setRefreshKey] = useState(0)
  const [detectedRuns, setDetectedRuns] = useState(false)
  const autoSelectedRef = useRef(false)

  const showGod = visibleGodTab(godMode, (hasGodRuns || detectedRuns) ? 1 : 0)
  const handleRunsDetected = useCallback(() => setDetectedRuns(true), [])
  const visibleTabs = TABS.filter((tab) => tab.id !== 'god' || showGod)

  useEffect(() => {
    autoSelectedRef.current = false
    setDetectedRuns(false)
  }, [conversationId])

  useEffect(() => {
    const shouldSelect = conversationStatus === 'working' && godMode && showGod
    if (shouldSelect && !autoSelectedRef.current) {
      setActiveTab('god')
      autoSelectedRef.current = true
    }
    if (!shouldSelect) autoSelectedRef.current = false
  }, [conversationId, conversationStatus, godMode, showGod])

  useEffect(() => {
    if (activeTab === 'god' && !showGod) setActiveTab('history')
  }, [activeTab, showGod])

  const combinedRefreshKey = refreshKey + externalRefreshKey
  const handleMessageSent = () => setRefreshKey((k) => k + 1)

  return (
    <div className="flex flex-col h-full min-h-0 border-l border-border/50">
      <div className="flex border-b border-border/50 flex-shrink-0 overflow-x-auto">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? tab.id === 'god'
                  ? 'text-god border-b-2 border-god'
                  : 'text-foreground border-b-2 border-primary'
                : tab.id === 'god'
                  ? 'text-god/70 hover:text-god'
                  : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.icon}
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {activeTab === 'history' && (
          <>
            <div className="flex gap-1 px-3 py-1.5 border-b border-border/30 flex-shrink-0">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    filter === f.id
                      ? 'bg-primary/15 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t(f.labelKey)}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">
              <ChatterMessageList
                conversationId={conversationId}
                refreshKey={combinedRefreshKey}
                filter={filter}
              />
            </div>
            <ChatterComposer conversationId={conversationId} onSent={handleMessageSent} />
          </>
        )}

        {activeTab === 'sources' && (
          <div className="flex-1 min-h-0 flex flex-col">
            <SearchSourcesTab
              conversationId={conversationId}
              searchContext={searchContext}
              onUpdate={onSearchContextUpdate ?? (async () => {})}
            />
          </div>
        )}

        {activeTab === 'folders' && (
          <div className="flex-1 min-h-0 flex flex-col">
            <WorkingDirectoriesTab
              conversationId={conversationId}
              workingDirectories={workingDirectories}
              projectHasDirectories={projectHasDirectories}
              onUpdate={onSearchContextUpdate ?? (async () => {})}
            />
          </div>
        )}

        {activeTab === 'next' && (
          <div className="flex-1 overflow-y-auto min-h-0">
            <ActivityList resModel="conversation" resId={conversationId} />
          </div>
        )}

        {activeTab === 'files' && (
          <div className="flex-1 flex flex-col min-h-0">
            <AttachmentList
              ownerModule="conversations"
              ownerId={conversationId}
              variant="full"
              className="flex-1 min-h-0"
            />
          </div>
        )}

        {activeTab === 'god' && showGod && (
          <div className="flex-1 min-h-0 flex flex-col">
            <GodModeTab
              conversationId={conversationId}
              conversationStatus={conversationStatus}
              onRunsDetected={handleRunsDetected}
            />
          </div>
        )}
      </div>
    </div>
  )
}
