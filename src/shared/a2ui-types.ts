// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * A2UI (Agent-to-User Interface) type definitions.
 * Structured UI messages that agents can send instead of plain text.
 */

export interface A2UIMessage {
  type: 'text' | 'buttons' | 'table' | 'form' | 'chart' | 'progress' | 'card'
  content: unknown
  fallback_text: string
}

export interface A2UIButtons {
  prompt: string
  buttons: Array<{
    label: string
    action: string
    params: Record<string, unknown>
    variant?: 'default' | 'destructive' | 'outline'
  }>
}

export interface A2UITable {
  columns: Array<{ key: string; label: string; sortable?: boolean }>
  rows: Record<string, unknown>[]
  title?: string
}

export interface A2UIForm {
  title: string
  fields: Array<{
    name: string
    type: 'text' | 'number' | 'select' | 'date' | 'checkbox' | 'textarea'
    label: string
    placeholder?: string
    options?: Array<{ label: string; value: string }>
    required?: boolean
    defaultValue?: unknown
  }>
  submitAction: string
  submitLabel?: string
}

export interface A2UIChart {
  type: 'line' | 'bar' | 'pie'
  title?: string
  data: Array<Record<string, unknown>>
  xKey: string
  yKeys: Array<{ key: string; color?: string; label?: string }>
}

export interface A2UIProgress {
  value: number // 0-100
  label: string
  status?: 'running' | 'completed' | 'failed'
}

export interface A2UICard {
  title: string
  body: string
  footer?: string
  actions?: Array<{
    label: string
    action: string
    params: Record<string, unknown>
  }>
}

/**
 * Check if a parsed object looks like an A2UIMessage.
 */
export function isA2UIMessage(obj: unknown): obj is A2UIMessage {
  if (!obj || typeof obj !== 'object') return false
  const msg = obj as Record<string, unknown>
  return (
    typeof msg.type === 'string' &&
    ['text', 'buttons', 'table', 'form', 'chart', 'progress', 'card'].includes(msg.type) &&
    typeof msg.fallback_text === 'string'
  )
}
