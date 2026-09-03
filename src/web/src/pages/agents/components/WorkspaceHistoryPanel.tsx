// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { History, RotateCcw, ChevronDown, ChevronUp, X } from 'lucide-react'
import { loadWorkspaceHistory, restoreWorkspaceSnapshot } from '@/api/workspace'
import type { WorkspaceSnapshot } from '@/api/workspace'
import { useLanguageStore, type Lang } from '@/stores/language-store'
import { t } from '../i18n'

// Maps the active UI language to a BCP-47 tag so snapshot timestamps format in
// that language rather than always Hungarian.
const LOCALE_TAG: Record<Lang, string> = {
  en: 'en-US',
  hu: 'hu-HU',
  de: 'de-DE',
  es: 'es-ES',
  fr: 'fr-FR',
  tlh: 'tlh',
}

interface Props {
  agentId: string
  file: string
  currentBody: string
  onRestored: () => void
}

interface DiffModalProps {
  snapshot: WorkspaceSnapshot
  snapshotBody: string
  currentBody: string
  onClose: () => void
  onRestore: () => void
  restoring: boolean
}

function DiffModal({ snapshot, snapshotBody, currentBody, onClose, onRestore, restoring }: DiffModalProps) {
  const lang = useLanguageStore((s) => s.lang)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-background border border-border rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <div>
            <span className="font-medium text-sm">{t('agents.historyPanel.compareTitle')}</span>
            <span className="ml-2 text-xs text-muted-foreground">
              {new Date(snapshot.timestamp).toLocaleString(LOCALE_TAG[lang])}
            </span>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-0 flex-1 min-h-0 overflow-hidden">
          <div className="flex flex-col border-r border-border/50 overflow-hidden">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground bg-accent/20 font-medium">
              {t('agents.historyPanel.snapshotLabel', { date: new Date(snapshot.timestamp).toLocaleString(LOCALE_TAG[lang]) })}
            </div>
            <pre className="flex-1 p-3 text-[11px] text-muted-foreground whitespace-pre-wrap overflow-y-auto font-mono">
              {snapshotBody || t('agents.historyPanel.empty')}
            </pre>
          </div>
          <div className="flex flex-col overflow-hidden">
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground bg-accent/20 font-medium">
              {t('agents.historyPanel.currentVersion')}
            </div>
            <pre className="flex-1 p-3 text-[11px] whitespace-pre-wrap overflow-y-auto font-mono">
              {currentBody || t('agents.historyPanel.empty')}
            </pre>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t border-border/50">
          <Button variant="outline" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={onRestore} disabled={restoring}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            {restoring ? t('agents.historyPanel.restoring') : t('agents.historyPanel.restore')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function WorkspaceHistoryPanel({ agentId, file, currentBody, onRestored }: Props) {
  const lang = useLanguageStore((s) => s.lang)
  const [expanded, setExpanded] = useState(false)
  const [snapshots, setSnapshots] = useState<WorkspaceSnapshot[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diffModal, setDiffModal] = useState<{ snapshot: WorkspaceSnapshot; body: string } | null>(null)
  const [restoring, setRestoring] = useState(false)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await loadWorkspaceHistory(agentId, file)
      setSnapshots(result)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('agents.historyPanel.historyLoadError'))
    } finally {
      setLoading(false)
    }
  }, [agentId, file])

  const handleToggle = () => {
    if (!expanded) loadHistory()
    setExpanded((v) => !v)
  }

  const handleViewDiff = (snapshot: WorkspaceSnapshot) => {
    // Use snapshot.filename as body placeholder — real body would require an additional endpoint.
    // MVP: we show the snapshot filename as the "stored content" label since there's no
    // separate GET-snapshot-body endpoint; restore still works via the restore endpoint.
    setDiffModal({ snapshot, body: t('agents.historyPanel.snapshotBodyNotice', { filename: snapshot.filename }) })
  }

  const handleRestore = useCallback(async (snapshot: WorkspaceSnapshot) => {
    setRestoring(true)
    try {
      await restoreWorkspaceSnapshot(agentId, file, snapshot.filename)
      onRestored()
      setDiffModal(null)
      setExpanded(false)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : t('agents.historyPanel.restoreError'))
    } finally {
      setRestoring(false)
    }
  }, [agentId, file, onRestored])

  return (
    <div className="border-t border-border/30 mt-4">
      <button
        type="button"
        className="flex items-center gap-2 w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={handleToggle}
      >
        <History className="h-3.5 w-3.5" />
        <span>{t('agents.historyPanel.title')}</span>
        {expanded ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
      </button>

      {expanded && (
        <div className="space-y-1 pb-2">
          {loading && (
            <p className="text-xs text-muted-foreground py-2">{t('agents.historyPanel.loading')}</p>
          )}
          {error && (
            <p className="text-xs text-destructive py-2">{error}</p>
          )}
          {!loading && !error && snapshots.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">{t('agents.historyPanel.noHistory')}</p>
          )}
          {snapshots.map((snap) => (
            <div
              key={snap.filename}
              className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-accent/20 text-xs"
            >
              <span className="flex-1 text-muted-foreground font-mono">
                {new Date(snap.timestamp).toLocaleString(LOCALE_TAG[lang])}
              </span>
              <span className="text-muted-foreground/60">
                {Math.round(snap.size / 1024 * 10) / 10} KB
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => handleViewDiff(snap)}
              >
                {t('agents.historyPanel.view')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-amber-500 hover:text-amber-400"
                onClick={() => handleRestore(snap)}
                disabled={restoring}
              >
                <RotateCcw className="h-3 w-3 mr-0.5" />
                {t('agents.historyPanel.restoreShort')}
              </Button>
            </div>
          ))}
        </div>
      )}

      {diffModal && (
        <DiffModal
          snapshot={diffModal.snapshot}
          snapshotBody={diffModal.body}
          currentBody={currentBody}
          onClose={() => setDiffModal(null)}
          onRestore={() => handleRestore(diffModal.snapshot)}
          restoring={restoring}
        />
      )}
    </div>
  )
}
