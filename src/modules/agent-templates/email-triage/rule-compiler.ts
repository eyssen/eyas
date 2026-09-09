// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { randomUUID } from 'node:crypto'

import {
  buildRuleCompilerPrompt,
  RULE_COMPILER_SYSTEM_PROMPT,
} from './prompt-sections.js'
import {
  RuleCompilationError,
  type CompiledRule,
  type CompiledRuleAction,
  type CompiledRuleMatcher,
  type LLMClient,
  type RuleMatcherClause,
  type TriageBucket,
} from './types.js'

const ALLOWED_BUCKETS: readonly TriageBucket[] = [
  'archive',
  'quick-reply',
  'todo',
  'escalate',
  'delegate',
]

/**
 * Compiles a natural-language rule into a structured {@link CompiledRule}
 * using the LLM. The LLM is instructed to return strict JSON; we validate it
 * and throw {@link RuleCompilationError} on anything unexpected.
 */
export class RuleCompiler {
  constructor(private readonly llm: LLMClient) {}

  async compile(nl: string): Promise<CompiledRule> {
    const trimmed = nl.trim()
    if (trimmed.length === 0) {
      throw new RuleCompilationError('Empty rule input.')
    }
    if (trimmed.length > 1000) {
      throw new RuleCompilationError('Rule input too long (>1000 chars).')
    }

    let raw: string
    try {
      raw = await this.llm.complete({
        system: RULE_COMPILER_SYSTEM_PROMPT,
        user: buildRuleCompilerPrompt(trimmed),
        temperature: 0,
      })
    } catch (err) {
      throw new RuleCompilationError(
        `LLM call failed: ${(err as Error).message}`,
        trimmed
      )
    }

    return parseCompiledRule(raw, trimmed)
  }
}

/** Parse + validate the LLM output into a {@link CompiledRule}. */
export function parseCompiledRule(raw: string, source: string): CompiledRule {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new RuleCompilationError('No JSON object found in LLM output.', raw)
  }

  let obj: unknown
  try {
    obj = JSON.parse(jsonMatch[0])
  } catch (err) {
    throw new RuleCompilationError(
      `Invalid JSON in LLM output: ${(err as Error).message}`,
      raw
    )
  }

  if (typeof obj !== 'object' || obj === null) {
    throw new RuleCompilationError('LLM output is not an object.', raw)
  }

  const record = obj as Record<string, unknown>

  if (record.error) {
    throw new RuleCompilationError(
      `Rule compiler rejected input: ${String(record.error)}`,
      source
    )
  }

  const label = typeof record.label === 'string' ? record.label.trim() : ''
  if (label.length === 0) {
    throw new RuleCompilationError('Compiled rule is missing a label.', raw)
  }

  const matcher = normalizeMatcher(record.matcher)
  if (!hasAnyMatcherClause(matcher)) {
    throw new RuleCompilationError(
      'Compiled rule has no matcher clauses.',
      raw
    )
  }

  const action = normalizeAction(record.action)

  return {
    id: randomUUID(),
    label,
    matcher,
    action,
    priority: typeof record.priority === 'number' ? record.priority : 0,
    source,
    createdAt: new Date().toISOString(),
  }
}

function normalizeMatcher(value: unknown): CompiledRuleMatcher {
  if (typeof value !== 'object' || value === null) {
    throw new RuleCompilationError('Matcher is missing or not an object.')
  }
  const m = value as Record<string, unknown>
  const out: CompiledRuleMatcher = {}

  if (m.from !== undefined) out.from = normalizeClause(m.from, 'from')
  if (m.to !== undefined) out.to = normalizeClause(m.to, 'to')
  if (m.subject !== undefined) out.subject = normalizeClause(m.subject, 'subject')
  if (m.body !== undefined) out.body = normalizeClause(m.body, 'body')

  if (m.header !== undefined) {
    if (typeof m.header !== 'object' || m.header === null) {
      throw new RuleCompilationError('matcher.header is not an object.')
    }
    const headers: Record<string, RuleMatcherClause> = {}
    for (const [k, v] of Object.entries(m.header as Record<string, unknown>)) {
      headers[k] = normalizeClause(v, `header.${k}`)
    }
    out.header = headers
  }

  return out
}

function normalizeClause(value: unknown, field: string): RuleMatcherClause {
  if (typeof value !== 'object' || value === null) {
    throw new RuleCompilationError(`matcher.${field} is not an object.`)
  }
  const c = value as Record<string, unknown>
  const out: RuleMatcherClause = {}

  if (c.contains !== undefined) {
    if (typeof c.contains !== 'string')
      throw new RuleCompilationError(`matcher.${field}.contains must be a string.`)
    out.contains = c.contains
  }
  if (c.equals !== undefined) {
    if (typeof c.equals !== 'string')
      throw new RuleCompilationError(`matcher.${field}.equals must be a string.`)
    out.equals = c.equals
  }
  if (c.regexIsh !== undefined) {
    if (typeof c.regexIsh !== 'string')
      throw new RuleCompilationError(`matcher.${field}.regexIsh must be a string.`)
    // Bound the pattern length; the matcher treats it as a literal alt-list
    // rather than a real regex (see classifier.ts).
    if (c.regexIsh.length > 512)
      throw new RuleCompilationError(`matcher.${field}.regexIsh too long.`)
    out.regexIsh = c.regexIsh
  }
  if (c.caseInsensitive !== undefined) {
    if (typeof c.caseInsensitive !== 'boolean')
      throw new RuleCompilationError(
        `matcher.${field}.caseInsensitive must be a boolean.`
      )
    out.caseInsensitive = c.caseInsensitive
  }

  if (
    out.contains === undefined &&
    out.equals === undefined &&
    out.regexIsh === undefined
  ) {
    throw new RuleCompilationError(
      `matcher.${field} needs at least one of contains/equals/regexIsh.`
    )
  }

  return out
}

function normalizeAction(value: unknown): CompiledRuleAction {
  if (typeof value !== 'object' || value === null) {
    throw new RuleCompilationError('action is missing or not an object.')
  }
  const a = value as Record<string, unknown>

  const type = a.type
  if (typeof type !== 'string' || !ALLOWED_BUCKETS.includes(type as TriageBucket)) {
    throw new RuleCompilationError(
      `action.type must be one of ${ALLOWED_BUCKETS.join(', ')}.`
    )
  }

  const out: CompiledRuleAction = { type: type as TriageBucket }

  if (type === 'delegate') {
    if (typeof a.to !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.to)) {
      throw new RuleCompilationError(
        'action.to must be a valid email address for delegate rules.'
      )
    }
    out.to = a.to.toLowerCase()
  } else if (a.to !== undefined) {
    if (typeof a.to !== 'string')
      throw new RuleCompilationError('action.to must be a string when provided.')
    out.to = a.to
  }

  if (a.template !== undefined) {
    if (typeof a.template !== 'string')
      throw new RuleCompilationError('action.template must be a string.')
    out.template = a.template
  }

  if (a.boardId !== undefined) {
    if (typeof a.boardId !== 'string')
      throw new RuleCompilationError('action.boardId must be a string.')
    out.boardId = a.boardId
  }

  return out
}

function hasAnyMatcherClause(m: CompiledRuleMatcher): boolean {
  return (
    !!m.from ||
    !!m.to ||
    !!m.subject ||
    !!m.body ||
    (!!m.header && Object.keys(m.header).length > 0)
  )
}
