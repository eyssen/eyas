// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The scan tester: paste a text and see what the SAVED policy does with it —
// each detection with its action, whether a new chat or channel message with
// this text would be refused, and the text exactly as a remote model would
// receive it. Detected values are never sent back by the server. Tester runs
// are not counted in the page's stats.

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, FileSearch, Info, ScanSearch, ShieldAlert, ShieldCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { t, typeLabel } from './i18n'
import { parseScan, type ScanView } from './policy-form'

interface Props {
  /** The editor has unsaved changes: the tester still uses the saved policy. */
  unsavedChanges: boolean
}

const ACTION_VARIANT = { block: 'destructive', mask: 'secondary', warn: 'outline' } as const

export function ScanTester({ unsavedChanges }: Props) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<ScanView | null>(null)
  const [scanning, setScanning] = useState(false)

  const scan = useCallback(async () => {
    if (!text.trim()) return
    setScanning(true)
    setResult(null)
    try {
      setResult(parseScan(await api.post<unknown>('/privacy/scan', { text })))
    } catch {
      toast.error(t('privacy.test.failed'))
    } finally {
      setScanning(false)
    }
  }, [text])

  return (
    <>
      <div className="glass-card p-4 mb-5">
        <div className="flex items-center gap-2 mb-1">
          <FileSearch className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('privacy.testScanner')}</span>
        </div>
        {unsavedChanges && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
            <Info className="h-3 w-3 shrink-0" />
            {t('privacy.test.savedPolicyHint')}
          </p>
        )}
        <textarea
          className="w-full bg-transparent border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring min-h-[100px] resize-y my-2"
          placeholder={t('privacy.scanPlaceholder')}
          aria-label={t('privacy.testScanner')}
          maxLength={100_000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex justify-end">
          <Button size="sm" onClick={scan} disabled={scanning || !text.trim()}>
            <ScanSearch className="h-3.5 w-3.5 mr-1" />
            {scanning ? t('privacy.scanning') : t('privacy.scanText')}
          </Button>
        </div>
      </div>

      {result && (
        <div className="glass-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t('privacy.scanResults')}</span>
          </div>

          {!result.enabled && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {t('privacy.test.disabled')}
            </p>
          )}

          {/* Verdict for a NEW message */}
          {result.inbound.refused ? (
            <p className="flex items-start gap-1.5 text-xs text-destructive" role="status">
              <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {t('privacy.test.refused', { types: result.inbound.types.map(typeLabel).join(', ') })}
            </p>
          ) : (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground" role="status">
              <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {t('privacy.test.allowed')}
            </p>
          )}

          {/* Detections */}
          {result.matches.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('privacy.noPii')}</p>
          ) : (
            <div>
              <div className="section-label mb-2">
                {t('privacy.matchesFound', { count: result.matches.length })}
              </div>
              <div className="space-y-1.5">
                {result.matches.map((m, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 p-2 rounded-md bg-accent/30">
                    <Badge variant="outline" className="text-[10px]">{typeLabel(m.type)}</Badge>
                    <span className="text-[10px] text-muted-foreground">{t('privacy.position', { start: m.start, end: m.end })}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{m.scanner}</span>
                    <span className="ml-auto flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground">{t('privacy.test.action')}</span>
                      <Badge variant={ACTION_VARIANT[m.action]} className="text-[10px]">
                        {t(`privacy.action.${m.action}`)}
                      </Badge>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* As sent to a remote model */}
          <div>
            <div className="section-label mb-1">{t('privacy.test.egressPreview')}</div>
            <pre className="text-[11px] text-muted-foreground bg-accent/30 rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-words">
              {result.egressPreview}
            </pre>
          </div>
        </div>
      )}
    </>
  )
}
