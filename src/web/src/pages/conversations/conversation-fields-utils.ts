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
