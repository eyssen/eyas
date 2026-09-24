// Part of eYssen. See LICENSE file for full copyright and licensing details.
// Saker editor wrapper with toolbar — replaces BlockNote

import { SakerEditor } from '@saker/react'
import type { SakerEditorHandle } from '@saker/react'
import { useRef, useCallback } from 'react'
import { SakerToolbar } from './saker-toolbar'
import { useDocumentsStore } from '@/stores/documents-store'
import '@saker/ui/styles/editor.css'

interface SakerEditorWrapperProps {
  initialContent: string
  onChange: (html: string) => void
  readOnly?: boolean
  pageId: string
  fullWidth?: boolean
}

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])

function isImageFile(file: File): boolean {
  return IMAGE_MIME_TYPES.has(file.type) || /\.(jpe?g|png|gif|webp|svg)$/i.test(file.name)
}

export function BlockNoteEditor({ initialContent, onChange, readOnly, pageId, fullWidth }: SakerEditorWrapperProps) {
  const editorRef = useRef<SakerEditorHandle>(null)
  const { uploadFile } = useDocumentsStore()

  const handleChange = useCallback((html: string) => {
    onChange(html)
  }, [onChange])

  /** Insert an uploaded image into the Saker editor root at cursor position */
  const insertUploadedImage = useCallback((src: string, alt: string, docId: string) => {
    const root = editorRef.current?.getEditor()?.getRoot()
    if (!root) return

    const figure = document.createElement('figure')
    figure.setAttribute('data-saker-block', 'image')
    figure.setAttribute('data-saker-props', JSON.stringify({ width: null, alignment: 'center' }))
    figure.setAttribute('contenteditable', 'false')
    figure.setAttribute('data-document-id', docId)

    const img = document.createElement('img')
    img.src = src
    img.alt = alt
    figure.appendChild(img)

    const caption = document.createElement('figcaption')
    caption.setAttribute('contenteditable', 'true')
    figure.appendChild(caption)

    // Find block at cursor or append
    const sel = document.getSelection()
    let targetBlock: Element | null = null
    if (sel && sel.rangeCount > 0) {
      let node: Node | null = sel.anchorNode
      if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement
      while (node instanceof Element && node.parentElement && node.parentElement !== root) {
        node = node.parentElement
      }
      if (node instanceof Element && node.parentElement === root) {
        targetBlock = node
      }
    }

    if (targetBlock) {
      targetBlock.insertAdjacentElement('afterend', figure)
    } else {
      root.appendChild(figure)
    }
  }, [])

  /** Upload image files and insert them into the editor */
  const handleImageFiles = useCallback(async (files: File[]) => {
    const images = files.filter(isImageFile)
    for (const file of images) {
      const doc = await uploadFile(file, 'knowledge', pageId, 'user')
      if (doc) {
        const src = `/api/v1/documents/${doc.id}/download`
        insertUploadedImage(src, file.name, doc.id)
      }
    }
  }, [uploadFile, pageId, insertUploadedImage])

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(e.dataTransfer.files)
    const imageFiles = files.filter(isImageFile)
    if (imageFiles.length === 0) return
    // Prevent the Saker image plugin from handling with data URLs
    e.stopPropagation()
    e.preventDefault()
    void handleImageFiles(imageFiles)
  }, [handleImageFiles])

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData.items)
    const imageFiles = items
      .filter(item => item.kind === 'file' && IMAGE_MIME_TYPES.has(item.type))
      .map(item => item.getAsFile())
      .filter((f): f is File => f !== null)
    if (imageFiles.length === 0) return
    // Prevent the Saker image plugin from handling with data URLs
    e.stopPropagation()
    e.preventDefault()
    void handleImageFiles(imageFiles)
  }, [handleImageFiles])

  return (
    <div
      className={`flex flex-col ${fullWidth ? 'eyas-editor-full-width' : ''}`}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      {!readOnly && <SakerToolbar editorRef={editorRef} />}
      <SakerEditor
        ref={editorRef}
        key={pageId}
        content={initialContent}
        onChange={handleChange}
        readonly={readOnly}
        className="min-h-[300px] p-4 outline-none"
      />
      <style>{`
        /* Saker editor typography — inherits colors from EYAS theme (light/dark) */
        .saker-editor {
          font-size: 15px; line-height: 1.7;
          color: inherit !important;
          background: transparent !important;
        }
        .saker-editor h1 { font-size: 2em !important; font-weight: 700 !important; margin: 0.8em 0 0.4em !important; line-height: 1.2; color: inherit; }
        .saker-editor h2 { font-size: 1.5em !important; font-weight: 600 !important; margin: 0.7em 0 0.3em !important; color: inherit; }
        .saker-editor h3 { font-size: 1.25em !important; font-weight: 600 !important; margin: 0.6em 0 0.3em !important; color: inherit; }
        .saker-editor p { margin: 0.4em 0 !important; color: inherit; }
        .saker-editor ul, .saker-editor ol { padding-left: 24px !important; margin: 0.4em 0 !important; list-style: revert !important; }
        .saker-editor li { margin: 0.2em 0 !important; color: inherit; }
        .saker-editor blockquote { border-left: 3px solid hsl(var(--border)); padding-left: 16px; margin: 0.5em 0; opacity: 0.8; }
        .saker-editor hr { border: none; border-top: 1px solid hsl(var(--border)); margin: 1.5em 0; }
        .saker-editor strong { font-weight: 700 !important; }
        .saker-editor em { font-style: italic !important; }
        .saker-editor code { background: hsl(var(--muted)); padding: 2px 6px; border-radius: 3px; font-family: monospace; font-size: 0.9em; color: inherit; }
        .saker-editor pre { background: hsl(var(--muted)); color: inherit; padding: 16px; border-radius: 6px; overflow-x: auto; margin: 0.5em 0; white-space: pre-wrap; }
        .saker-editor pre code { background: none; padding: 0; }
        .saker-editor table { border-collapse: collapse; width: 100%; margin: 0.5em 0; }
        .saker-editor th, .saker-editor td { border: 1px solid hsl(var(--border)); padding: 8px 12px; text-align: left; color: inherit; }
        .saker-editor th { background: hsl(var(--muted)); font-weight: 600; }
        .saker-editor a { color: hsl(var(--primary)); text-decoration: underline; }
        .saker-editor [data-saker-block="callout"] { padding: 14px 18px; border-radius: 4px; border: 1px solid hsl(var(--border)); margin: 0.8em 0; }
        .saker-editor [data-saker-props*='"type":"info"'] { background: hsl(var(--primary) / 0.1); border-color: hsl(var(--primary) / 0.3); }
        .saker-editor [data-saker-props*='"type":"warning"'] { background: hsl(45 100% 50% / 0.1); border-color: hsl(45 100% 50% / 0.3); }
        .saker-editor [data-saker-props*='"type":"tip"'] { background: hsl(142 71% 45% / 0.1); border-color: hsl(142 71% 45% / 0.3); }
        .saker-editor [data-saker-props*='"type":"error"'] { background: hsl(var(--destructive) / 0.1); border-color: hsl(var(--destructive) / 0.3); }
        /* Full width override */
        .eyas-editor-full-width .saker-editor { max-width: 100% !important; }
      `}</style>
    </div>
  )
}
