/**
 * Legacy thinking-budget presets. `effort` is the real knob on modern models,
 * but the budget is still what drives providers that only accept a token
 * budget, so both are written on every change.
 */
export const EFFORT_BUDGETS: Record<string, number> = { low: 5000, medium: 10000, high: 25000, max: 100000 }

/**
 * Selected effort level: the stored `effort` column wins; conversations
 * created before the column existed fall back to their thinking budget.
 */
export function resolveEffortValue(
  effort: string | null,
  thinking: string,
  thinkingBudget: number | null,
): string {
  if (effort) return effort
  if (thinking !== 'on') return 'off'
  const budget = thinkingBudget ?? 10000
  if (budget <= 5000) return 'low'
  if (budget <= 10000) return 'medium'
  if (budget <= 25000) return 'high'
  return 'max'
}

/**
 * PATCH payload for an effort change. Writes the effort level, the thinking
 * flag budget-based providers still read, and the matching budget preset.
 */
export function effortUpdate(value: string): Record<string, unknown> {
  const off = value === 'off'
  return {
    effort: off ? null : value,
    thinking: off ? 'off' : 'on',
    thinkingBudget: off ? null : (EFFORT_BUDGETS[value] ?? 10000),
  }
}

export interface NamedWorkspace {
  name: string
  path: string
}

function workspaceBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

/** Normalize mixed string / {name, path} working-directory payloads for the UI. */
export function toNamedWorkingDirectories(raw: unknown): NamedWorkspace[] {
  if (!Array.isArray(raw)) return []
  const out: NamedWorkspace[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const path = item.trim()
      if (!path) continue
      out.push({ name: workspaceBasename(path), path })
      continue
    }
    if (item && typeof item === 'object' && typeof (item as { path?: unknown }).path === 'string') {
      const path = (item as { path: string }).path.trim()
      if (!path) continue
      const rawName = (item as { name?: unknown }).name
      const name = typeof rawName === 'string' ? rawName.trim() : ''
      out.push({ name: name || workspaceBasename(path), path })
    }
  }
  return out
}

export function workspaceChipLabel(raw: unknown): { name: string | null; extra: number } {
  const entries = toNamedWorkingDirectories(raw)
  if (entries.length === 0) return { name: null, extra: 0 }
  return { name: entries[0].name, extra: entries.length - 1 }
}

export function pinWorkspacePrimary(raw: unknown, path: string): NamedWorkspace[] {
  const entries = toNamedWorkingDirectories(raw)
  const index = entries.findIndex((entry) => entry.path === path)
  if (index <= 0) return entries
  const next = [...entries]
  const [picked] = next.splice(index, 1)
  next.unshift(picked)
  return next
}
