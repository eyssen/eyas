// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Manifest describing the email-triage agent template.
 *
 * Kept minimal so the template can be merged into the agent module's
 * template registry (see {@link ../../agent/agent-templates.ts}) without
 * requiring schema changes.
 */
export const emailTriageManifest = {
  id: 'email-triage',
  name: 'Email Triage',
  version: '0.1.0',
  author: 'eYssen',
  description:
    'Classifies inbound emails into action buckets (archive / quick-reply / todo / escalate / delegate), drafts short replies, and routes everything else for human review.',
  defaultEnabled: false,
  /** Event bus topics this template subscribes to. */
  subscribes: ['email.received'] as const,
  /**
   * Declarative dependency on the Phase 2 email adapter. Until that module
   * ships, a fixture-backed simulator can emit `email.received` events for
   * development.
   */
  requires: ['communication/email'] as const,
  /**
   * Schema hook: when persistence lands, compiled rules will be stored in
   * a table whose logical shape is defined by {@link CompiledRule}. This
   * field exists so the setup wizard knows what migration to run.
   */
  storage: {
    rules: 'email_triage_rules',
  },
} as const

export type EmailTriageManifest = typeof emailTriageManifest
