// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Email triage types.
 *
 * These types describe the shape of data flowing through the email triage
 * agent template. They are intentionally self-contained (no imports from
 * other modules) so the template can be reused in tests and in the future
 * Phase 2 email adapter without creating a circular dependency.
 */

/** Action bucket an email can be sorted into. */
export type TriageBucket =
  | 'archive'
  | 'quick-reply'
  | 'todo'
  | 'escalate'
  | 'delegate'

/**
 * A normalized inbound email. The Phase 2 IMAP / Microsoft Graph adapter is
 * responsible for producing objects of this shape from provider-specific
 * payloads.
 */
export interface InboundEmail {
  /** Stable, provider-independent message id (UUID or RFC 5322 Message-ID). */
  id: string
  /** RFC 5322 From header value (address only, lowercased is fine). */
  from: string
  /** RFC 5322 To header values. */
  to: string[]
  /** RFC 5322 Cc header values. */
  cc?: string[]
  /** Subject line. */
  subject: string
  /** Plain-text body. HTML should be converted upstream. */
  body: string
  /** Optional In-Reply-To header (for reply detection). */
  inReplyTo?: string
  /** Optional References header (conversation thread chain). */
  references?: string[]
  /** Arbitrary header bag for rules that peek at bulk / list markers. */
  headers?: Record<string, string>
  /** RFC 3339 timestamp. */
  receivedAt: string
}

/**
 * Event emitted by the future Phase 2 email adapter onto the event bus.
 * The triage agent template subscribes to this event.
 */
export interface EmailReceivedEvent {
  type: 'email.received'
  email: InboundEmail
  /** Mailbox identifier so multi-account setups route correctly. */
  mailboxId: string
}

/** A single matcher clause inside a compiled rule. */
export interface RuleMatcherClause {
  contains?: string
  equals?: string
  /** Regex-like pattern stored as string; compiled lazily. */
  regexIsh?: string
  caseInsensitive?: boolean
}

export interface CompiledRuleMatcher {
  from?: RuleMatcherClause
  to?: RuleMatcherClause
  subject?: RuleMatcherClause
  body?: RuleMatcherClause
  /** Header key → matcher (e.g. "List-Unsubscribe"). */
  header?: Record<string, RuleMatcherClause>
}

export interface CompiledRuleAction {
  type: TriageBucket
  /** For delegate: recipient. */
  to?: string
  /** Optional free-form template hint for the drafter. */
  template?: string
  /** Optional target board / project for todo. */
  boardId?: string
}

export interface CompiledRule {
  id: string
  label: string
  matcher: CompiledRuleMatcher
  action: CompiledRuleAction
  /** Higher priority rules are evaluated first. Default 0. */
  priority?: number
  /** Source natural-language rule, stored for audit. */
  source?: string
  createdAt: string
}

export interface ClassificationResult {
  bucket: TriageBucket
  /** Value in [0, 1]. */
  confidence: number
  /** One-sentence rationale. */
  reason: string
  /** Present when bucket === 'quick-reply'. */
  suggestedDraft?: string
  /** Present when bucket === 'delegate'. */
  suggestedDelegate?: string
  /** Which rule matched (if deterministic). */
  matchedRuleId?: string
  /** True if the LLM fallback produced this result. */
  fromLLM?: boolean
}

/**
 * The next step decided by the action router. The agent runner is expected
 * to consume this and actually perform the side effect (send, archive, etc.).
 */
export type TriageAction =
  | {
      kind: 'archive'
      emailId: string
      reason: string
    }
  | {
      kind: 'quick-reply'
      emailId: string
      draft: string
      requiresApproval: true
      reason: string
    }
  | {
      kind: 'todo'
      emailId: string
      title: string
      body: string
      reason: string
    }
  | {
      kind: 'escalate'
      emailId: string
      reason: string
      confidence: number
    }
  | {
      kind: 'delegate'
      emailId: string
      to: string
      note: string
      reason: string
    }

/** Minimal LLM client contract so tests can inject a mock. */
export interface LLMClient {
  complete(args: {
    system: string
    user: string
    temperature?: number
  }): Promise<string>
}

/** Pluggable store for compiled rules. Phase-2 swap: swap for a DB store. */
export interface RuleStore {
  list(): Promise<CompiledRule[]>
  add(rule: CompiledRule): Promise<void>
  remove(id: string): Promise<void>
  clear(): Promise<void>
}

export class RuleCompilationError extends Error {
  constructor(
    message: string,
    public readonly raw?: string
  ) {
    super(message)
    this.name = 'RuleCompilationError'
  }
}
