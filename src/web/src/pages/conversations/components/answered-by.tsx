// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// "Provider · model" under a reply — who answered it. The tooltip adds which
// rule picked that model (the turn's binding) and any fallback. Nothing when
// the reply names no provider (a client-side error bubble).

import { useProviderDisplay } from '@/lib/provider-display'
import { answeredByCaption, type TurnBindingView } from '../model-picker'

export function AnsweredBy({ provider, model, binding }: {
  provider: string | null | undefined
  model: string | null | undefined
  binding?: TurnBindingView | null
}) {
  // Re-render once the provider catalog has loaded: the caption names the provider.
  useProviderDisplay()
  const caption = answeredByCaption(provider, model, binding)
  if (!caption) return null
  return (
    <div className="mt-1.5 text-[10px] font-mono text-muted-foreground truncate" title={caption.title} data-testid="answered-by">
      {caption.text}
    </div>
  )
}
