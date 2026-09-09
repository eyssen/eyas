// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The preview sheet: the first 64 KiB of one candidate, so the owner can look
// at a file before deciding it. Secrets come back verbatim (P-11 — D-7 is a
// rule about what a MODEL may recall, not about the owner reading their own
// file), which is exactly why the sheet says out loud when a row's content is
// used verbatim in prompts (A-28).
//
// It is a Sheet at every breakpoint rather than a centred dialog: a panel that
// covered the list it was opened from would lose its point.

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { AlertTriangle, Copy, Loader2 } from 'lucide-react'
import { t, tOr } from './i18n'
import { kindLabel, reasonLabel, tagLabel, warningLabel } from './data-port-reason-label'
import { formatBytes } from './data-port-progress'
import {
  ruleTargetOptions,
  type CandidatePreview,
  type CandidateTarget,
  type PublicCandidate,
} from './data-port-types'

/**
 * What the preview route actually answers. The shared type declares the fields
 * every caller needs; the server also reports the head's own byte length, the
 * file's size, the encodings that have no head at all, and a read error.
 */
export type PreviewPayload = Omit<CandidatePreview, 'head' | 'encoding'> & {
  head?: string | null
  encoding?: 'utf-8' | 'binary' | 'directory' | 'unreadable' | 'none' | 'not-downloaded' | string
  bytes?: number
  size?: number
  error?: string
}

/**
 * A-28 — a persona or a workspace rule file IS the prompt. Nothing gated at
 * recall protects it, so the wizard says so here, where the owner is looking at
 * the file, rather than leaving it to be discovered afterwards. Task 16 adds
 * the key in all six languages; until then `tOr`'s English is the real sentence.
 */
/**
 * A-79: the panel's line for a row whose bytes are not on this machine. Task 16
 * owns the six translations; until they land `tOr`'s English is the real
 * sentence, so a bare key never reaches the owner.
 */
export const NOT_DOWNLOADED_KEY = 'settings.dataPort.wizard.preview.notDownloaded'
export const NOT_DOWNLOADED_EN =
  'The bytes of this file are not on this machine, so there is nothing to preview. Previewing never downloads it — tick the row and import to fetch it.'

export const PROMPT_VERBATIM_KEY = 'settings.dataPort.wizard.promptVerbatimSecrets'
export const PROMPT_VERBATIM_EN =
  'A persona or rule file is used verbatim in the assistant’s prompts, so a credential inside it reaches the model on every turn — recall filtering does not apply. Review these rows before importing.'

/** A timestamp EYAS could not parse is worth showing raw, not as "Invalid Date". */
function formatStamp(value: string, lang: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString(lang === 'tlh' ? 'en' : lang)
}

/** The kinds whose content becomes prompt text rather than a recallable memory. */
export const isPromptKind = (kind: string): boolean => kind === 'persona' || kind === 'rule'

export interface PreviewSheetProps {
  open: boolean
  candidate: PublicCandidate | null
  preview: PreviewPayload | null
  loading?: boolean
  error?: string | null
  /** Resolved from the wire by the list, so the sheet mirrors the row exactly. */
  selected: boolean
  target: CandidateTarget
  lang: string
  onToggle: (selected: boolean) => void
  onSetTarget: (target: CandidateTarget) => void
  onOpenChange: (open: boolean) => void
}

export function PreviewSheet({
  open,
  candidate,
  preview,
  loading,
  error,
  selected,
  target,
  lang,
  onToggle,
  onSetTarget,
  onOpenChange,
}: PreviewSheetProps) {
  if (!candidate) return null
  const tags = candidate.tags ?? []
  const secrets = tags.includes('contains-secrets')
  const head = preview?.head ?? null
  const shownBytes = preview?.bytes ?? 0
  const totalBytes = preview?.size ?? candidate.bytes

  const copyPath = () => {
    void navigator.clipboard?.writeText?.(candidate.relativePath)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        closeLabel={t('settings.dataPort.wizard.preview.close')}
        className="gap-0 overflow-hidden"
      >
        <SheetHeader className="border-b border-border/50">
          <SheetTitle className="text-sm">{candidate.title}</SheetTitle>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label={`${t('settings.dataPort.wizard.preview.title')}: ${candidate.title}`}
              checked={selected}
              disabled={!candidate.importable}
              className="accent-[hsl(var(--primary))]"
              onChange={(e) => onToggle(e.target.checked)}
            />
            {candidate.kind === 'rule' && candidate.importable ? (
              <select
                aria-label={`${t('settings.dataPort.wizard.targetLabel')}: ${candidate.title}`}
                className="rounded border border-border-primary bg-transparent px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
                value={target}
                onChange={(e) => onSetTarget(e.target.value as CandidateTarget)}
              >
                {ruleTargetOptions(candidate.target).map((tgt) => (
                  <option key={tgt} value={tgt}>
                    {t(`settings.dataPort.wizard.target.${tgt}`)}
                  </option>
                ))}
              </select>
            ) : (
              <Badge variant="secondary" className="text-[10px]">
                {t(`settings.dataPort.wizard.target.${target}`)}
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px]">
              {kindLabel(candidate.kind)}
            </Badge>
            <span className="text-[10px] text-muted-foreground">{formatBytes(candidate.bytes, lang)}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
              {candidate.relativePath}
            </code>
            <Button size="sm" variant="ghost" className="h-6 px-1.5" onClick={copyPath}>
              <Copy className="mr-1 h-3 w-3" aria-hidden="true" />
              <span className="text-[10px]">{t('settings.dataPort.wizard.preview.copyPath')}</span>
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground">{reasonLabel(candidate.reasonCode, candidate.reason)}</p>

          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant="outline"
                className={tag === 'contains-secrets' ? 'bg-destructive/10 text-destructive text-[10px]' : 'text-[10px]'}
                {...(tag === 'contains-secrets' ? { title: t('settings.dataPort.wizard.containsSecretsHint') } : {})}
              >
                {tagLabel(tag)}
              </Badge>
            ))}
            {(candidate.warnings ?? []).map((w) => (
              <Badge key={w} variant="outline" className="text-[10px]">
                {warningLabel(w)}
              </Badge>
            ))}
            {candidate.mtime && (
              <span className="text-[10px] text-muted-foreground">{formatStamp(candidate.mtime, lang)}</span>
            )}
          </div>

          {isPromptKind(candidate.kind) && (
            <p
              className={`flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] ${
                secrets ? 'bg-destructive/10 text-destructive' : 'bg-accent/40 text-muted-foreground'
              }`}
            >
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              {tOr(PROMPT_VERBATIM_KEY, PROMPT_VERBATIM_EN)}
            </p>
          )}

          {candidate.paths && candidate.paths.length > 1 && (
            <div className="text-[10px] text-muted-foreground">
              <p className="font-medium">{t('settings.dataPort.wizard.preview.paths')}</p>
              <ul className="font-mono">
                {candidate.paths.map((p) => (
                  <li key={p} className="truncate">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto p-4 text-[11px]">
          {loading && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              {t('settings.dataPort.wizard.tree.placeholder')}
            </p>
          )}
          {error && <p className="text-destructive">{error}</p>}

          {!loading && !error && (
            <>
              {head && (
                <pre className="whitespace-pre-wrap break-words rounded-md bg-accent/30 p-2 font-mono">{head}</pre>
              )}
              {preview?.truncated && (
                <p className="mt-1 text-muted-foreground">
                  {t('settings.dataPort.wizard.preview.truncated', {
                    shown: formatBytes(shownBytes, lang),
                    total: formatBytes(totalBytes, lang),
                  })}
                </p>
              )}
              {preview?.encoding === 'not-downloaded' && (
                <p className="text-muted-foreground">{tOr(NOT_DOWNLOADED_KEY, NOT_DOWNLOADED_EN)}</p>
              )}
              {preview?.encoding === 'binary' && (
                <p className="text-muted-foreground">{t('settings.dataPort.wizard.preview.binary')}</p>
              )}
              {preview?.encoding === 'unreadable' && preview.error && (
                <p className="text-destructive">{preview.error}</p>
              )}
              {preview?.children && preview.children.length > 0 && (
                <div className="mt-2">
                  <p className="font-medium">{t('settings.dataPort.wizard.preview.children')}</p>
                  <ul className="font-mono text-muted-foreground">
                    {preview.children.map((child) => (
                      <li key={child} className="truncate">
                        {child}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {candidate.assets && candidate.assets.length > 0 && (
                <div className="mt-2">
                  <p className="font-medium">{t('settings.dataPort.wizard.preview.assets')}</p>
                  <ul className="text-muted-foreground">
                    {candidate.assets.map((a) => (
                      <li key={a.relPath} className="truncate font-mono">
                        {a.relPath} — {formatBytes(a.bytes, lang)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
