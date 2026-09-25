import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { t } from './i18n'

interface TagEntry { tag: string; count: number }
interface NoteByTag { path: string; title: string; tier: string }

export default function MemoryTagsView({
  onOpenNote,
  preselected,
}: {
  onOpenNote?: (path: string) => void
  preselected?: string | null
}) {
  const [tags, setTags] = useState<TagEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [notes, setNotes] = useState<NoteByTag[]>([])
  const [loading, setLoading] = useState(true)

  const loadNotes = async (tag: string) => {
    setSelected(tag)
    try {
      const res = await api.get<{ tag: string; notes: NoteByTag[] }>(`/memory/tags/${encodeURIComponent(tag)}`)
      setNotes(res.notes ?? [])
    } catch (err) {
      console.error('Failed to load notes for tag:', err)
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ tags: TagEntry[] }>('/memory/tags')
        setTags(res.tags ?? [])
      } catch (err) {
        console.error('Failed to load tags:', err)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    if (preselected && preselected !== selected) {
      loadNotes(preselected)
    }
  }, [preselected]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <p className="text-sm text-muted-foreground">{t('memory.tags.loading')}</p>

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="col-span-1 bg-card border border-border rounded-lg p-4 max-h-[500px] overflow-y-auto">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">{t('memory.tags.list')}</div>
        {tags.length === 0 && <p className="text-xs text-muted-foreground italic">{t('memory.tags.empty')}</p>}
        {tags.map(t => (
          <button
            key={t.tag}
            type="button"
            onClick={() => loadNotes(t.tag)}
            className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors flex items-center justify-between ${
              selected === t.tag
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            }`}
          >
            <span className="truncate">{t.tag}</span>
            <span className="text-[10px] opacity-60 ml-2">{t.count}</span>
          </button>
        ))}
      </div>
      <div className="col-span-2 bg-card border border-border rounded-lg p-4 max-h-[500px] overflow-y-auto">
        {!selected ? (
          <p className="text-xs text-muted-foreground italic">{t('memory.tags.selectTag')}</p>
        ) : (
          <>
            <div className="text-sm font-medium mb-3">
              {t('memory.tags.notesTagged')} <span className="bg-accent px-2 py-0.5 rounded text-xs">{selected}</span>
            </div>
            {notes.length === 0 && <p className="text-xs text-muted-foreground italic">{t('memory.tags.noNotes')}</p>}
            <div className="space-y-1">
              {notes.map(n => (
                <button
                  key={n.path}
                  type="button"
                  onClick={() => onOpenNote?.(n.path)}
                  className="w-full text-left p-2 rounded hover:bg-accent/50 transition-colors"
                >
                  <div className="text-xs font-medium">{n.title}</div>
                  <div className="text-[10px] text-muted-foreground font-mono">{n.path}</div>
                  <div className="text-[10px] text-muted-foreground">{n.tier}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
