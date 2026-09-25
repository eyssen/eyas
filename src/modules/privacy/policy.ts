// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Privacy policy v2: one per-type action map, custom patterns, the hosts the
// operator declares local, and the audit flag. Pure — no I/O. The store
// (policy-store.ts) persists it; the service (service.ts) applies it.

import { z } from 'zod'
import { parse as parseYaml } from 'yaml'
import { checkRegexSafety } from '@shared/safe-regex.js'
import { hostOf } from '@shared/endpoint-locality.js'
import { BUILTIN_PII_TYPES, type BuiltinPiiType } from './types.js'

/**
 * What happens to a match:
 * - off   — ignored
 * - warn  — counted and logged, the text is left as is
 * - mask  — replaced with '[TYPE]' when the text leaves EYAS for a remote destination
 * - block — masked the same way on the way out; additionally a NEW interactive
 *           user message carrying it is refused before it is stored
 */
export const PRIVACY_ACTIONS = ['off', 'warn', 'mask', 'block'] as const
export type PrivacyAction = (typeof PRIVACY_ACTIONS)[number]

/** Bumped whenever the built-in detection rules change meaning. */
export const SCANNER_VERSION = 'regex@2'

/** The recorded ruleset version: scanner generation + stored policy version. */
export function rulesetVersion(policyVersion: number): string {
  return `${SCANNER_VERSION}/policy@${policyVersion}`
}

export const MAX_LOCAL_HOSTS = 32
export const MAX_CUSTOM_PATTERNS = 50

const BUILT_IN_ACTIONS: Record<BuiltinPiiType, PrivacyAction> = {
  email: 'mask',
  phone: 'mask',
  iban: 'block',
  bank_account: 'block',
  tax_number: 'block',
  personal_id: 'block',
  credit_card: 'block',
  ssn: 'block',
  taj_number: 'warn',
}

const ActionSchema = z.enum(PRIVACY_ACTIONS)

// One optional key per built-in type, each defaulting to its built-in action,
// so a YAML seed may list only the types it changes. Unknown keys are refused.
const actionsShape = Object.fromEntries(
  BUILTIN_PII_TYPES.map((type) => [type, ActionSchema.default(BUILT_IN_ACTIONS[type])]),
) as { [K in BuiltinPiiType]: z.ZodDefault<typeof ActionSchema> }

const ActionsSchema = z.object(actionsShape).strict()

/** A type slug: lower-case letters, digits and '_', starting with a letter. */
const TYPE_SLUG = /^[a-z][a-z0-9_]{0,39}$/

const CustomRegexSchema = z
  .string()
  .min(1)
  .max(1000)
  .superRefine((pattern, ctx) => {
    const verdict = checkRegexSafety(pattern)
    if (!verdict.safe) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unsafe or invalid regex (${verdict.reason}): ${verdict.detail ?? ''}`.trim(),
        params: { reason: verdict.reason === 'invalid-regex' ? 'invalidRegex' : 'unsafeRegex' },
      })
      return
    }
    try {
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp
      // Guarded above: checkRegexSafety() refused ReDoS-prone shapes.
      new RegExp(pattern, 'g')
    } catch (err) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `regex does not compile: ${err instanceof Error ? err.message : String(err)}`,
        params: { reason: 'invalidRegex' },
      })
    }
  })

export const CustomPatternSchema = z
  .object({
    name: z.string().trim().min(1).max(64),
    regex: CustomRegexSchema,
    type: z.string().regex(TYPE_SLUG, 'type must be a lower-case slug (letters, digits, _)'),
    action: ActionSchema,
  })
  .strict()

export type CustomPattern = z.output<typeof CustomPatternSchema>

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * Canonical form of a host literal (lower-case; IPv6 without brackets and in
 * the same canonical form a provider's egressHost() reports), or undefined
 * when it is not a bare hostname, IPv4 or IPv6 address — no scheme, port,
 * path, user info or wildcard.
 */
export function canonicalHost(input: string): string | undefined {
  let h = input.trim().toLowerCase()
  if (!h || h.length > 253) return undefined
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1)
  if (h.includes(':')) {
    if (!/^[0-9a-f:.]+$/.test(h)) return undefined
    return hostOf(`http://[${h}]/`)
  }
  if (/[^a-z0-9.-]/.test(h)) return undefined
  const quad = IPV4.exec(h)
  if (quad) {
    if (!quad.slice(1).every((octet) => Number(octet) <= 255)) return undefined
  } else if (!h.split('.').every((label) => HOST_LABEL.test(label))) {
    return undefined
  }
  // Only a literal that is already in URL-canonical form is accepted: a
  // leading-zero octet ('010.0.0.1' reads as octal) or an all-numeric name
  // ('123' reads as 0.0.0.123) would silently mean a different host.
  return hostOf(`http://${h}/`) === h ? h : undefined
}

const HostSchema = z
  .string()
  .max(255)
  .transform((value, ctx) => {
    const host = canonicalHost(value)
    if (!host) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `'${value}' is not a hostname or IP address`,
        params: { reason: 'invalidHost' },
      })
      return z.NEVER
    }
    return host
  })

export const PrivacyPolicySchema = z
  .object({
    enabled: z.boolean().default(true),
    actions: ActionsSchema.default({}),
    customPatterns: z.array(CustomPatternSchema).max(MAX_CUSTOM_PATTERNS).default([]),
    localHosts: z
      .array(HostSchema)
      .max(MAX_LOCAL_HOSTS)
      .default([])
      .transform((hosts) => [...new Set(hosts)]),
    audit: z.boolean().default(true),
  })
  .strict()

export type PrivacyPolicy = z.output<typeof PrivacyPolicySchema>
export type PrivacyPolicyInput = z.input<typeof PrivacyPolicySchema>

/**
 * The policy used on a first boot without a readable privacy.yaml. Frozen:
 * consumers copy it (every schema parse returns fresh objects).
 */
export const BUILT_IN_DEFAULTS: PrivacyPolicy = Object.freeze({
  enabled: true,
  actions: Object.freeze({ ...BUILT_IN_ACTIONS }),
  customPatterns: Object.freeze([]),
  localHosts: Object.freeze([]),
  audit: true,
}) as unknown as PrivacyPolicy

/** A flattened Zod issue: dotted path, code/reason and message. */
export interface PolicyIssue {
  path: string
  code: string
  message: string
}

export function toPolicyIssues(error: z.ZodError): PolicyIssue[] {
  return error.issues.map((issue) => {
    const reason = issue.code === z.ZodIssueCode.custom ? (issue.params as { reason?: string } | undefined)?.reason : undefined
    return { path: issue.path.join('.') || '(root)', code: reason ?? issue.code, message: issue.message }
  })
}

/** Thrown for a policy document that does not validate; carries the issues. */
export class PrivacyPolicyValidationError extends Error {
  readonly issues: PolicyIssue[]
  constructor(issues: PolicyIssue[], prefix = 'Invalid privacy policy') {
    super(`${prefix}: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`)
    this.name = 'PrivacyPolicyValidationError'
    this.issues = issues
  }
}

// ─── Legacy (v1) YAML ───────────────────────────────────

const LegacyRuleSchema = z.object({
  pattern: z.string().min(1),
  action: z.enum(['auto_local', 'warn', 'block', 'sanitize']),
})

const LegacyCustomPatternSchema = z.object({
  name: z.string().min(1),
  regex: z.string().min(1),
  type: z.string().min(1),
  confidence: z.number().optional(),
})

const LegacyPrivacySchema = z.object({
  enabled: z.boolean().default(true),
  scanners: z.array(z.string()).default(['regex']),
  rules: z.array(LegacyRuleSchema).default([]),
  custom_patterns: z.array(LegacyCustomPatternSchema).default([]),
  audit: z.boolean().default(true),
})

export type LegacyPrivacyConfig = z.input<typeof LegacyPrivacySchema>

const LEGACY_ACTION: Record<z.infer<typeof LegacyRuleSchema>['action'], PrivacyAction> = {
  sanitize: 'mask',
  block: 'block',
  warn: 'warn',
  // Rerouting to a local model conflicts with pinned bindings and with EYAS
  // never assuming a local model: the value is masked instead.
  auto_local: 'mask',
}

export interface ConvertedPolicy {
  policy: PrivacyPolicy
  /** Human-readable notes about what the conversion changed or dropped. */
  warnings: string[]
}

/**
 * Converts the legacy `rules` format into a v2 policy with the legacy
 * semantics: for every type the FIRST rule whose pattern matches the whole
 * type name decides, and a type no rule matches is 'warn'. sanitize → mask;
 * auto_local → mask (with a warning); a scanner missing from `scanners` turns
 * its detections off; 'ner' is ignored (with a warning). Rules and custom
 * patterns that cannot be used are dropped with a warning, as before.
 */
export function fromLegacyYaml(input: unknown): ConvertedPolicy {
  const parsed = LegacyPrivacySchema.safeParse(input ?? {})
  if (!parsed.success) {
    throw new PrivacyPolicyValidationError(toPolicyIssues(parsed.error), 'Invalid legacy privacy config')
  }
  const legacy = parsed.data
  const warnings: string[] = []

  const rules: Array<{ test: (type: string) => boolean; action: PrivacyAction; legacy: string }> = []
  for (const rule of legacy.rules) {
    const verdict = checkRegexSafety(rule.pattern)
    if (!verdict.safe) {
      warnings.push(`legacy rule '${rule.pattern}' dropped: ${verdict.reason}`)
      continue
    }
    let re: RegExp
    try {
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp
      // Guarded above; matched against short type names only.
      re = new RegExp(`^(?:${rule.pattern})$`)
    } catch (err) {
      warnings.push(`legacy rule '${rule.pattern}' dropped: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    if (rule.action === 'auto_local') {
      warnings.push(`legacy rule '${rule.pattern}': auto_local is no longer supported and is treated as mask`)
    }
    rules.push({ test: (type) => re.test(type), action: LEGACY_ACTION[rule.action], legacy: rule.action })
  }
  const actionFor = (type: string): PrivacyAction => rules.find((r) => r.test(type))?.action ?? 'warn'

  const scanners = new Set(legacy.scanners)
  if (scanners.has('ner')) {
    warnings.push("the 'ner' scanner no longer exists and is ignored; use custom patterns instead")
  }
  for (const s of scanners) {
    if (s !== 'regex' && s !== 'custom' && s !== 'ner') warnings.push(`unknown scanner '${s}' ignored`)
  }

  const actions = Object.fromEntries(
    BUILTIN_PII_TYPES.map((type) => [type, scanners.has('regex') ? actionFor(type) : 'off']),
  ) as Record<BuiltinPiiType, PrivacyAction>

  const customPatterns: CustomPattern[] = []
  for (const p of legacy.custom_patterns) {
    const type = p.type.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
    const candidate = {
      name: p.name.trim().slice(0, 64),
      regex: p.regex,
      type,
      action: scanners.has('custom') ? actionFor(p.type) : ('off' as const),
    }
    const ok = CustomPatternSchema.safeParse(candidate)
    if (!ok.success) {
      warnings.push(`legacy custom pattern '${p.name}' dropped: ${ok.error.issues.map((i) => i.message).join('; ')}`)
      continue
    }
    customPatterns.push(ok.data)
  }

  const policy = PrivacyPolicySchema.parse({
    enabled: legacy.enabled,
    actions,
    customPatterns: customPatterns.slice(0, MAX_CUSTOM_PATTERNS),
    localHosts: [],
    audit: legacy.audit,
  })
  if (customPatterns.length > MAX_CUSTOM_PATTERNS) {
    warnings.push(`only the first ${MAX_CUSTOM_PATTERNS} legacy custom patterns were kept`)
  }
  return { policy, warnings }
}

// ─── YAML document ──────────────────────────────────────

export interface ParsedPolicyDocument extends ConvertedPolicy {
  format: 'v2' | 'legacy'
}

const LEGACY_KEYS = ['rules', 'scanners', 'custom_patterns'] as const
const V2_KEYS = ['actions', 'customPatterns', 'localHosts'] as const

/**
 * Parses privacy.yaml text (root key `privacy:`) into a validated policy.
 * The v2 shape (actions / customPatterns / localHosts) is validated strictly;
 * a document with only legacy keys (rules / scanners / custom_patterns) is
 * converted with fromLegacyYaml. Throws PrivacyPolicyValidationError.
 */
export function parsePolicyYaml(text: string): ParsedPolicyDocument {
  let doc: unknown
  try {
    doc = parseYaml(text)
  } catch (err) {
    throw new PrivacyPolicyValidationError(
      [{ path: '(root)', code: 'yamlSyntax', message: err instanceof Error ? err.message : String(err) }],
      'privacy.yaml is not valid YAML',
    )
  }
  const root = doc && typeof doc === 'object' ? (doc as Record<string, unknown>).privacy : undefined
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new PrivacyPolicyValidationError(
      [{ path: 'privacy', code: 'missingRoot', message: "the document needs a 'privacy:' mapping at the top level" }],
      'Invalid privacy.yaml',
    )
  }
  const body = root as Record<string, unknown>
  const isLegacy = LEGACY_KEYS.some((k) => k in body) && !V2_KEYS.some((k) => k in body)
  if (isLegacy) return { ...fromLegacyYaml(body), format: 'legacy' }

  const parsed = PrivacyPolicySchema.safeParse(body)
  if (!parsed.success) {
    throw new PrivacyPolicyValidationError(toPolicyIssues(parsed.error), 'Invalid privacy.yaml')
  }
  return { policy: parsed.data, warnings: [], format: 'v2' }
}

/** Stable JSON form of a policy (key order fixed by the schema's output). */
export function policyJson(policy: PrivacyPolicy): string {
  const normalized = PrivacyPolicySchema.parse(policy)
  return JSON.stringify({
    enabled: normalized.enabled,
    actions: Object.fromEntries(BUILTIN_PII_TYPES.map((t) => [t, normalized.actions[t]])),
    customPatterns: normalized.customPatterns.map((p) => ({ name: p.name, regex: p.regex, type: p.type, action: p.action })),
    localHosts: normalized.localHosts,
    audit: normalized.audit,
  })
}

/**
 * The types whose effective action differs between two policies: built-in
 * types by their action, custom types by their set of (regex, action).
 * An enable/disable flip changes every type.
 */
export function changedTypes(before: PrivacyPolicy, after: PrivacyPolicy): string[] {
  const changed = new Set<string>()
  const allCustom = (p: PrivacyPolicy) => new Set(p.customPatterns.map((c) => c.type))
  if (before.enabled !== after.enabled) {
    for (const t of BUILTIN_PII_TYPES) changed.add(t)
    for (const t of allCustom(before)) changed.add(t)
    for (const t of allCustom(after)) changed.add(t)
    return [...changed].sort()
  }
  for (const t of BUILTIN_PII_TYPES) {
    if (before.actions[t] !== after.actions[t]) changed.add(t)
  }
  const signature = (p: PrivacyPolicy, type: string) =>
    JSON.stringify(p.customPatterns.filter((c) => c.type === type).map((c) => [c.regex, c.action]))
  for (const t of new Set([...allCustom(before), ...allCustom(after)])) {
    if (signature(before, t) !== signature(after, t)) changed.add(t)
  }
  return [...changed].sort()
}
