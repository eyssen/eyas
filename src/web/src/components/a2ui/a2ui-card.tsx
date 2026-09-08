// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import type { A2UICard as A2UICardType } from '../../../../shared/a2ui-types'

interface A2UICardProps {
  content: A2UICardType
  onAction: (action: string, params: Record<string, unknown>) => void
}

export function A2UICard({ content, onAction }: A2UICardProps) {
  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle className="text-sm">{content.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{content.body}</p>
      </CardContent>
      {(content.footer || (content.actions && content.actions.length > 0)) && (
        <CardFooter className="flex items-center justify-between gap-2">
          {content.footer && (
            <span className="text-xs text-muted-foreground">{content.footer}</span>
          )}
          {content.actions && content.actions.length > 0 && (
            <div className="flex gap-2 ml-auto">
              {content.actions.map((action, i) => (
                <Button
                  key={i}
                  variant="outline"
                  size="sm"
                  onClick={() => onAction(action.action, action.params)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </CardFooter>
      )}
    </Card>
  )
}
