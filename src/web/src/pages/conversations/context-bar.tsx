import { resolveContextOccupancy } from './context-bar-occupancy'
import { t } from './i18n'

interface ContextBarProps {
  tokensUsed: number
  contextWindow: number
  /** Composed context size (`estimated_tokens` from the latest composition). */
  estimatedTokens?: number
  onClick?: () => void
}

export function ContextBar({ tokensUsed, contextWindow, estimatedTokens, onClick }: ContextBarProps) {
  const occupancy = resolveContextOccupancy(contextWindow, estimatedTokens)
  if (!occupancy) return null

  // `tokensUsed` (a cumulative conversation total) never drives the fill —
  // see context-bar-occupancy.ts. It only ever appears in the tooltip, and
  // only labelled as what it is.
  const title = occupancy.known
    ? t('conversations.contextBar.tooltipComposed', {
        estimated: (estimatedTokens as number).toLocaleString(),
        window: contextWindow.toLocaleString(),
        pct: occupancy.pct.toFixed(1),
        total: tokensUsed.toLocaleString(),
      })
    : t('conversations.contextBar.tooltipFallback', {
        used: tokensUsed.toLocaleString(),
        window: contextWindow.toLocaleString(),
      })

  return (
    <div
      className={`w-full h-1.5 bg-accent/30 rounded-t-xl overflow-hidden ${onClick ? 'cursor-pointer' : ''}`}
      title={title}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
    >
      {occupancy.known && (
        <div
          className={`h-full ${occupancy.color} transition-all duration-300`}
          style={{ width: `${occupancy.pct}%` }}
        />
      )}
    </div>
  )
}
