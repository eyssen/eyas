// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Fallback when @saker/* is not bun-linked on this machine. Knowledge pages
// still edit HTML; the real editor is used when the packages resolve.

import { forwardRef, useImperativeHandle, useRef, type RefObject } from 'react'

export interface EditorInstance {
  getRoot(): HTMLElement | null
  executeCommand(_cmd: string): void
}

export type SakerPlugin = unknown
export type EditorConfig = unknown

export interface SakerEditorHandle {
  getEditor(): EditorInstance | null
}

export interface SakerEditorProps {
  content?: string
  onChange?: (html: string) => void
  onSave?: (html: string) => void
  readonly?: boolean
  plugins?: SakerPlugin[]
  className?: string
  placeholder?: string
}

export const SakerEditor = forwardRef<SakerEditorHandle, SakerEditorProps>(
  function SakerEditor({ content = '', onChange, readonly, className }, ref) {
    const divRef = useRef<HTMLDivElement>(null)
    useImperativeHandle(ref, () => ({
      getEditor: () => ({
        getRoot: () => divRef.current,
        executeCommand: () => {},
      }),
    }))
    return (
      <div
        ref={divRef}
        className={className}
        contentEditable={!readonly}
        suppressContentEditableWarning
        dangerouslySetInnerHTML={{ __html: content }}
        onInput={(e) => onChange?.(e.currentTarget.innerHTML)}
      />
    )
  },
)

export function SakerViewer({ content, className }: { content: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: content }} />
}

export function useEditor(): {
  editor: EditorInstance | null
  ref: RefObject<HTMLDivElement | null>
  isReady: boolean
} {
  const ref = useRef<HTMLDivElement>(null)
  return { editor: null, ref, isReady: false }
}

export default SakerEditor
