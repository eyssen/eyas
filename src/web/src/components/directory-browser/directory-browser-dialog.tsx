// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useCallback, useEffect, useState } from 'react'
import { Folder, Home, ChevronUp } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { t } from './i18n'

interface BrowseEntry {
  name: string
  path: string
}

interface BrowseListing {
  path: string
  parent: string | null
  home: string
  entries: BrowseEntry[]
  truncated: boolean
}

interface DirectoryBrowserDialogProps {
  open: boolean
  initialPath?: string | null
  onClose: () => void
  onSelect: (path: string) => void
}

export function DirectoryBrowserDialog({
  open,
  initialPath,
  onClose,
  onSelect,
}: DirectoryBrowserDialogProps) {
  const [listing, setListing] = useState<BrowseListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (path?: string | null, allowHomeFallback = false) => {
    setLoading(true)
    setError(null)
    try {
      const qs = path?.trim() ? `?path=${encodeURIComponent(path.trim())}` : ''
      const data = await api.get<BrowseListing>(`/filesystem/browse${qs}`)
      setListing(data)
    } catch (err) {
      if (allowHomeFallback && path?.trim()) {
        try {
          const data = await api.get<BrowseListing>('/filesystem/browse')
          setListing(data)
          setError(null)
          return
        } catch {
          /* keep original error */
        }
      }
      setError(err instanceof Error ? err.message : t('dirBrowser.error'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void load(initialPath, true)
  }, [open, initialPath, load])

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('dirBrowser.title')}</DialogTitle>
          <DialogDescription>{t('dirBrowser.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={!listing?.parent || loading}
            onClick={() => listing?.parent && void load(listing.parent)}
          >
            <ChevronUp className="h-3.5 w-3.5 mr-1" />
            {t('dirBrowser.up')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={loading}
            onClick={() => void load(listing?.home)}
          >
            <Home className="h-3.5 w-3.5 mr-1" />
            {t('dirBrowser.home')}
          </Button>
        </div>

        <p className="text-[11px] font-mono text-muted-foreground break-all" title={listing?.path}>
          {listing?.path ?? '…'}
        </p>

        <div className="max-h-64 overflow-y-auto rounded-md border border-border/50 divide-y divide-border/30 min-h-[8rem]">
          {loading && (
            <p className="px-3 py-4 text-xs text-muted-foreground italic">{t('dirBrowser.loading')}</p>
          )}
          {error && !loading && (
            <p className="px-3 py-4 text-xs text-destructive">{error}</p>
          )}
          {!loading && !error && listing && listing.entries.length === 0 && (
            <p className="px-3 py-4 text-xs text-muted-foreground italic">{t('dirBrowser.empty')}</p>
          )}
          {!loading && listing?.entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => void load(entry.path)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/40"
            >
              <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate font-mono">{entry.name}</span>
            </button>
          ))}
        </div>
        {listing?.truncated && (
          <p className="text-[10px] text-muted-foreground">{t('dirBrowser.truncated')}</p>
        )}

        <DialogFooter>
          <Button
            type="button"
            size="sm"
            disabled={!listing || loading}
            onClick={() => {
              if (!listing) return
              onSelect(listing.path)
              onClose()
            }}
          >
            {t('dirBrowser.select')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DirectoryBrowseButton({
  onPick,
  startPath,
  className,
}: {
  onPick: (path: string) => void
  startPath?: string | null
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={className ?? 'h-7 text-xs shrink-0'}
        onClick={() => setOpen(true)}
      >
        {t('dirBrowser.browse')}
      </Button>
      <DirectoryBrowserDialog
        open={open}
        initialPath={startPath}
        onClose={() => setOpen(false)}
        onSelect={onPick}
      />
    </>
  )
}
