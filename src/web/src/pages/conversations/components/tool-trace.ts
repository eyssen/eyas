// Part of eYssen. See LICENSE file for full copyright and licensing details.

export interface ToolTraceCall {
  toolName: string
  input?: Record<string, unknown>
  output?: unknown
  error?: string
  status: 'running' | 'success' | 'error'
}

export interface DiffHunk {
  type: 'add' | 'del' | 'ctx'
  text: string
}

export interface FileEditDiff {
  path: string
  hunks: DiffHunk[]
}

const BRIEF_MAX = 64

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function truncate(text: string, max = BRIEF_MAX): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, Math.max(0, max - 1))}…`
}

/** One-line summary of a tool's arguments for the collapsed trace row. */
export function briefToolArgs(toolName: string, input?: Record<string, unknown>): string {
  if (!input) return ''

  const path = asString(input.path) ?? asString(input.file_path) ?? asString(input.filePath)
  const pattern = asString(input.pattern) ?? asString(input.query)
  const command = asString(input.command)
  const url = asString(input.url)

  if (toolName === 'grep' && pattern) {
    return truncate(path ? `${pattern} in ${path}` : pattern)
  }
  if (path && (toolName === 'edit_file' || toolName === 'write_file' || toolName === 'read_file' || toolName === 'delete_file')) {
    return basename(path)
  }
  if (command) return truncate(command)
  if (url) return truncate(url)
  if (pattern) return truncate(pattern)
  if (path) return basename(path)

  const first = Object.values(input).find((v) => typeof v === 'string' && (v as string).length > 0)
  return first ? truncate(String(first)) : ''
}

/** One-line summary of a finished tool call. */
export function briefToolResult(call: ToolTraceCall): string {
  if (call.error) return truncate(call.error, 96)

  const output = call.output
  if (output == null) return ''

  if (typeof output === 'string') {
    const first = output.split('\n').find((line) => line.trim().length > 0) ?? output
    return truncate(first, 96)
  }

  if (typeof output === 'object') {
    const rec = output as Record<string, unknown>
    const path = asString(rec.path)
    const replacements = rec.replacements
    if (typeof replacements === 'number' && path) {
      const noun = replacements === 1 ? 'replacement' : 'replacements'
      return `${replacements} ${noun} in ${basename(path)}`
    }
    if (rec.ok === true && path) return `wrote ${basename(path)}`
    if (asString(rec.error)) return truncate(asString(rec.error)!, 96)
  }

  return ''
}

const DIFF_LINE_CAP = 80

function linesOf(text: string): string[] {
  if (!text) return []
  const raw = text.split('\n')
  if (raw.length && raw[raw.length - 1] === '') raw.pop()
  return raw
}

function capHunks(hunks: DiffHunk[]): DiffHunk[] {
  if (hunks.length <= DIFF_LINE_CAP) return hunks
  return hunks.slice(0, DIFF_LINE_CAP)
}

/** Unified-style hunks for edit_file / write_file. Null for anything else. */
export function fileEditDiff(call: ToolTraceCall): FileEditDiff | null {
  const input = call.input
  if (!input) return null
  const path = asString(input.path) ?? asString(input.file_path) ?? asString(input.filePath)
  if (!path) return null

  if (call.toolName === 'edit_file') {
    const oldString = asString(input.oldString) ?? asString(input.old_string) ?? ''
    const newString = asString(input.newString) ?? asString(input.new_string) ?? ''
    if (!oldString && !newString) return null
    const hunks: DiffHunk[] = [
      ...linesOf(oldString).map((text) => ({ type: 'del' as const, text })),
      ...linesOf(newString).map((text) => ({ type: 'add' as const, text })),
    ]
    return { path, hunks: capHunks(hunks) }
  }

  if (call.toolName === 'write_file') {
    const content = asString(input.content) ?? ''
    if (!content) return { path, hunks: [] }
    const hunks = linesOf(content).map((text) => ({ type: 'add' as const, text }))
    return { path, hunks: capHunks(hunks) }
  }

  return null
}
