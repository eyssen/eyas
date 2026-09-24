// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Pure logic of the Privacy page: the policy API's shapes, policy ↔ editor
// form mapping, dirty detection, the server's validation issues → i18n keys,
// and tolerant parsers for the stats and scan-tester answers (a missing field
// reads as zero or empty, never as a crash). No React, no i18n lookups.

export const PRIVACY_ACTIONS = ['off', 'warn', 'mask', 'block'] as const
export type PrivacyAction = (typeof PRIVACY_ACTIONS)[number]

/** The built-in types, in the server's order — used only when an answer omits builtinTypes. */
export const DEFAULT_BUILTIN_TYPES = [
  'email',
  'phone',
  'iban',
  'bank_account',
  'credit_card',
  'ssn',
  'personal_id',
  'tax_number',
  'taj_number',
] as const

export type PolicySource = 'yaml' | 'ui' | 'defaults'

export interface CustomPatternDto {
  name: string
  regex: string
  type: string
  action: PrivacyAction
}

export interface PrivacyPolicyDto {
  enabled: boolean
  actions: Record<string, PrivacyAction>
  customPatterns: CustomPatternDto[]
  localHosts: string[]
  audit: boolean
}

/** GET/PUT /privacy/policy. */
export interface PolicyResponse {
  policy: PrivacyPolicyDto
  version: number
  source: PolicySource
  seedError: string | null
  updatedAt: string | null
  rulesetVersion: string
  builtinTypes: string[]
  limits: { customPatterns: number; localHosts: number }
  canManage: boolean
}

/** A custom pattern row in the editor; `key` only keeps React rows stable. */
export interface CustomPatternRow extends CustomPatternDto {
  key: string
}

export interface PolicyForm {
  enabled: boolean
  actions: Record<string, PrivacyAction>
  customPatterns: CustomPatternRow[]
  localHosts: string[]
  audit: boolean
}

export function isPrivacyAction(value: unknown): value is PrivacyAction {
  return typeof value === 'string' && (PRIVACY_ACTIONS as readonly string[]).includes(value)
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function countMap(v: unknown): Record<string, number> {
  if (!isRecord(v)) return {}
  const out: Record<string, number> = {}
  for (const [k, n] of Object.entries(v)) {
    if (typeof n === 'number' && Number.isFinite(n)) out[k] = n
  }
  return out
}

function parsePolicy(v: unknown): PrivacyPolicyDto | null {
  if (!isRecord(v) || !isRecord(v.actions)) return null
  const actions: Record<string, PrivacyAction> = {}
  for (const [type, action] of Object.entries(v.actions)) {
    if (isPrivacyAction(action)) actions[type] = action
  }
  const customPatterns = Array.isArray(v.customPatterns)
    ? v.customPatterns.filter(isRecord).map((p) => ({
        name: str(p.name),
        regex: str(p.regex),
        type: str(p.type),
        action: isPrivacyAction(p.action) ? p.action : ('mask' as const),
      }))
    : []
  const localHosts = Array.isArray(v.localHosts) ? v.localHosts.filter((h): h is string => typeof h === 'string') : []
  return { enabled: v.enabled !== false, actions, customPatterns, localHosts, audit: v.audit !== false }
}

/** Parses a GET/PUT /privacy/policy answer; null when it carries no usable policy. */
export function parsePolicyResponse(raw: unknown): PolicyResponse | null {
  if (!isRecord(raw)) return null
  const policy = parsePolicy(raw.policy)
  if (!policy) return null
  const source = raw.source === 'yaml' || raw.source === 'ui' || raw.source === 'defaults' ? raw.source : 'defaults'
  const builtinTypes = Array.isArray(raw.builtinTypes) && raw.builtinTypes.every((t) => typeof t === 'string')
    ? (raw.builtinTypes as string[])
    : [...DEFAULT_BUILTIN_TYPES]
  const limits = isRecord(raw.limits) ? raw.limits : {}
  return {
    policy,
    version: num(raw.version),
    source,
    seedError: typeof raw.seedError === 'string' && raw.seedError ? raw.seedError : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    rulesetVersion: str(raw.rulesetVersion),
    builtinTypes,
    limits: {
      customPatterns: num(limits.customPatterns) || 50,
      localHosts: num(limits.localHosts) || 32,
    },
    canManage: raw.canManage === true,
  }
}

let rowSeq = 0
/** A fresh React key for a custom pattern row. */
export function newRowKey(): string {
  rowSeq += 1
  return `pattern-${rowSeq}`
}

/** The editor form for a policy: every built-in type gets a row ('warn' when the answer lacks it, as the server treats it). */
export function policyToForm(policy: PrivacyPolicyDto, builtinTypes: readonly string[]): PolicyForm {
  const actions: Record<string, PrivacyAction> = {}
  for (const type of builtinTypes) actions[type] = policy.actions[type] ?? 'warn'
  return {
    enabled: policy.enabled,
    actions,
    customPatterns: policy.customPatterns.map((p) => ({ ...p, key: newRowKey() })),
    localHosts: [...policy.localHosts],
    audit: policy.audit,
  }
}

/** The PUT body for a form: names and types trimmed (types lower-case), hosts canonical and unique. */
export function formToPolicy(form: PolicyForm): PrivacyPolicyDto {
  const actions: Record<string, PrivacyAction> = {}
  for (const type of Object.keys(form.actions).sort()) actions[type] = form.actions[type]
  const hosts: string[] = []
  for (const raw of form.localHosts) {
    const host = raw.trim().toLowerCase()
    if (host && !hosts.includes(host)) hosts.push(host)
  }
  return {
    enabled: form.enabled,
    actions,
    customPatterns: form.customPatterns.map((p) => ({
      name: p.name.trim(),
      regex: p.regex,
      type: p.type.trim().toLowerCase(),
      action: p.action,
    })),
    localHosts: hosts,
    audit: form.audit,
  }
}

/** True when saving the form would change the policy. */
export function isDirty(form: PolicyForm, baseline: PolicyForm): boolean {
  return JSON.stringify(formToPolicy(form)) !== JSON.stringify(formToPolicy(baseline))
}

// ─── Local hosts ──────────────────────────────────────────

/**
 * A plausible host for the local-hosts list, lower-case — or null for input
 * the server will surely refuse (a scheme, port, path, user info, wildcard
 * or space). The server makes the final, canonical check.
 */
export function normalizeHostInput(raw: string): string | null {
  let host = raw.trim().toLowerCase()
  if (!host || host.length > 253) return null
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host.includes(':')) {
    // IPv6 only: at least two colons and nothing but hex digits, dots and colons.
    return (host.match(/:/g) ?? []).length >= 2 && /^[0-9a-f:.]+$/.test(host) ? host : null
  }
  if (!/^[a-z0-9.-]+$/.test(host)) return null
  if (host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null
  return host
}

export type AddHostResult = { ok: true; hosts: string[] } | { ok: false; reason: 'invalid' | 'duplicate' | 'tooMany' }

export function addLocalHost(hosts: readonly string[], raw: string, max: number): AddHostResult {
  const host = normalizeHostInput(raw)
  if (!host) return { ok: false, reason: 'invalid' }
  if (hosts.includes(host)) return { ok: false, reason: 'duplicate' }
  if (hosts.length >= max) return { ok: false, reason: 'tooMany' }
  return { ok: true, hosts: [...hosts, host] }
}

// ─── Validation issues ────────────────────────────────────

/** One issue of a refused PUT (400 invalid_policy): dotted path, code and English message. */
export interface PolicyIssue {
  path: string
  code: string
  message: string
}

/** The issues of a 400 invalid_policy body (the ApiError's details); empty for anything else. */
export function parsePolicyIssues(body: unknown): PolicyIssue[] {
  if (!isRecord(body) || body.code !== 'invalid_policy' || !Array.isArray(body.issues)) return []
  return body.issues
    .filter(isRecord)
    .map((i) => ({ path: str(i.path) || '(root)', code: str(i.code), message: str(i.message) }))
}

const ARRAY_PATHS = new Set(['customPatterns', 'localHosts'])

/** The i18n key that explains one issue. */
export function issueKey(issue: PolicyIssue): string {
  switch (issue.code) {
    case 'unsafeRegex':
      return 'privacy.error.unsafeRegex'
    case 'invalidRegex':
      return 'privacy.error.invalidRegex'
    case 'invalidHost':
      return 'privacy.error.invalidHost'
    case 'invalid_enum_value':
      return 'privacy.error.unknownAction'
    case 'too_big':
      return ARRAY_PATHS.has(issue.path) ? 'privacy.error.tooMany' : 'privacy.error.tooLong'
    case 'too_small':
      return 'privacy.error.required'
    case 'invalid_string':
      return 'privacy.error.invalidType'
    default:
      return 'privacy.error.invalid'
  }
}

/** Paths the editor shows next to their own field. */
const FIELD_PATH = /^(actions\.[a-z0-9_]+|customPatterns\.\d+\.(name|regex|type|action)|localHosts\.\d+|customPatterns|localHosts)$/

export interface SplitIssues {
  /** Field path → i18n key (the first issue per path). */
  fields: Record<string, string>
  /** Issues with no field of their own, as i18n keys (unique). */
  general: string[]
}

export function splitIssues(issues: readonly PolicyIssue[]): SplitIssues {
  const fields: Record<string, string> = {}
  const general: string[] = []
  for (const issue of issues) {
    const key = issueKey(issue)
    if (FIELD_PATH.test(issue.path)) {
      if (!(issue.path in fields)) fields[issue.path] = key
    } else if (!general.includes(key)) {
      general.push(key)
    }
  }
  return { fields, general }
}

// ─── Stats ────────────────────────────────────────────────

/** GET /privacy/stats, with every field present. */
export interface StatsView {
  since: string | null
  egress: { calls: number; maskedCalls: number; byType: Record<string, number> }
  inbound: { checked: number; refused: number; masked: number }
  byScanner: Record<string, number>
}

export function parseStats(raw: unknown): StatsView {
  const r = isRecord(raw) ? raw : {}
  const egress = isRecord(r.egress) ? r.egress : {}
  const inbound = isRecord(r.inbound) ? r.inbound : {}
  return {
    since: typeof r.since === 'string' && r.since ? r.since : null,
    egress: { calls: num(egress.calls), maskedCalls: num(egress.maskedCalls), byType: countMap(egress.byType) },
    inbound: { checked: num(inbound.checked), refused: num(inbound.refused), masked: num(inbound.masked) },
    byScanner: countMap(r.byScanner),
  }
}

/** Entries of a count map, largest first, then by name. */
export function sortedCounts(map: Record<string, number>): Array<[string, number]> {
  return Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

// ─── Scan tester ──────────────────────────────────────────

export interface ScanMatchView {
  type: string
  start: number
  end: number
  scanner: string
  action: Exclude<PrivacyAction, 'off'>
}

/** POST /privacy/scan, with every field present. */
export interface ScanView {
  enabled: boolean
  rulesetVersion: string
  matches: ScanMatchView[]
  inbound: { refused: boolean; types: string[] }
  egressPreview: string
}

export function parseScan(raw: unknown): ScanView {
  const r = isRecord(raw) ? raw : {}
  const inbound = isRecord(r.inbound) ? r.inbound : {}
  const matches = Array.isArray(r.matches)
    ? r.matches.filter(isRecord).flatMap((m): ScanMatchView[] => {
        const action = m.action
        if (action !== 'warn' && action !== 'mask' && action !== 'block') return []
        return [{ type: str(m.type), start: num(m.start), end: num(m.end), scanner: str(m.scanner), action }]
      })
    : []
  return {
    enabled: r.enabled !== false,
    rulesetVersion: str(r.rulesetVersion),
    matches,
    inbound: {
      refused: inbound.refused === true,
      types: Array.isArray(inbound.types) ? inbound.types.filter((t): t is string => typeof t === 'string') : [],
    },
    egressPreview: str(r.egressPreview),
  }
}
