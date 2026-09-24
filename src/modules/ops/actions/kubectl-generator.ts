// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Diagnosis, Incident, ProposalPayload, Runbook } from '../types.js'

/**
 * Allow-list of kubectl sub-commands we will ever PROPOSE. Write/destructive
 * verbs are deliberately not listed — mutations should go through gitops-pr.
 * Apply is NOT here either: even for read-only commands, apply is the act of
 * shelling out, which happens in a different module with explicit approval.
 */
const ALLOWED_KUBECTL_COMMANDS = new Set([
  'logs',
  'describe',
  'get',
  'top',
  'events',
  'rollout', // rollout status is read-only; caller must set args accordingly
  'explain',
])

/**
 * Flag names (lowercased, leading dashes stripped) that override kubectl's
 * effective identity or connection target. Even though verbs are read-only
 * (get/describe/logs/...), any of these flags let a crafted runbook arg — or
 * an attacker-influenced incident field interpolated into an arg — read as a
 * different user/cluster or point at attacker-controlled infra (M-3).
 */
const DENIED_FLAG_NAMES = new Set([
  'as',
  'as-group',
  'as-uid',
  'kubeconfig',
  'token',
  'server',
  's', // kubectl short form of --server
  'username',
  'password',
  'u', // kubectl short form of --username
  'client-certificate',
  'client-key',
  'certificate-authority',
  'insecure-skip-tls-verify',
  'tls-server-name',
  'cluster',
  'context',
  'user',
  'password-stdin',
  'cache-dir',
])

/**
 * Kubectl args allow-list. Rejects anything that could be injected as a new
 * flag or shell metacharacter. This is a belt-and-suspenders check — the
 * executor never uses a shell — but gives us a clean diff at proposal time.
 */
function sanitizeArg(arg: string): string | null {
  if (typeof arg !== 'string') return null
  if (arg.length === 0) return null
  if (arg.length > 256) return null
  // Disallow characters that have meaning to /bin/sh. Even though we never
  // pass through a shell, this prevents humans copy-pasting a proposal into
  // a terminal and getting surprised.
  if (/[;&|`$<>\n\r\\"]/.test(arg)) return null
  // Only flags (tokens starting with '-') carry a flag name to check against
  // the denylist. A positional value (e.g. a selector value like `app=web`)
  // never starts with '-' and is left alone even if it contains '='.
  if (arg.startsWith('-')) {
    const eqIdx = arg.indexOf('=')
    const flagToken = eqIdx === -1 ? arg : arg.slice(0, eqIdx)
    const flagName = flagToken.replace(/^-+/, '').toLowerCase()
    if (DENIED_FLAG_NAMES.has(flagName)) return null
  }
  return arg
}

/**
 * Interpolate `{{var}}` placeholders against incident context.
 */
function interpolate(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_, key: string) => {
    return ctx[key] ?? `{{${key}}}`
  })
}

export interface KubectlProposalOptions {
  /** Optional override for the runbook's command (not commonly used). */
  commandOverride?: string
}

/**
 * Build a kubectl-flavoured ProposalPayload from a runbook + incident.
 * Does NOT shell out — only produces the payload.
 */
export function buildKubectlProposal(
  incident: Incident,
  runbook: Runbook,
  _diagnosis: Diagnosis,
  opts: KubectlProposalOptions = {},
): ProposalPayload {
  const command = (opts.commandOverride ?? runbook.suggestedAction.command ?? '').trim()
  if (!command) throw new Error('kubectl proposal: runbook has no command')
  if (!ALLOWED_KUBECTL_COMMANDS.has(command)) {
    throw new Error(`kubectl proposal: command '${command}' is not in the propose-allow-list`)
  }

  const ctx: Record<string, string> = {
    namespace: incident.namespace,
    resource: incident.resource,
    pod: String(incident.details.pod ?? ''),
    ...Object.fromEntries(
      Object.entries(incident.details).filter(([, v]) => typeof v !== 'object' && v != null).map(
        ([k, v]) => [k, String(v)],
      ),
    ),
  }

  const rawArgs = runbook.suggestedAction.args ?? []
  const interpolated = rawArgs.map((a) => interpolate(a, ctx))
  const sanitized: string[] = []
  for (const a of interpolated) {
    const ok = sanitizeArg(a)
    if (ok === null) {
      throw new Error(`kubectl proposal: argument '${a}' rejected by sanitizer`)
    }
    sanitized.push(ok)
  }

  return {
    command: `kubectl ${command}`,
    args: sanitized,
    summary: `Run: kubectl ${command} ${sanitized.join(' ')}`,
  }
}

export { ALLOWED_KUBECTL_COMMANDS, sanitizeArg }
