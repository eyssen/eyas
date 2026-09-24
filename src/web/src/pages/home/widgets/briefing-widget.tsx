// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Lifted from dashboard-page.tsx:451-463 (morning briefing section): same
// GET /memory/briefing shape and rendering, useApi -> useWidgetData.
// refresh: { pollMs: 900_000 } — the reflection digest this reads is written
// nightly by the memory module's consolidator job, not pushed over a WS
// topic, so a slow poll is enough and no topic exists to subscribe to.
//
// No outer WidgetFrame here — see attention-widget.tsx for why (home-page.tsx
// already wraps every tile's Component in one).
import { useWidgetData } from '../use-widget-data'
import { t } from '../i18n'

interface BriefingResponse {
  briefing: string | null
}

const REFRESH = { pollMs: 900_000 }

export function BriefingWidget({
  config: _config,
  onConfigChange: _onConfigChange,
}: {
  config: unknown
  onConfigChange: (next: unknown) => void
}) {
  const { data, error, isLoading, tileRef } = useWidgetData<BriefingResponse>('/memory/briefing', REFRESH)

  // See the idiom note in pulse-widget.tsx: "no briefing yet" and "the
  // briefing endpoint is down" are different facts and must not share a state.
  const hasError = !!error && !data
  const isEmpty = !isLoading && !data?.briefing

  return (
    <div ref={tileRef}>
      {isLoading ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.loading')}</p>
      ) : hasError ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.error')}</p>
      ) : isEmpty ? (
        <p className="text-xs text-muted-foreground py-2">{t('home.widget.briefing.empty')}</p>
      ) : (
        // `break-words` because `whitespace-pre-wrap` alone still refuses to
        // split an unbroken run — one long URL or path in a briefing pushed the
        // text out sideways. The old `max-h-48 overflow-y-auto` is gone: a
        // fixed 192px cap inside a resizable tile scrolled the text in a
        // letterbox while the tile itself had room to spare. WidgetFrame's
        // content region now scrolls, so the briefing simply fills the tile.
        <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-sans m-0 leading-relaxed">
          {data?.briefing}
        </pre>
      )}
    </div>
  )
}
