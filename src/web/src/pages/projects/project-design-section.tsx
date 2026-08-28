// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The designs attached to a project.
//
// Toggled directly against the link routes rather than batched into the form's
// save, because they are a many-to-many link table and not a column. That also
// means the section only does anything for a project that already exists:
// there is nothing to link to before the project has an id.

import { useCallback, useEffect, useState } from 'react'
import { Check, Shapes } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { t } from './i18n'

interface DesignRow { id: string; title: string; currentVersion: number }

export function ProjectDesignSection({
  projectId,
}: {
  /** Null while the project is being created — links need an id to point at. */
  projectId: string | null
}) {
  const [designs, setDesigns] = useState<DesignRow[]>([])
  const [attached, setAttached] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const loadLinks = useCallback(async () => {
    if (!projectId) return setAttached([])
    const res = await api
      .get<{ designs: DesignRow[] }>(`/designs?ownerModule=projects&ownerId=${encodeURIComponent(projectId)}`)
      .catch(() => ({ designs: [] }))
    setAttached((res.designs ?? []).map((d) => d.id))
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    void api.get<{ designs: DesignRow[] }>('/designs')
      .catch(() => ({ designs: [] }))
      .then((d) => { if (!cancelled) setDesigns(d.designs ?? []) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { void loadLinks() }, [loadLinks])

  const toggle = async (id: string) => {
    if (!projectId) return
    setBusy(true)
    try {
      if (attached.includes(id)) {
        await api.delete(`/designs/${id}/links/projects/${encodeURIComponent(projectId)}`)
      } else {
        await api.post(`/designs/${id}/links`, { ownerModule: 'projects', ownerId: projectId })
      }
      await loadLinks()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs flex items-center gap-1.5">
          <Shapes className="h-3 w-3 opacity-70" />
          {t('projects.form.designs')}
        </Label>
        {!projectId ? (
          <p className="text-[11px] text-muted-foreground">{t('projects.form.designsAfterSave')}</p>
        ) : designs.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">{t('projects.form.designsEmpty')}</p>
        ) : (
          <div className="max-h-40 overflow-y-auto rounded-md border border-border/50">
            {designs.map((d) => {
              const on = attached.includes(d.id)
              return (
                <button
                  key={d.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void toggle(d.id)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/30 ${on ? 'bg-primary/5' : ''}`}
                >
                  <Check className={`h-3.5 w-3.5 shrink-0 ${on ? '' : 'opacity-0'}`} />
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  <span className="text-[10px] text-muted-foreground">v{d.currentVersion}</span>
                </button>
              )
            })}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">{t('projects.form.designsHint')}</p>
      </div>
    </div>
  )
}
