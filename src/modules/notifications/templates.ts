// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { NotificationPayload, NotificationRecord } from './router.js'

export interface TemplateEngine {
  /** Render a single notification for a specific channel */
  render(channel: string, payload: NotificationPayload): { subject?: string; text: string; html?: string }
  /** Render a digest/batch summary for a specific channel */
  renderDigest(channel: string, notifications: NotificationRecord[]): string
  /** Register a custom template for an event pattern */
  registerTemplate(eventPattern: string, template: NotificationTemplate): void
}

export interface NotificationTemplate {
  /** Render for plain text channels (telegram, webhook fallback) */
  text(payload: NotificationPayload): string
  /** Render for HTML channels (email) */
  html?(payload: NotificationPayload): string
  /** Custom subject line (email) */
  subject?(payload: NotificationPayload): string
}

// ─── Severity Icons ──────────────────────────────────

const SEVERITY_ICONS: Record<string, string> = {
  info: 'ℹ️',
  warning: '⚠️',
  error: '❌',
  critical: '🚨',
}

const SEVERITY_COLORS: Record<string, string> = {
  info: '#3b82f6',
  warning: '#f59e0b',
  error: '#ef4444',
  critical: '#dc2626',
}

// ─── Palette ─────────────────────────────────────────
//
// Constants, not configuration. These used to come from a configurable brand
// entity, which is why every value was sanitised at the point of interpolation
// — those were untrusted. They are literals now, and a sanitiser with nothing
// untrusted to sanitise is a comment pretending to be a defence.

const DOC = {
  background: '#ffffff',
  foreground: '#111827',
  muted: '#f9fafb',
  mutedForeground: '#4b5563',
  mutedFaint: '#9ca3af',
  mutedSubtle: '#6b7280',
  border: '#e5e7eb',
}
const FONT_BODY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
const FONT_DISPLAY = FONT_BODY
const RADIUS = '4px'
const BORDER_WIDTH = '1px'

function severityColor(severity: string): string {
  return SEVERITY_COLORS[severity] ?? '#3b82f6'
}

// ─── Default Templates ───────────────────────────────

function defaultText(payload: NotificationPayload): string {
  const icon = SEVERITY_ICONS[payload.severity] ?? 'ℹ️'
  return `${icon} ${payload.title}${payload.body ? `\n${payload.body}` : ''}`
}

function defaultHtml(payload: NotificationPayload): string {
  const color = severityColor(payload.severity)
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: ${FONT_BODY}; max-width: 600px; margin: 0 auto; padding: 20px; background: ${DOC.background};">
  <div style="border-left: 4px solid ${color}; padding: 16px; background: ${DOC.muted}; border-radius: ${RADIUS};">
    <h2 style="margin: 0 0 8px 0; font-family: ${FONT_DISPLAY}; color: ${DOC.foreground}; font-size: 16px;">${escapeHtml(payload.title)}</h2>
    ${payload.body ? `<p style="margin: 0; color: ${DOC.mutedForeground}; font-size: 14px;">${escapeHtml(payload.body)}</p>` : ''}
  </div>
  <p style="margin: 16px 0 0 0; color: ${DOC.mutedFaint}; font-size: 12px;">
    ${escapeHtml(payload.event)} · ${escapeHtml(new Date(payload.createdAt).toLocaleString())}
  </p>
  <hr style="border: none; border-top: ${BORDER_WIDTH} solid ${DOC.border}; margin: 16px 0;">
  <p style="color: ${DOC.mutedFaint}; font-size: 11px;">Sent by EYAS Notifications</p>
</body>
</html>`.trim()
}

function defaultSubject(payload: NotificationPayload): string {
  const prefix = payload.severity === 'critical' ? '🚨 ' : ''
  return `${prefix}[EYAS] ${payload.title}`
}

// ─── Digest Templates ────────────────────────────────

function digestText(notifications: NotificationRecord[]): string {
  const lines = notifications.map(n => {
    const icon = SEVERITY_ICONS[n.severity] ?? 'ℹ️'
    return `${icon} ${n.title}${n.body ? ` — ${n.body}` : ''}`
  })
  return `📋 Digest (${notifications.length} notifications)\n\n${lines.join('\n')}`
}

function digestHtml(notifications: NotificationRecord[]): string {
  const rows = notifications.map(n => {
    const color = severityColor(n.severity)
    return `
    <tr>
      <td style="padding: 8px 12px; border-bottom: ${BORDER_WIDTH} solid ${DOC.border};">
        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${color}; margin-right: 8px;"></span>
        <strong>${escapeHtml(n.title)}</strong>
        ${n.body ? `<br><span style="color: ${DOC.mutedSubtle}; font-size: 13px;">${escapeHtml(n.body)}</span>` : ''}
      </td>
      <td style="padding: 8px 12px; border-bottom: ${BORDER_WIDTH} solid ${DOC.border}; color: ${DOC.mutedFaint}; font-size: 12px; white-space: nowrap;">
        ${n.createdAt ? new Date(n.createdAt).toLocaleTimeString() : ''}
      </td>
    </tr>`
  }).join('')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: ${FONT_BODY}; max-width: 600px; margin: 0 auto; padding: 20px; background: ${DOC.background};">
  <h2 style="font-family: ${FONT_DISPLAY}; color: ${DOC.foreground}; font-size: 18px; margin: 0 0 16px 0;">
    📋 ${notifications.length} notification${notifications.length > 1 ? 's' : ''}
  </h2>
  <table style="width: 100%; border-collapse: collapse;">
    ${rows}
  </table>
  <hr style="border: none; border-top: ${BORDER_WIDTH} solid ${DOC.border}; margin: 16px 0;">
  <p style="color: ${DOC.mutedFaint}; font-size: 11px;">EYAS Notification Digest</p>
</body>
</html>`.trim()
}

// ─── Channel-specific formatters ─────────────────────

const CHANNEL_FORMATTERS: Record<string, {
  single: (payload: NotificationPayload, template?: NotificationTemplate) => { subject?: string; text: string; html?: string }
  digest: (notifications: NotificationRecord[]) => string
}> = {
  telegram: {
    single: (p, t) => ({
      text: t?.text(p) ?? `${SEVERITY_ICONS[p.severity] ?? 'ℹ️'} *${p.title}*${p.body ? `\n${p.body}` : ''}`,
    }),
    digest: (ns) => digestText(ns),
  },
  email: {
    single: (p, t) => ({
      subject: t?.subject?.(p) ?? defaultSubject(p),
      text: t?.text(p) ?? defaultText(p),
      html: t?.html?.(p) ?? defaultHtml(p),
    }),
    digest: (ns) => digestHtml(ns),
  },
  webhook: {
    single: (p, t) => ({
      text: t?.text(p) ?? JSON.stringify({ title: p.title, body: p.body, severity: p.severity, event: p.event }),
    }),
    digest: (ns) => JSON.stringify(ns.map(n => ({ title: n.title, body: n.body, severity: n.severity, event: n.event }))),
  },
  web: {
    single: (p, t) => ({ text: t?.text(p) ?? defaultText(p) }),
    digest: (ns) => digestText(ns),
  },
}

// ─── Engine Factory ──────────────────────────────────

export function createTemplateEngine(): TemplateEngine {
  const customTemplates = new Map<string, NotificationTemplate>()

  function findTemplate(event: string): NotificationTemplate | undefined {
    // Exact match first
    if (customTemplates.has(event)) return customTemplates.get(event)

    // Pattern match (e.g., 'board.*' matches 'board.task.assigned')
    for (const [pattern, template] of customTemplates) {
      if (pattern.includes('*')) {
        // The pattern is a glob, so every regex metacharacter is escaped first
        // and only then is the (now escaped) star turned back into a wildcard.
        // Escaping just the dot let '(' and friends act as regex syntax, so
        // 'board.(task).*' matched 'board.task.assigned'.
        const regex = new RegExp(
          '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^.]+') + '$',
        )
        if (regex.test(event)) return template
      }
    }

    return undefined
  }

  return {
    render(channel: string, payload: NotificationPayload) {
      const formatter = CHANNEL_FORMATTERS[channel] ?? CHANNEL_FORMATTERS.web
      const template = findTemplate(payload.event)
      return formatter.single(payload, template)
    },

    renderDigest(channel: string, notifications: NotificationRecord[]) {
      const formatter = CHANNEL_FORMATTERS[channel] ?? CHANNEL_FORMATTERS.web
      return formatter.digest(notifications)
    },

    registerTemplate(eventPattern: string, template: NotificationTemplate) {
      customTemplates.set(eventPattern, template)
    },
  }
}

// ─── Utilities ───────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
