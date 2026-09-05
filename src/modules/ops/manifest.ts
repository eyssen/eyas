// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { EyasModule } from '@core/types'

/**
 * Ops-agent module manifest.
 *
 * Kubernetes ops agent: observes cluster + application telemetry,
 * diagnoses anomalies against a runbook catalog, and PROPOSES remediations.
 * Defaults to propose-only — no direct apply without explicit operator
 * approval, even for low severity. Signed-metrics integration is mandatory:
 * unverified telemetry is suppressed, never acted on.
 */
export const opsManifest: Pick<
  EyasModule,
  'id' | 'name' | 'version' | 'type' | 'required' | 'description' | 'dependencies' | 'optional' | 'capabilities'
> = {
  id: 'ops',
  name: 'Ops Agent',
  version: '0.1.0',
  type: 'extra',
  required: false,
  description:
    'Kubernetes ops agent. Observe → diagnose → propose → approve → apply. GitOps-first, signed-metrics gated.',
  dependencies: [],
  optional: ['observability', 'security-gate', 'audit'],
  capabilities: ['incident-triage', 'runbook-matching', 'gitops-proposal'],
}
