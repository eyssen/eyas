// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type {
  A2UIMessage,
  A2UIButtons as A2UIButtonsType,
  A2UITable as A2UITableType,
  A2UIForm as A2UIFormType,
  A2UIChart as A2UIChartType,
  A2UIProgress as A2UIProgressType,
  A2UICard as A2UICardType,
} from '../../../../shared/a2ui-types'
import { A2UIButtons } from './a2ui-buttons'
import { A2UITable } from './a2ui-table'
import { A2UIForm } from './a2ui-form'
import { A2UIChart } from './a2ui-chart'
import { A2UIProgress } from './a2ui-progress'
import { A2UICard } from './a2ui-card'

interface A2UIRendererProps {
  message: A2UIMessage
  onAction: (action: string, params: Record<string, unknown>) => void
}

/**
 * Switch renderer for A2UI structured messages.
 * Dispatches to the appropriate widget based on message type.
 */
export function A2UIRenderer({ message, onAction }: A2UIRendererProps) {
  switch (message.type) {
    case 'buttons':
      return <A2UIButtons content={message.content as A2UIButtonsType} onAction={onAction} />
    case 'table':
      return <A2UITable content={message.content as A2UITableType} />
    case 'form':
      return (
        <A2UIForm
          content={message.content as A2UIFormType}
          onSubmit={(data) => onAction((message.content as A2UIFormType).submitAction, data)}
        />
      )
    case 'chart':
      return <A2UIChart content={message.content as A2UIChartType} />
    case 'progress':
      return <A2UIProgress content={message.content as A2UIProgressType} />
    case 'card':
      return <A2UICard content={message.content as A2UICardType} onAction={onAction} />
    default:
      return <p className="text-sm whitespace-pre-wrap">{message.fallback_text}</p>
  }
}
