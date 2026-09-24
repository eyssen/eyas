// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Saker editor toolbar for EYAS knowledge module

import type { SakerEditorHandle } from '@saker/react'
import type { RefObject } from 'react'
import { t } from './i18n'

interface ToolbarProps {
  editorRef: RefObject<SakerEditorHandle | null>
}

// `titleKey` is an i18n key resolved with t() at render time so tooltips follow
// the active language.
const BUTTONS = [
  { label: 'B', cmd: 'formatBold', titleKey: 'knowledge.toolbar.bold', style: 'font-weight:700' },
  { label: 'I', cmd: 'formatItalic', titleKey: 'knowledge.toolbar.italic', style: 'font-style:italic' },
  { label: 'U', cmd: 'formatUnderline', titleKey: 'knowledge.toolbar.underline', style: 'text-decoration:underline' },
  { label: 'S', cmd: 'formatStrikethrough', titleKey: 'knowledge.toolbar.strikethrough', style: 'text-decoration:line-through' },
  { label: '<>', cmd: 'formatCode', titleKey: 'knowledge.toolbar.code' },
  'sep',
  { label: 'H1', cmd: 'heading1', titleKey: 'knowledge.toolbar.h1' },
  { label: 'H2', cmd: 'heading2', titleKey: 'knowledge.toolbar.h2' },
  { label: 'H3', cmd: 'heading3', titleKey: 'knowledge.toolbar.h3' },
  { label: 'P', cmd: 'paragraph', titleKey: 'knowledge.toolbar.paragraph' },
  'sep',
  { label: '•', cmd: 'insertBulletList', titleKey: 'knowledge.toolbar.bulletList' },
  { label: '1.', cmd: 'insertNumberedList', titleKey: 'knowledge.toolbar.numberedList' },
  { label: '☑', cmd: 'insertChecklist', titleKey: 'knowledge.toolbar.checklist' },
  'sep',
  { label: '⊞', cmd: 'insertTable', titleKey: 'knowledge.toolbar.table' },
  { label: 'Code', cmd: 'insertCodeBlock', titleKey: 'knowledge.toolbar.codeBlock' },
  { label: 'Callout', cmd: 'insertCallout', titleKey: 'knowledge.toolbar.callout' },
  { label: '🔗', cmd: 'insertLink', titleKey: 'knowledge.toolbar.link' },
  { label: '📷', cmd: 'insertImage', titleKey: 'knowledge.toolbar.image' },
  { label: '▶', cmd: 'insertToggle', titleKey: 'knowledge.toolbar.toggle' },
  { label: '—', cmd: 'insertDivider', titleKey: 'knowledge.toolbar.divider' },
  'sep',
  { label: 'Clear', cmd: 'clearFormatting', titleKey: 'knowledge.toolbar.clearFormatting' },
] as const

type ButtonItem = { label: string; cmd: string; titleKey: string; style?: string }

export function SakerToolbar({ editorRef }: ToolbarProps) {
  const handleClick = (cmd: string, e: React.MouseEvent) => {
    e.preventDefault()
    const editor = editorRef.current?.getEditor()
    if (editor) {
      editor.executeCommand(cmd)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-3 py-1 border-b border-border bg-muted/30">
      {BUTTONS.map((item, i) => {
        if (item === 'sep') {
          return <div key={i} className="w-px h-4 bg-border mx-1" />
        }
        const btn = item as ButtonItem
        const inlineStyle: React.CSSProperties = {}
        if (btn.style) {
          const [prop, val] = btn.style.split(':')
          if (prop && val) {
            const camelProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
            ;(inlineStyle as any)[camelProp] = val
          }
        }
        return (
          <button
            key={btn.cmd}
            type="button"
            title={t(btn.titleKey)}
            style={Object.keys(inlineStyle).length ? inlineStyle : undefined}
            onMouseDown={(e) => handleClick(btn.cmd, e)}
            className="px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors"
          >
            {btn.label}
          </button>
        )
      })}
    </div>
  )
}
