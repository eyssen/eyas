// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { PiiMatch, PolicyAction, PolicyRule, PolicyResult } from './types.js'

/**
 * Applies policy rules to PII matches.
 * For each match, the first matching rule determines the action.
 */
export function applyPolicy(
  text: string,
  matches: PiiMatch[],
  rules: PolicyRule[],
): PolicyResult {
  const result: PolicyResult = {
    blocked: false,
    warnings: [],
    routeToLocal: false,
    matches,
    actions: new Map(),
  }

  if (matches.length === 0) {
    return result
  }

  // Compile rule patterns once
  const compiledRules = rules.map((rule) => ({
    pattern: new RegExp(`^(?:${rule.pattern})$`),
    action: rule.action,
  }))

  // Determine action for each match
  for (const match of matches) {
    let action: PolicyAction = 'warn' // default if no rule matches
    for (const rule of compiledRules) {
      if (rule.pattern.test(match.type)) {
        action = rule.action
        break
      }
    }
    result.actions.set(`${match.type}@${match.start}`, action)

    switch (action) {
      case 'block':
        result.blocked = true
        result.reason = `Blocked: ${match.type} detected (${match.scanner} scanner, confidence ${match.confidence})`
        break
      case 'auto_local':
        result.routeToLocal = true
        break
      case 'warn':
        result.warnings.push(
          `PII detected: ${match.type} at position ${match.start}-${match.end} (${match.scanner}, confidence ${match.confidence})`,
        )
        break
      case 'sanitize':
        // Handled in sanitizeText()
        break
    }
  }

  // Apply sanitization if needed
  const needsSanitize = Array.from(result.actions.values()).includes('sanitize')
  if (needsSanitize) {
    result.sanitizedText = sanitizeText(text, matches, result.actions)
  }

  return result
}

/**
 * Replace matched PII values with masked placeholders in text.
 * Only sanitizes matches whose action is 'sanitize'.
 */
export function sanitizeText(
  text: string,
  matches: PiiMatch[],
  actions: Map<string, PolicyAction>,
): string {
  // Sort matches by start position descending so replacements don't shift indices
  const toSanitize = matches
    .filter((m) => actions.get(`${m.type}@${m.start}`) === 'sanitize')
    .sort((a, b) => b.start - a.start)

  let result = text
  for (const match of toSanitize) {
    const mask = `[${match.type.toUpperCase()}]`
    result = result.slice(0, match.start) + mask + result.slice(match.end)
  }

  return result
}
