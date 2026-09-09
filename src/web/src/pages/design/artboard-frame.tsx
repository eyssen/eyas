import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/api'
import type { RenderedArtboard, DcSelection } from './types'
import { t } from './i18n'

/**
 * One artboard, rendered inside a sandboxed iframe.
 *
 * The `sandbox` value comes from the SAME payload as the srcdoc, so the two
 * cannot drift: the server decides the isolation and the client cannot widen
 * it. `allow-same-origin` never appears — together with allow-scripts it would
 * hand AI-authored script the app's origin, and the session is an httpOnly
 * cookie with a header-presence CSRF check.
 *
 * Because of that isolation the page cannot touch the artboard's DOM. Every
 * editing gesture crosses postMessage, and every inbound message is attributed
 * to THIS frame's window before it is acted on — any window can post.
 */
export function ArtboardFrame({
  designId,
  file,
  width,
  height,
  version,
  mode = 'interact',
  onSelect,
  onSource,
  onReady,
  onError,
}: {
  designId: string
  file: string
  width: number
  height: number
  /** Bump to force a re-fetch after an edit. */
  version: number
  mode?: 'edit' | 'interact'
  onSelect?: (selection: DcSelection | null) => void
  onSource?: (body: string) => void
  /** Receives a sender for this frame; null when the frame goes away. */
  onReady?: (send: ((message: unknown) => void) | null) => void
  onError?: (message: string) => void
}) {
  const [rendered, setRendered] = useState<RenderedArtboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)

  const send = useCallback((message: unknown) => {
    frameRef.current?.contentWindow?.postMessage(message, '*')
  }, [])

  useEffect(() => {
    let cancelled = false
    setError(null)
    api.get<RenderedArtboard>(`/designs/${designId}/render/${file}`)
      .then((r) => { if (!cancelled) setRendered(r) })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof ApiError ? err.message : String(err)
        setError(message)
        onError?.(message)
      })
    return () => { cancelled = true }
    // onError is intentionally not a dependency: callers pass inline closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designId, file, version])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Attribute the message to this frame. Any window can postMessage, and
      // the artboard's origin is opaque, so the source window is the only
      // usable identity.
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return
      const data = event.data as any
      if (!data || typeof data !== 'object') return
      if (data.type === 'dc:selected' && Number.isInteger(data.index) && typeof data.tag === 'string') {
        onSelect?.({ index: data.index, tag: data.tag, styles: data.styles ?? {}, text: data.text, bound: !!data.bound })
      } else if (data.type === 'dc:source' && typeof data.body === 'string') {
        onSource?.(data.body)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onSelect, onSource])

  // Re-announce the mode whenever it changes or the frame reloads.
  useEffect(() => {
    if (!rendered) return
    const timer = window.setTimeout(() => {
      send({ type: 'dc:setMode', mode })
      onReady?.(send)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      onReady?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, mode, send])

  if (error) {
    return (
      <div
        className="flex items-center justify-center border border-[hsl(var(--destructive))] text-xs p-4 text-center"
        style={{ width, height }}
      >
        {error}
      </div>
    )
  }

  if (!rendered) {
    return <div className="animate-pulse bg-muted/40 border border-[hsl(var(--border))]" style={{ width, height }} />
  }

  return (
    <iframe
      ref={frameRef}
      title={file}
      sandbox={rendered.sandbox}
      srcDoc={rendered.srcdoc}
      style={{ width, height, border: 0, background: '#fff', display: 'block' }}
      aria-label={t('design.artboard.frameLabel', { file })}
    />
  )
}
