// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import type { A2UIProgress as A2UIProgressType } from '../../../../shared/a2ui-types'

interface A2UIProgressProps {
  content: A2UIProgressType
}

export function A2UIProgress({ content }: A2UIProgressProps) {
  const statusIcon = {
    running: <Loader2 className="h-4 w-4 text-primary animate-spin" />,
    completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
    failed: <XCircle className="h-4 w-4 text-destructive" />,
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5">
          {content.status && statusIcon[content.status]}
          {content.label}
        </span>
        <span className="text-muted-foreground">{Math.round(content.value)}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            content.status === 'failed'
              ? 'bg-destructive'
              : content.status === 'completed'
                ? 'bg-green-500'
                : 'bg-primary'
          }`}
          style={{ width: `${Math.min(100, Math.max(0, content.value))}%` }}
        />
      </div>
    </div>
  )
}
