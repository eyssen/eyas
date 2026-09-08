import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { BenchmarkTask, BenchmarkCategory } from './types.js'

const KNOWN_CATEGORIES: readonly BenchmarkCategory[] = [
  'email-triage',
  'coding',
  'ops',
  'research',
  'meetings',
]

export class TaskLoadError extends Error {
  constructor(public readonly filePath: string, message: string) {
    super(`${filePath}: ${message}`)
    this.name = 'TaskLoadError'
  }
}

function validateTask(raw: unknown, filePath: string): BenchmarkTask {
  if (!raw || typeof raw !== 'object') {
    throw new TaskLoadError(filePath, 'Task file must contain a JSON object')
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    throw new TaskLoadError(filePath, 'Missing required string field: id')
  }
  if (typeof obj.category !== 'string') {
    throw new TaskLoadError(filePath, 'Missing required string field: category')
  }
  if (!KNOWN_CATEGORIES.includes(obj.category as BenchmarkCategory)) {
    throw new TaskLoadError(
      filePath,
      `Unknown category: ${obj.category}. Expected one of: ${KNOWN_CATEGORIES.join(', ')}`,
    )
  }
  if (typeof obj.prompt !== 'string' || obj.prompt.length === 0) {
    throw new TaskLoadError(filePath, 'Missing required string field: prompt')
  }
  if (!obj.expectedOutcome || typeof obj.expectedOutcome !== 'object') {
    throw new TaskLoadError(filePath, 'Missing required object field: expectedOutcome')
  }
  const outcome = obj.expectedOutcome as Record<string, unknown>
  if (!Array.isArray(outcome.rubric) || outcome.rubric.length === 0) {
    throw new TaskLoadError(filePath, 'expectedOutcome.rubric must be a non-empty string array')
  }
  for (const r of outcome.rubric) {
    if (typeof r !== 'string') {
      throw new TaskLoadError(filePath, 'expectedOutcome.rubric must only contain strings')
    }
  }
  return obj as unknown as BenchmarkTask
}

async function walkJsonFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    const full = join(dir, name)
    let st
    try {
      st = await stat(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      out.push(...(await walkJsonFiles(full)))
    } else if (st.isFile() && name.endsWith('.json')) {
      out.push(full)
    }
  }
  return out
}

export interface LoadOptions {
  categories?: BenchmarkCategory[]
  taskIds?: string[]
}

export async function loadTasksFromDir(
  dir: string,
  opts: LoadOptions = {},
): Promise<BenchmarkTask[]> {
  const files = await walkJsonFiles(dir)
  const tasks: BenchmarkTask[] = []
  for (const file of files) {
    const content = await readFile(file, 'utf-8')
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch (err) {
      throw new TaskLoadError(file, `Invalid JSON: ${(err as Error).message}`)
    }
    const task = validateTask(parsed, file)
    if (opts.categories && !opts.categories.includes(task.category)) continue
    if (opts.taskIds && !opts.taskIds.includes(task.id)) continue
    tasks.push(task)
  }
  // Deterministic order across filesystems.
  tasks.sort((a, b) => a.id.localeCompare(b.id))
  return tasks
}

export function validateTaskObject(raw: unknown, source = '<memory>'): BenchmarkTask {
  return validateTask(raw, source)
}
