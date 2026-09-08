// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/design/design-ai.ts
//
// The AI editing engine.
//
// The design decision this file exists to hold: EYAS does NOT hand the job to
// the Claude provider when Claude happens to be configured. One pipeline, one
// prompt, one validator gate — because the unit of work is text every provider
// can produce, and a feature whose behaviour changes with the provider is a
// feature nobody can reason about.
//
// What DOES vary is the executor tier, chosen from what the provider can do:
//
//   whole-canvas   every provider. One completion returns the full files record.
//   per-artboard   every provider. One completion per artboard, for edits that
//                  touch one frame of a large canvas — cheaper, and it cannot
//                  damage the artboards it was not asked about.
//   workspace      NOT WIRED YET. The agentic tier, where a CLI provider edits
//                  the materialised files with its own tools. It needs the
//                  agent-runner integration and lands with it; `chooseTier`
//                  never returns it today, and nothing pretends otherwise.
//
// Whichever tier ran, the result passes validateCanvas before it can become a
// version, and one retry is made with the validator's own output as feedback.
// That gate is what makes a small local model usable here.

import { CANVAS_FILE } from './canvas-schema.js'
import { describeIssues, validateCanvas, type ValidationResult } from './dc-validate.js'
import { DESIGN_EDITOR_PROMPT, SINGLE_ARTBOARD_OUTPUT } from './design-prompt.js'

export type ExecutorTier = 'whole-canvas' | 'per-artboard'

export interface CompleteFn {
  (args: { system: string; user: string }): Promise<string>
}

export interface DesignAiDeps {
  complete: CompleteFn
  /** The active design prompt, read from the DB row so an owner edit wins. */
  systemPrompt?: string
}

export interface EditRequest {
  files: Record<string, string>
  instruction: string
  /** Restrict the edit to one artboard; also forces the per-artboard tier. */
  targetFile?: string
}

export interface EditResult {
  ok: boolean
  files?: Record<string, string>
  tier: ExecutorTier
  attempts: number
  message?: string
  validation?: ValidationResult
}

/** Below this, rewriting the whole record is simpler and cheaper than looping. */
const WHOLE_CANVAS_ARTBOARD_LIMIT = 3

export function chooseTier(files: Record<string, string>, req: { targetFile?: string }): ExecutorTier {
  if (req.targetFile) return 'per-artboard'
  const artboards = Object.keys(files).filter((f) => f.endsWith('.dc.html'))
  return artboards.length > WHOLE_CANVAS_ARTBOARD_LIMIT ? 'per-artboard' : 'whole-canvas'
}

/** First balanced JSON object in a model response. */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function renderCanvas(files: Record<string, string>): string {
  return Object.entries(files)
    .map(([name, content]) => {
      // Images are base64 blobs; the model needs to know they exist, not read them.
      const body = name.endsWith('.dc.html') || name === CANVAS_FILE
        ? content
        : `<${content.length} bytes of base64 — do not modify, reference it as "${name}">`
      return `--- ${name} ---\n${body}`
    })
    .join('\n\n')
}

function systemFor(deps: DesignAiDeps, extra?: string): string {
  return [deps.systemPrompt || DESIGN_EDITOR_PROMPT, extra || '']
    .filter((s) => s.trim())
    .join('\n\n')
}

async function attempt(
  deps: DesignAiDeps,
  system: string,
  user: string,
): Promise<{ raw: string } | { error: string }> {
  try {
    const raw = await deps.complete({ system, user })
    if (!raw.trim()) return { error: 'the model returned nothing' }
    return { raw }
  } catch (err) {
    return { error: `the model call failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

function parseFilesResponse(raw: string): { files: Record<string, string> } | { error: string } {
  const json = extractJsonObject(raw)
  if (!json) return { error: 'the model did not return a JSON object' }
  let value: any
  try {
    value = JSON.parse(json)
  } catch (e) {
    return { error: `the model's JSON did not parse: ${e instanceof Error ? e.message : String(e)}` }
  }
  const files = value?.files
  if (!files || typeof files !== 'object' || Array.isArray(files)) return { error: 'the JSON object has no "files" record' }
  const out: Record<string, string> = {}
  for (const [name, content] of Object.entries(files)) {
    if (typeof content !== 'string') return { error: `"${name}" is not a string` }
    if (name.includes('/') || name.includes('\\') || name.includes('..')) return { error: `unsafe file name: ${name}` }
    out[name] = content
  }
  return { files: out }
}

function parseSingleFileResponse(raw: string, expected: string): { content: string } | { error: string } {
  const json = extractJsonObject(raw)
  if (!json) return { error: 'the model did not return a JSON object' }
  let value: any
  try {
    value = JSON.parse(json)
  } catch (e) {
    return { error: `the model's JSON did not parse: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (typeof value?.content !== 'string') return { error: 'the JSON object has no "content" string' }
  if (typeof value.file === 'string' && value.file !== expected) {
    return { error: `the model returned "${value.file}" but was asked to edit "${expected}"` }
  }
  return { content: value.content }
}

/**
 * Run an edit. Never throws: a failure returns `ok: false` with a message the
 * UI can show and the caller keeps the previous version.
 */
export async function editDesign(deps: DesignAiDeps, req: EditRequest): Promise<EditResult> {
  const tier = chooseTier(req.files, req)
  const maxAttempts = 2
  let feedback = ''
  let lastMessage = 'no attempt was made'
  let lastValidation: ValidationResult | undefined

  for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo++) {
    const isSingle = tier === 'per-artboard'
    const target = req.targetFile ?? Object.keys(req.files).find((f) => f.endsWith('.dc.html'))
    if (isSingle && !target) return { ok: false, tier, attempts: attemptNo - 1, message: 'the canvas has no artboard to edit' }

    const system = systemFor(deps, isSingle ? SINGLE_ARTBOARD_OUTPUT : undefined)
    const user = [
      `# Instruction\n${req.instruction}`,
      isSingle ? `# Edit only this file\n${target}` : '',
      `# Current canvas\n${renderCanvas(req.files)}`,
      feedback ? `# Your previous attempt was rejected\nFix exactly these problems and return the corrected output:\n${feedback}` : '',
    ].filter(Boolean).join('\n\n')

    const got = await attempt(deps, system, user)
    if ('error' in got) {
      lastMessage = got.error
      // A transport failure will not be fixed by re-prompting with feedback.
      return { ok: false, tier, attempts: attemptNo, message: lastMessage }
    }

    let candidate: Record<string, string>
    if (isSingle) {
      const parsed = parseSingleFileResponse(got.raw, target as string)
      if ('error' in parsed) { lastMessage = parsed.error; feedback = parsed.error; continue }
      candidate = { ...req.files, [target as string]: parsed.content }
    } else {
      const parsed = parseFilesResponse(got.raw)
      if ('error' in parsed) { lastMessage = parsed.error; feedback = parsed.error; continue }
      candidate = parsed.files
    }

    const validation = validateCanvas(candidate)
    lastValidation = validation
    if (validation.ok) return { ok: true, files: candidate, tier, attempts: attemptNo, validation }

    lastMessage = describeIssues(validation)
    feedback = lastMessage
  }

  return { ok: false, tier, attempts: maxAttempts, message: lastMessage, validation: lastValidation }
}

/** Create a canvas from a brief. Same gate, same retry. */
export async function createDesignFromBrief(deps: DesignAiDeps, brief: string): Promise<EditResult> {
  return editDesign(deps, {
    files: { 'Main.dc.html': '<x-dc><div>empty</div></x-dc>' },
    instruction: `Create a new design canvas from this brief. Replace the placeholder artboard entirely.\n\n${brief}`,
  })
}
