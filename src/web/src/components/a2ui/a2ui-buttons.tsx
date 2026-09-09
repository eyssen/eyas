// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Button } from '@/components/ui/button'
import type { A2UIButtons as A2UIButtonsType } from '../../../../shared/a2ui-types'

interface A2UIButtonsProps {
  content: A2UIButtonsType
  onAction: (action: string, params: Record<string, unknown>) => void
}

export function A2UIButtons({ content, onAction }: A2UIButtonsProps) {
  return (
    <div className="space-y-2">
      {content.prompt && (
        <p className="text-sm text-foreground">{content.prompt}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {content.buttons.map((btn, i) => (
          <Button
            key={i}
            variant={btn.variant ?? 'default'}
            size="sm"
            onClick={() => onAction(btn.action, btn.params)}
          >
            {btn.label}
          </Button>
        ))}
      </div>
    </div>
  )
}
