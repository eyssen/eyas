// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The export menu.
//
// Print needs a headless browser, which a self-hosted install may not have.
// Rather than offering four items that answer 503, the menu asks the server
// once whether printing works and says why it does not — the remedy comes from
// the server, because only the server knows which of the several reasons it is.

import { useEffect, useState } from 'react'
import { Download, FileImage, FileText, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'
import { t } from './i18n'

interface PrintStatus {
  available: boolean
  reason?: string
  remediation?: string
}

type Paper = 'a4' | 'letter'

/**
 * Start a download without leaving the page. The responses carry
 * Content-Disposition: attachment, so the browser saves rather than navigates,
 * and the session cookie rides along exactly as it does for the HTML export.
 */
function download(url: string): void {
  window.location.href = url
}

export function ExportMenu({ designId, artboard }: { designId: string; artboard: string | null }) {
  const [status, setStatus] = useState<PrintStatus | null>(null)
  const [paper, setPaper] = useState<Paper>('a4')

  useEffect(() => {
    let cancelled = false
    api
      .get<PrintStatus>('/designs/print-status')
      .then((s) => { if (!cancelled) setStatus(s) })
      .catch(() => { if (!cancelled) setStatus({ available: false }) })
    return () => { cancelled = true }
  }, [])

  const canPrint = status?.available === true
  const file = artboard ? `?file=${encodeURIComponent(artboard)}` : ''
  const base = `/api/v1/designs/${designId}`

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost">
          <Download className="h-3.5 w-3.5 mr-1" />
          {t('design.detail.export')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{t('design.export.fileHeading')}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => download(`${base}/export?format=html`)}>
          <FileText className="h-3.5 w-3.5 mr-2" />
          {t('design.export.html')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => download(`${base}/export?format=document`)}>
          <FileText className="h-3.5 w-3.5 mr-2" />
          {t('design.export.document')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('design.export.printHeading')}</DropdownMenuLabel>

        {!canPrint && (
          <div className="px-2 py-1.5 text-xs text-[hsl(var(--muted-foreground))]">
            <div>{t('design.export.unavailable')}</div>
            {status?.remediation && <div className="mt-1 opacity-80">{status.remediation}</div>}
          </div>
        )}

        <DropdownMenuItem
          disabled={!canPrint || !artboard}
          onSelect={() => artboard && download(`${base}/export/png${file}`)}
        >
          <FileImage className="h-3.5 w-3.5 mr-2" />
          {t('design.export.png')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canPrint || !artboard}
          onSelect={() => artboard && download(`${base}/export/png${file}&scale=2`)}
        >
          <FileImage className="h-3.5 w-3.5 mr-2" />
          {t('design.export.png2x')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canPrint || !artboard}
          onSelect={() => artboard && download(`${base}/export/pdf${file}&paper=${paper}`)}
        >
          <FileText className="h-3.5 w-3.5 mr-2" />
          {t('design.export.pdfArtboard')}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canPrint}
          onSelect={() => download(`${base}/export/pdf?paper=${paper}`)}
        >
          <FileText className="h-3.5 w-3.5 mr-2" />
          {t('design.export.pdfCanvas')}
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('design.export.paper')}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setPaper('a4') }}>
          <Check className={`h-3.5 w-3.5 mr-2 ${paper === 'a4' ? '' : 'opacity-0'}`} />
          {t('design.export.paperA4')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setPaper('letter') }}>
          <Check className={`h-3.5 w-3.5 mr-2 ${paper === 'letter' ? '' : 'opacity-0'}`} />
          {t('design.export.paperLetter')}
        </DropdownMenuItem>
        <div className="px-2 pb-1.5 text-[11px] text-[hsl(var(--muted-foreground))]">
          {t('design.export.paperHint')}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
