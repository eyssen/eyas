// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// THE effort select (E5), shared by the conversation fields, the agent
// editor, the routing-tier rows and the scheduler: it lists only the rungs
// the target model accepts (the effort-options endpoints), Auto first with
// what Auto means there, and keeps a stored rung the model does not offer
// visible as "level → effective" instead of rewriting it.
//
// 'inline' fits the conversation field bar (hints in the tooltip); 'form'
// renders the hints under the select.

import { useId } from 'react'
import { t } from '@/i18n'
import {
  effortFromSelect,
  effortHints,
  effortSelectEntries,
  EFFORT_AUTO,
  type EffortIntent,
  type EffortLevel,
  type EffortOptions,
} from '@/lib/effort-options'

export interface EffortSelectProps {
  /** The stored rung (null = Auto). */
  value: EffortLevel | null
  /** The target's options; null while they load (only Auto and the stored rung are listed). */
  options: EffortOptions | null
  /** What Auto resolves to here (a conversation: Deep, its colleague, its delegating conversation). */
  inherited?: EffortIntent | null
  onChange: (value: EffortLevel | null) => void
  disabled?: boolean
  variant?: 'inline' | 'form'
  /**
   * What this effort is for, shown first in place of the generic hint (the
   * tier rows' "default for this tier", the conversation's "Auto inherits …").
   */
  hint?: string
  className?: string
  'aria-label'?: string
}

const INLINE_CLASS = 'h-7 px-2 bg-accent/30 border border-border/50 rounded-md focus:outline-none focus:ring-1 focus:ring-ring text-xs disabled:opacity-50 disabled:cursor-not-allowed'
const FORM_CLASS = 'w-full h-8 rounded-md border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed'

export function EffortSelect({
  value,
  options,
  inherited = null,
  onChange,
  disabled,
  variant = 'inline',
  hint,
  className,
  'aria-label': ariaLabel,
}: EffortSelectProps) {
  const hintId = useId()
  const entries = effortSelectEntries(value, options, inherited)
  const hints = [...(hint ? [hint] : []), ...effortHints(options)]
  const title = [hint ?? t('common.effort.hint'), ...effortHints(options)].join('\n')

  const select = (
    <select
      value={value ?? EFFORT_AUTO}
      onChange={(e) => onChange(effortFromSelect(e.target.value))}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel ?? t('common.effort.label')}
      aria-describedby={variant === 'form' && hints.length > 0 ? hintId : undefined}
      className={`${variant === 'form' ? FORM_CLASS : INLINE_CLASS}${className ? ` ${className}` : ''}`}
      data-testid="effort-select"
    >
      {entries.map((entry) => (
        <option key={entry.value} value={entry.value}>{entry.label}</option>
      ))}
    </select>
  )

  if (variant === 'inline') return select
  return (
    <div className="space-y-1">
      {select}
      {hints.length > 0 && (
        <div id={hintId} className="space-y-0.5">
          {hints.map((line) => (
            <p key={line} className="text-[11px] text-muted-foreground">{line}</p>
          ))}
        </div>
      )}
    </div>
  )
}
