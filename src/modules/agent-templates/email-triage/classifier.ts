// Part of eYssen. See LICENSE file for full copyright and licensing details.

import {
  buildClassifierPrompt,
  parseClassifierResponse,
  TRIAGE_SYSTEM_PROMPT,
} from './prompt-sections.js'
import type {
  ClassificationResult,
  CompiledRule,
  CompiledRuleMatcher,
  InboundEmail,
  LLMClient,
  RuleMatcherClause,
  RuleStore,
  TriageBucket,
} from './types.js'

/**
 * Deterministic + LLM-fallback classifier.
 *
 * The pipeline is:
 *   1. Walk compiled rules in priority order. First match wins.
 *   2. Apply built-in heuristics (bulk / newsletter markers, known subject
 *      prefixes, meeting-invite MIME hints, etc.).
 *   3. Fall through to the LLM if still undecided.
 *
 * Every branch returns a ClassificationResult so callers (the action router
 * in particular) can treat the output uniformly.
 */
export class EmailClassifier {
  constructor(
    private readonly ruleStore: RuleStore,
    private readonly llm: LLMClient | null
  ) {}

  async classify(email: InboundEmail): Promise<ClassificationResult> {
    // 1. Deterministic rule pass
    const ruleHit = await this.matchRules(email)
    if (ruleHit) return ruleHit

    // 2. Heuristics
    const heuristic = this.heuristics(email)
    if (heuristic) return heuristic

    // 3. LLM fallback (if available)
    if (this.llm) {
      return this.llmFallback(email)
    }

    // No LLM configured → escalate.
    return {
      bucket: 'escalate',
      confidence: 0,
      reason: 'No deterministic match and no LLM available — escalated for human review.',
    }
  }

  // ---------------------------------------------------------------------
  // Rule pass
  // ---------------------------------------------------------------------

  private async matchRules(email: InboundEmail): Promise<ClassificationResult | null> {
    const rules = await this.ruleStore.list()
    const sorted = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

    for (const rule of sorted) {
      if (matchesRule(email, rule)) {
        const action = rule.action
        return {
          bucket: action.type,
          confidence: 1,
          reason: `Matched rule "${rule.label}".`,
          matchedRuleId: rule.id,
          suggestedDelegate: action.type === 'delegate' ? action.to : undefined,
          suggestedDraft:
            action.type === 'quick-reply' && action.template
              ? action.template
              : undefined,
        }
      }
    }
    return null
  }

  // ---------------------------------------------------------------------
  // Heuristics
  // ---------------------------------------------------------------------

  private heuristics(email: InboundEmail): ClassificationResult | null {
    const subject = email.subject.toLowerCase()
    const headers = lowerKeyHeaders(email.headers)

    // Bulk / newsletter markers → archive.
    if (
      'list-unsubscribe' in headers ||
      headers['precedence'] === 'bulk' ||
      headers['auto-submitted'] === 'auto-generated'
    ) {
      return {
        bucket: 'archive',
        confidence: 0.9,
        reason: 'Bulk / newsletter headers detected (List-Unsubscribe or Precedence: bulk).',
      }
    }

    // Meeting invites.
    if (
      headers['content-type']?.includes('text/calendar') ||
      /\b(meeting invite|invitation|\.ics)\b/i.test(email.subject)
    ) {
      return {
        bucket: 'todo',
        confidence: 0.7,
        reason: 'Looks like a meeting invite — surfaced as a todo for scheduling.',
      }
    }

    // Invoices / billing keywords → todo (NOT quick-reply, never auto-reply about money).
    if (/\b(invoice|számla|receipt|statement|overdue)\b/i.test(subject)) {
      return {
        bucket: 'todo',
        confidence: 0.75,
        reason: 'Subject suggests a financial document (invoice/receipt/statement).',
      }
    }

    // Hard-coded safety: phishing-ish signals → escalate.
    if (/\b(urgent.*password|verify your account|suspicious login)\b/i.test(subject)) {
      return {
        bucket: 'escalate',
        confidence: 0.85,
        reason: 'Subject contains phishing-style keywords — escalated.',
      }
    }

    return null
  }

  // ---------------------------------------------------------------------
  // LLM fallback
  // ---------------------------------------------------------------------

  private async llmFallback(email: InboundEmail): Promise<ClassificationResult> {
    const llm = this.llm!
    const userPrompt = buildClassifierPrompt(email)

    let raw: string
    try {
      raw = await llm.complete({
        system: TRIAGE_SYSTEM_PROMPT,
        user: userPrompt,
        temperature: 0,
      })
    } catch {
      return {
        bucket: 'escalate',
        confidence: 0,
        reason: 'LLM call failed — escalated for human review.',
        fromLLM: true,
      }
    }

    const parsed = parseClassifierResponse(raw)
    return {
      bucket: applySafetyFloor(parsed.bucket, email),
      confidence: parsed.confidence,
      reason: parsed.reason,
      suggestedDraft: parsed.draft,
      fromLLM: true,
    }
  }
}

// -------------------------------------------------------------------------
// Rule matching helpers
// -------------------------------------------------------------------------

export function matchesRule(email: InboundEmail, rule: CompiledRule): boolean {
  const m = rule.matcher
  if (m.from && !clauseMatches(email.from, m.from)) return false
  if (m.to && !clauseMatches(email.to.join(', '), m.to)) return false
  if (m.subject && !clauseMatches(email.subject, m.subject)) return false
  if (m.body && !clauseMatches(email.body, m.body)) return false
  if (m.header) {
    const hdrs = lowerKeyHeaders(email.headers)
    for (const [key, clause] of Object.entries(m.header)) {
      const value = hdrs[key.toLowerCase()] ?? ''
      if (!clauseMatches(value, clause)) return false
    }
  }
  // An empty matcher (no clauses at all) should NOT match everything — that
  // would be a footgun for users writing rules. Require at least one clause.
  const hasAnyClause =
    !!m.from || !!m.to || !!m.subject || !!m.body ||
    !!(m.header && Object.keys(m.header).length > 0)
  return hasAnyClause
}

function clauseMatches(value: string, clause: RuleMatcherClause): boolean {
  const haystack = clause.caseInsensitive === false ? value : value.toLowerCase()
  if (clause.contains !== undefined) {
    const needle = clause.caseInsensitive === false ? clause.contains : clause.contains.toLowerCase()
    if (!haystack.includes(needle)) return false
  }
  if (clause.equals !== undefined) {
    const needle = clause.caseInsensitive === false ? clause.equals : clause.equals.toLowerCase()
    if (haystack !== needle) return false
  }
  if (clause.regexIsh !== undefined) {
    // "regexIsh" is intentionally NOT a real regular expression. Inputs come
    // from the LLM-backed rule compiler and from user-authored NL rules, so
    // we cannot safely pass them to `new RegExp()` (ReDoS, CWE-1333).
    // Instead we implement a small, linear-time alternation matcher that
    // treats the pattern as a `|`-separated list of literal substrings.
    const bounded = value.length > 4096 ? value.slice(0, 4096) : value
    const caseInsensitive = clause.caseInsensitive !== false
    if (!literalAltMatches(bounded, clause.regexIsh, caseInsensitive)) {
      return false
    }
  }
  // A clause with no predicates matches nothing — avoids the "empty clause
  // matches everything" footgun inside compiled rules.
  if (
    clause.contains === undefined &&
    clause.equals === undefined &&
    clause.regexIsh === undefined
  ) {
    return false
  }
  return true
}

/**
 * Linear-time matcher for our "regexIsh" mini-language. The pattern is split
 * on `|` and each alternative is treated as a literal substring. This avoids
 * `new RegExp()` on untrusted input (ReDoS-safe) while still covering the
 * common case the LLM-backed rule compiler emits — alternations like
 * `invoice|bill|számla`.
 */
function literalAltMatches(haystack: string, pattern: string, caseInsensitive: boolean): boolean {
  if (pattern.length === 0 || pattern.length > 512) return false
  const hay = caseInsensitive ? haystack.toLowerCase() : haystack
  for (const alt of pattern.split('|')) {
    const needle = caseInsensitive ? alt.toLowerCase() : alt
    if (needle.length === 0) continue
    if (hay.includes(needle)) return true
  }
  return false
}

function lowerKeyHeaders(headers?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers) return out
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = v.toLowerCase()
  }
  return out
}

/**
 * Safety floor: never let the LLM auto-reply to anything touching money,
 * legal, or authentication — force at least 'escalate' for those signals.
 */
function applySafetyFloor(bucket: TriageBucket, email: InboundEmail): TriageBucket {
  if (bucket !== 'quick-reply') return bucket
  const combined = (email.subject + ' ' + email.body).toLowerCase()
  if (/\b(password|invoice|contract|legal|bank|wire transfer|payment)\b/.test(combined)) {
    return 'escalate'
  }
  return bucket
}

/** Exported for tests. */
export const __internals = { clauseMatches, matchesRule, applySafetyFloor }
