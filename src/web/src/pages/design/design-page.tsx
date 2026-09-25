import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { PageTitle } from '@/components/docs/contextual-help'
import { Plus, Upload, AlertTriangle, Loader2 } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import type { DesignRow } from './types'
import { t } from './i18n'

const KINDS = ['ui', 'landing', 'print', 'deck', 'wireframe', 'freeform']

export default function DesignPage() {
  const [designs, setDesigns] = useState<DesignRow[]>([])
  const [kind, setKind] = useState<string>('')
  const [title, setTitle] = useState('')
  const [importText, setImportText] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState<string[]>([])

  const load = useCallback(async () => {
    try {
      const q = kind ? `?kind=${encodeURIComponent(kind)}` : ''
      setDesigns((await api.get<{ designs: DesignRow[] }>(`/designs${q}`)).designs)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    }
  }, [kind])

  useEffect(() => { void load() }, [load])

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null); setNotes([])
    try { await fn() } catch (err) { setError(err instanceof ApiError ? err.message : String(err)) } finally { setBusy(false) }
  }

  const create = () => run(async () => {
    await api.post('/designs', { title: title.trim() || t('design.list.untitled') })
    setTitle('')
    await load()
  })

  const importCanvas = () => run(async () => {
    const res = await api.post<{ notes?: string[] }>('/designs/import', { page: importText })
    setNotes(res.notes ?? [])
    setImportText('')
    setShowImport(false)
    await load()
  })

  return (
    <div className="space-y-4">
      <PageTitle
        title={t('design.list.title')}
        subtitle={t('design.list.subtitle')}
        helpId="knowledge.design"
        actions={
          <div className="flex items-center gap-2">
            <Input
              value={title}
              placeholder={t('design.list.newPlaceholder')}
              className="w-56"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') create() }}
            />
            <Button size="sm" onClick={create} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              {t('design.list.create')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowImport((v) => !v)}>
              <Upload className="h-3.5 w-3.5 mr-1" />
              {t('design.list.import')}
            </Button>
          </div>
        }
      />

      {error && (
        <div className="flex items-start gap-2 text-sm text-[hsl(var(--destructive))]">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notes.length > 0 && (
        <ul className="text-xs text-muted-foreground list-disc pl-5">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}

      {showImport && (
        <div className="glass-card p-4 space-y-2">
          <div className="section-label">{t('design.list.importHeading')}</div>
          <p className="text-xs text-muted-foreground">{t('design.list.importHint')}</p>
          <textarea
            className="w-full rounded-md bg-transparent border border-[hsl(var(--border))] p-2 text-xs font-mono"
            rows={6}
            value={importText}
            placeholder={t('design.list.importPlaceholder')}
            onChange={(e) => setImportText(e.target.value)}
          />
          <Button size="sm" onClick={importCanvas} disabled={busy || !importText.trim()}>
            {t('design.list.importAction')}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={kind === '' ? 'default' : 'outline'} onClick={() => setKind('')}>
          {t('design.list.allKinds')}
        </Button>
        {KINDS.map((k) => (
          <Button key={k} size="sm" variant={kind === k ? 'default' : 'outline'} onClick={() => setKind(k)}>
            {t(`design.kind.${k}`)}
          </Button>
        ))}
      </div>

      {designs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('design.list.empty')}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {designs.map((d) => (
            <Link key={d.id} to="/design/$designId" params={{ designId: d.id }} className="glass-card p-4 hover:bg-accent/40 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{d.title}</div>
                  <div className="text-xs text-muted-foreground">{t(`design.kind.${d.kind}`)} · v{d.currentVersion}</div>
                </div>
              </div>
              {d.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {d.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
