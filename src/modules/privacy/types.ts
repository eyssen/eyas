// Part of eYssen. See LICENSE file for full copyright and licensing details.

// ─── PII Detection ───────────────────────────────────

export interface PiiMatch {
  type: string          // 'personal_id' | 'tax_number' | 'iban' | 'email' | 'phone' | 'credit_card' | 'ssn' | 'custom'
  value: string         // The detected sensitive data
  start: number         // Position in text
  end: number
  confidence: number    // 0-1
  scanner: string       // Which scanner found it
}

export interface PiiScanner {
  id: string
  scan(text: string): Promise<PiiMatch[]>
}

// ─── Policy Engine ───────────────────────────────────

export type PolicyAction = 'auto_local' | 'warn' | 'block' | 'sanitize'

export interface PolicyRule {
  pattern: string       // regex matching PII type: 'personal_id|tax_number|iban'
  action: PolicyAction
}

export interface PolicyResult {
  blocked: boolean
  reason?: string
  sanitizedText?: string
  warnings: string[]
  routeToLocal: boolean
  matches: PiiMatch[]
  actions: Map<string, PolicyAction>
}

// ─── Config ──────────────────────────────────────────

export interface CustomPatternConfig {
  name: string
  regex: string
  type: string
  confidence: number
}

export interface PrivacyConfig {
  enabled: boolean
  scanners: string[]
  rules: PolicyRule[]
  custom_patterns: CustomPatternConfig[]
  audit: boolean
}

// ─── Stats ───────────────────────────────────────────

export interface PrivacyStats {
  totalScans: number
  totalDetections: number
  detectionsByType: Record<string, number>
  detectionsByAction: Record<string, number>
}
