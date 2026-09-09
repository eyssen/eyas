// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import '@xterm/xterm/css/xterm.css'

interface CreateSessionResponse {
  id: string
  wsPath: string
  pid: number
  cols: number
  rows: number
}

interface WebTerminalProps {
  conversationId: string
  cwd?: string | null
  workingDirectories?: string[] | null
  className?: string
}

function cssColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function openTerminalSocket(wsPath: string, token: string): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return new WebSocket(`${protocol}//${window.location.host}${wsPath}?token=${encodeURIComponent(token)}`)
}

export function WebTerminal({ conversationId, cwd, workingDirectories, className }: WebTerminalProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      theme: {
        background: cssColor('--background', '#0b0b0f'),
        foreground: cssColor('--foreground', '#e8e8ed'),
        cursor: cssColor('--foreground', '#e8e8ed'),
      },
      scrollback: 4_000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(host)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    const flush = () => {
      rafRef.current = null
      const chunk = pendingRef.current
      if (!chunk) return
      pendingRef.current = ''
      term.write(chunk)
    }

    const enqueue = (data: string) => {
      pendingRef.current += data
      if (rafRef.current == null) {
        rafRef.current = window.requestAnimationFrame(flush)
      }
    }

    const onResize = () => {
      fit.fit()
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(host)

    void (async () => {
      try {
        const session = await api.post<CreateSessionResponse>('/opencode/sessions', {
          conversationId,
          cwd: cwd ?? undefined,
          kind: 'tui',
          cols: term.cols,
          rows: term.rows,
          workingDirectories: workingDirectories ?? undefined,
        })
        if (cancelled) return
        const { token } = await api.post<{ token: string }>('/auth/ws-token')
        if (cancelled) return
        const ws = openTerminalSocket(session.wsPath, token)
        wsRef.current = ws
        ws.onmessage = (ev) => {
          try {
            const frame = JSON.parse(String(ev.data)) as { type?: string; data?: string; message?: string }
            if (frame.type === 'output' && typeof frame.data === 'string') enqueue(frame.data)
            else if (frame.type === 'error' && typeof frame.message === 'string') setError(frame.message)
          } catch {
            enqueue(String(ev.data))
          }
        }
        ws.onerror = () => setError('Terminal socket error')
        ws.onclose = () => {
          if (!cancelled) enqueue('\r\n[disconnected]\r\n')
        }
        term.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'input', data }))
          }
        })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()

    return () => {
      cancelled = true
      ro.disconnect()
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current)
      try { wsRef.current?.close() } catch { /* gone */ }
      wsRef.current = null
      term.dispose()
      termRef.current = null
    }
  }, [conversationId, cwd, workingDirectories])

  return (
    <div className={cn('relative h-full min-h-0 w-full bg-background', className)}>
      <div ref={hostRef} className="h-full w-full" />
      {error && (
        <div className="absolute inset-x-0 bottom-0 px-3 py-2 text-xs text-destructive bg-background/90 border-t border-border">
          {error}
        </div>
      )}
    </div>
  )
}
