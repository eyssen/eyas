import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Sparkles, X } from 'lucide-react'
import { t } from './i18n'

const DISMISS_KEY = 'eyas-autonomy-nudge-dismissed'

/**
 * One-time post-setup nudge pointing the owner at the Autonomy & self-improvement
 * settings card (src/web/src/pages/settings/autonomy-features-card.tsx). The
 * loops it links to are opt-in and OFF by default — this only raises awareness
 * that they exist; dismissing it is purely local (no backend state).
 */
export default function AutonomyNudgeCard() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')

  if (dismissed) return null

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="glass-card p-4 relative mb-6">
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('dashboard.nudge.dismiss')}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-2 pr-6">
        <Sparkles className="h-4 w-4" /> {t('dashboard.nudge.title')}
      </h3>
      <p className="text-xs text-muted-foreground mb-3 pr-6">
        {t('dashboard.nudge.body')}
      </p>
      <Link to="/settings">
        <Button size="sm" variant="outline">{t('dashboard.nudge.cta')}</Button>
      </Link>
    </div>
  )
}
