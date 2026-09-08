// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  WorkingDirectoriesEditor,
  namedWorkingDirectoriesFromRaw,
  payloadWorkingDirectories,
  type NamedWorkspace,
} from '@/components/working-directories-editor'
import { t } from './i18n'

interface WorkingDirectoriesTabProps {
  conversationId: string
  workingDirectories: unknown
  projectHasDirectories: boolean
  onUpdate: (fields: Record<string, unknown>) => void | Promise<void>
}

export function WorkingDirectoriesTab({
  conversationId,
  workingDirectories,
  projectHasDirectories,
  onUpdate,
}: WorkingDirectoriesTabProps) {
  void conversationId

  const [entries, setEntries] = useState<NamedWorkspace[]>(() => namedWorkingDirectoriesFromRaw(workingDirectories))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setEntries(namedWorkingDirectoriesFromRaw(workingDirectories))
  }, [JSON.stringify(workingDirectories)])

  const persist = useCallback(
    async (next: NamedWorkspace[]) => {
      const payload = payloadWorkingDirectories(next)
      setSaving(true)
      setError(null)
      try {
        await onUpdate({ workingDirectories: payload.length ? payload : null })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSaving(false)
      }
    },
    [onUpdate],
  )

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2 border-b border-border/30 flex-shrink-0 space-y-1.5">
        <p className="text-[11px] text-muted-foreground leading-snug">
          {t('conversations.chatter.foldersHint')}
        </p>
        {saving && (
          <span className="text-[10px] text-muted-foreground italic">
            {t('conversations.chatter.foldersSaving')}
          </span>
        )}
        {error && <p className="text-[11px] text-destructive">{error}</p>}
        {!payloadWorkingDirectories(entries).length && !projectHasDirectories && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            {t('conversations.chatter.foldersEmptyProject')}{' '}
            <Link to="/projects" className="text-primary hover:underline">
              {t('conversations.chatter.foldersLinkProjects')}
            </Link>
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2">
        <WorkingDirectoriesEditor
          value={entries}
          onChange={setEntries}
          onCommit={(next) => {
            setEntries(next)
            void persist(next)
          }}
          required={false}
          label={t('conversations.fields.folders')}
          hint={t('conversations.chatter.foldersHint')}
        />
      </div>
    </div>
  )
}
