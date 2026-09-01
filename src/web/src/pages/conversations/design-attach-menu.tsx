// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Attaching a design canvas to this conversation.
//
// An icon rather than a field: the top bar is full, and this is an occasional
// act. The count on the badge is the only thing that has to be readable at a
// glance — everything else lives in the dropdown.
//
// Only the conversation's OWN links are listed, because those are the only ones
// there are: a project's designs are copied onto a conversation when it is
// created in the project, the same way indexedSources and workingDirectories
// are. From then on the conversation owns them and any one can be detached
// here — there is no ambient project list to reconcile against.

import { useCallback, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Shapes, Check, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { t } from './i18n'

interface DesignRow {
  id: string
  title: string
  kind: string
  currentVersion: number
}

export function DesignAttachMenu({ conversationId }: { conversationId: string }) {
  const [all, setAll] = useState<DesignRow[]>([])
  const [attached, setAttached] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [list, own] = await Promise.all([
      api.get<{ designs: DesignRow[] }>('/designs').catch(() => ({ designs: [] })),
      api.get<{ designs: DesignRow[] }>(`/designs?ownerModule=conversations&ownerId=${encodeURIComponent(conversationId)}`)
        .catch(() => ({ designs: [] })),
    ])
    setAll(list.designs ?? [])
    setAttached((own.designs ?? []).map((d) => d.id))
  }, [conversationId])

  useEffect(() => { void load() }, [load])

  const toggle = async (id: string) => {
    setBusy(true)
    try {
      if (attached.includes(id)) {
        await api.delete(`/designs/${id}/links/conversations/${encodeURIComponent(conversationId)}`)
      } else {
        await api.post(`/designs/${id}/links`, { ownerModule: 'conversations', ownerId: conversationId })
      }
      await load()
    } catch {
      // Nothing to say here that the next open will not show: the list reloads.
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('conversations.designs.label')}
          title={t('conversations.designs.label')}
          className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring outline-none"
        >
          <Shapes className="h-4 w-4" />
          {attached.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-medium text-primary-foreground">
              {attached.length}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t('conversations.designs.heading')}</DropdownMenuLabel>
        <div className="px-2 pb-1 text-[11px] text-muted-foreground">{t('conversations.designs.hint')}</div>
        <DropdownMenuSeparator />

        {all.length === 0 && (
          <div className="px-2 py-2 text-xs text-muted-foreground">{t('conversations.designs.empty')}</div>
        )}

        {all.map((d) => {
          const isAttached = attached.includes(d.id)
          return (
            <DropdownMenuItem
              key={d.id}
              disabled={busy}
              onSelect={(e) => { e.preventDefault(); void toggle(d.id) }}
              className="gap-2"
            >
              <Check className={`h-3.5 w-3.5 shrink-0 ${isAttached ? '' : 'opacity-0'}`} />
              <span className="min-w-0 flex-1 truncate">{d.title}</span>
              <span className="text-[10px] text-muted-foreground">v{d.currentVersion}</span>
            </DropdownMenuItem>
          )
        })}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/design" className="flex items-center gap-2">
            <ExternalLink className="h-3.5 w-3.5" />
            {t('conversations.designs.manage')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
