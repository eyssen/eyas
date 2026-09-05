import { useRef } from 'react'
import { X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DirectoryBrowseButton } from '@/components/directory-browser/directory-browser-dialog'
import { t } from '@/pages/projects/i18n'
import { toNamedWorkingDirectories, type NamedWorkspace } from '@/pages/conversations/conversation-fields-utils'

export type { NamedWorkspace }

interface WorkingDirectoriesEditorProps {
  value: NamedWorkspace[]
  onChange: (next: NamedWorkspace[]) => void
  label?: string
  hint?: string
  required?: boolean
  seedEmptyHint?: boolean
  /** Persist after blur / reorder / pick. Typing only updates local state until then. */
  onCommit?: (next: NamedWorkspace[]) => void
}

function basenameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function emptyWorkingDirectory(): NamedWorkspace {
  return { name: '', path: '' }
}

export function namedWorkingDirectoriesFromRaw(raw: unknown): NamedWorkspace[] {
  const entries = toNamedWorkingDirectories(raw)
  return entries.length ? entries : [emptyWorkingDirectory()]
}

export function WorkingDirectoriesEditor({
  value,
  onChange,
  label,
  hint,
  required = false,
  seedEmptyHint = false,
  onCommit,
}: WorkingDirectoriesEditorProps) {
  const rows = value.length ? value : [emptyWorkingDirectory()]
  const latest = useRef(rows)
  latest.current = rows

  const updateAt = (index: number, patch: Partial<NamedWorkspace>, commit = false) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
    latest.current = next
    onChange(next)
    if (commit) onCommit?.(next)
  }

  const commitRows = (next: NamedWorkspace[]) => {
    onChange(next)
    onCommit?.(next)
  }

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= rows.length) return
    const next = [...rows]
    ;[next[index], next[target]] = [next[target], next[index]]
    commitRows(next)
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label ?? t(required ? 'projects.form.workingDirs' : 'projects.types.workingDirs')}</Label>
      <p className="text-[11px] text-muted-foreground leading-snug">
        {hint ?? t(required ? 'projects.form.workingDirsHint' : 'projects.types.workingDirsHint')}
      </p>
      {seedEmptyHint && rows.every((row) => !row.path.trim()) && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          {t('projects.form.workingDirsSeedHint')}
        </p>
      )}
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <div className="flex flex-col pt-1">
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30"
                disabled={i === 0}
                onClick={() => move(i, -1)}
                title={t('projects.form.workingDirsMoveUp')}
              >
                ▲
              </button>
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30"
                disabled={i === rows.length - 1}
                onClick={() => move(i, 1)}
                title={t('projects.form.workingDirsMoveDown')}
              >
                ▼
              </button>
            </div>
            <div className="flex-1 min-w-0 grid grid-cols-[minmax(0,7rem)_1fr] gap-1.5">
              <Input
                value={row.name}
                onChange={(e) => updateAt(i, { name: e.target.value })}
                onBlur={() => onCommit?.(latest.current)}
                placeholder={t('projects.form.workingDirsNamePh')}
                className="h-8 text-xs"
              />
              <Input
                value={row.path}
                onChange={(e) => updateAt(i, { path: e.target.value })}
                onBlur={() => onCommit?.(latest.current)}
                placeholder={t('projects.form.workingDirsPh')}
                className="h-8 text-xs font-mono"
              />
            </div>
            <DirectoryBrowseButton
              startPath={row.path}
              onPick={(picked) => {
                updateAt(i, {
                  path: picked,
                  name: row.name.trim() || basenameOf(picked),
                }, true)
              }}
            />
            {i === 0 && row.path.trim() && (
              <Badge variant="outline" className="text-[10px] shrink-0 mt-1">
                {t('projects.form.workingDirsPrimary')}
              </Badge>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 mt-0.5"
              onClick={() => commitRows(rows.filter((_, idx) => idx !== i))}
              title={t('projects.form.workingDirsRemove')}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <DirectoryBrowseButton
            startPath={rows.map((row) => row.path.trim()).filter(Boolean).at(-1)}
            onPick={(picked) => {
              const cleaned = rows.filter((row) => row.path.trim() || row.name.trim())
              commitRows([...cleaned, { name: basenameOf(picked), path: picked }])
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onChange([...rows, emptyWorkingDirectory()])}
          >
            {t('projects.form.workingDirsAdd')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function payloadWorkingDirectories(value: NamedWorkspace[]): Array<string | NamedWorkspace> {
  return value
    .map((row) => ({ name: row.name.trim(), path: row.path.trim() }))
    .filter((row) => row.path)
    .map((row) => (row.name && row.name !== basenameOf(row.path) ? row : row.path))
}
