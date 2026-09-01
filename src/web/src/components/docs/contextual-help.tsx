// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { ReactNode } from 'react'
import { HelpCircle, ExternalLink } from 'lucide-react'
import { resolveHelpUrl } from '@/lib/docs-help'
import { useLanguageStore } from '@/stores/language-store'
import { t } from '@/i18n'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface ContextualHelpProps {
  /** Stable id from packages/docs/help-map.json */
  helpId: string
  className?: string
  /** Icon size class (default h-4 w-4) */
  iconClassName?: string
  /** Open in new tab (default true — docs is a separate static site tree) */
  newTab?: boolean
}

/**
 * Compact "?" control that opens the product docs page for `helpId`
 * in the current UI language (falls back to English via the docs site).
 */
export function ContextualHelp({
  helpId,
  className,
  iconClassName,
  newTab = true,
}: ContextualHelpProps) {
  const lang = useLanguageStore((s) => s.lang)
  const url = resolveHelpUrl(helpId, lang)
  if (!url) return null

  const label = t('common.openDocs')

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <a
            href={url}
            target={newTab ? '_blank' : undefined}
            rel={newTab ? 'noopener noreferrer' : undefined}
            className={cn(
              'inline-flex items-center justify-center rounded-md text-muted-foreground',
              'hover:text-foreground hover:bg-accent/60 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'h-6 w-6 shrink-0',
              className,
            )}
            aria-label={label}
            onClick={(e) => e.stopPropagation()}
          >
            <HelpCircle className={cn('h-4 w-4', iconClassName)} aria-hidden />
          </a>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="flex items-center gap-1.5">
          <span>{label}</span>
          {newTab && <ExternalLink className="h-3 w-3 opacity-70" aria-hidden />}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export interface PageTitleProps {
  title: ReactNode
  subtitle?: ReactNode
  helpId?: string
  className?: string
  /** Extra content on the right (buttons, badges) */
  actions?: ReactNode
}

/**
 * Standard page heading with optional contextual docs link.
 */
export function PageTitle({ title, subtitle, helpId, className, actions }: PageTitleProps) {
  return (
    <div className={cn('flex items-start justify-between gap-3 mb-5', className)}>
      <div className="min-w-0">
        <h1 className="page-title inline-flex items-center gap-1.5 flex-wrap">
          <span>{title}</span>
          {helpId ? <ContextualHelp helpId={helpId} /> : null}
        </h1>
        {subtitle ? (
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
    </div>
  )
}
