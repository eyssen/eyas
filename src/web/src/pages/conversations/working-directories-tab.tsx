// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { DirectoryBrowseButton } from '@/components/directory-browser/directory-browser-dialog'
import { t } from './i18n'

interface WorkingDirectoriesTabProps {
  conversationId: string
  workingDirectories: string[] | null
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

  const [paths, setPaths] = useState<string[]>(() => workingDirectories ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPaths(workingDirectories ?? [])
  }, [workingDirectories?.join('\0')])

  const persist = useCallback(
    async (next: string[]) => {
      const cleaned = next.map((p) => p.trim()).filter(Boolean)
      setSaving(true)
      setError(null)
      try {
        await onUpdate({ workingDirectories: cleaned.length ? cleaned : null })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setSaving(false)
      }
    },
    [onUpdate],
  )

  const updateAt = (index: number, value: string) => {
    setPaths((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }

  const commit = (next: string[]) => {
    setPaths(next)
    void persist(next)
  }

  const addPath = (path: string) => {
    const cleaned = path.trim()
    if (!cleaned) return
    commit([...paths.map((p) => p.trim()).filter(Boolean), cleaned])
  }

  const remove = (index: number) => {
    commit(paths.filter((_, i) => i !== index))
  }

  const move = (index: number, dir: -1 | 1) => {
    const next = [...paths]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    commit(next)
  }

  const onBlur = () => {
    const cleaned = paths.map((p) => p.trim()).filter(Boolean)
    const prev = (workingDirectories ?? []).join('\0')
    if (cleaned.join('\0') === prev) return
    void persist(cleaned)
  }

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
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2 space-y-2">
        {paths.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t('conversations.chatter.foldersEmpty')}
            </p>
            {!projectHasDirectories && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                {t('conversations.chatter.foldersEmptyProject')}{' '}
                <Link to="/projects" className="text-primary hover:underline">
                  {t('conversations.chatter.foldersLinkProjects')}
                </Link>
              </p>
            )}
          </div>
        )}

        {paths.map((path, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <div className="flex flex-col gap-0.5 pt-1">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30"
                title={t('conversations.chatter.foldersMoveUp')}
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === paths.length - 1}
                className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30"
                title={t('conversations.chatter.foldersMoveDown')}
              >
                ▼
              </button>
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-1.5">
                {i === 0 && path.trim() && (
                  <Badge variant="outline" className="text-[10px]">
                    {t('conversations.chatter.foldersPrimary')}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={path}
                  onChange={(e) => updateAt(i, e.target.value)}
                  onBlur={onBlur}
                  placeholder={t('conversations.chatter.foldersPh')}
                  className="w-full h-7 px-2 text-xs font-mono bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <DirectoryBrowseButton
                  startPath={path}
                  onPick={(picked) => {
                    const next = [...paths]
                    next[i] = picked
                    commit(next)
                  }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-[11px] text-muted-foreground hover:text-destructive mt-5"
            >
              {t('conversations.chatter.foldersRemove')}
            </button>
          </div>
        ))}

        <div className="flex items-center gap-3">
          <DirectoryBrowseButton
            startPath={paths.filter((p) => p.trim()).at(-1)}
            onPick={addPath}
          />
          <button
            type="button"
            onClick={() => setPaths((prev) => [...prev, ''])}
            className="text-[11px] text-primary hover:underline"
          >
            {t('conversations.chatter.foldersAdd')}
          </button>
        </div>
      </div>
    </div>
  )
}
