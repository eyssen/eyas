// Part of eYssen. See LICENSE file for full copyright and licensing details.

// ─── PII Detection ───────────────────────────────────

/**
 * The PII types the built-in regex scanner detects. Custom patterns add
 * their own type slugs on top of these.
 */
export const BUILTIN_PII_TYPES = [
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

export type BuiltinPiiType = (typeof BUILTIN_PII_TYPES)[number]

export interface PiiMatch {
  type: string          // a BuiltinPiiType, or a custom pattern's type slug
  value: string         // The detected sensitive data
  start: number         // Position in text
  end: number
  confidence: number    // 0-1
  scanner: string       // Which scanner found it ('regex' | 'custom')
}

/**
 * A deterministic, synchronous PII scanner. The scanner chain feeds it one
 * line at a time, so a match never spans a line break.
 */
export interface PiiScanner {
  id: string
  scan(text: string): PiiMatch[]
}

// ─── Custom patterns ─────────────────────────────────

/**
 * Input of the custom scanner. The policy (policy.ts) owns the validated
 * shape and each pattern's action; confidence only breaks overlap ties.
 */
export interface CustomPatternConfig {
  name: string
  regex: string
  type: string
  confidence: number
}

// ─── Stats ───────────────────────────────────────────

/**
 * What the privacy layer did to real traffic since the server started (in
 * memory; a restart resets it). The scan tester is never counted.
 */
export interface PrivacyStats {
  /** When these counters started (ISO timestamp of the service start). */
  since: string
  /**
   * Outgoing payloads scanned for a REMOTE destination: model calls (every
   * attempt), embeddings, and memory tool results sent past the gateway (CLI
   * bridges, external MCP, OpenCode). A local destination is not scanned and
   * not counted.
   */
  egress: {
    calls: number
    /** Calls in which at least one value was masked. */
    maskedCalls: number
    /** Detections per type (masked and warned). */
    byType: Record<string, number>
  }
  /** NEW user messages checked at ingress (chat, God Mode, channels). */
  inbound: {
    checked: number
    /** Messages refused because of a block-class value. */
    refused: number
    /** Refused messages the sender then sent with those values masked. */
    masked: number
  }
  /** Detections per scanner ('regex' | 'custom') across egress and ingress. */
  byScanner: Record<string, number>
}
