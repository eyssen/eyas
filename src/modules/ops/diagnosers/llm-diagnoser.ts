// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { Diagnosis, Incident } from '../types.js'

/**
 * Minimal contract we need from a model. Decoupled from @modules/model so
 * tests can stub it with a plain `{ complete: (_) => 'stub' }`.
 */
export interface LlmClient {
  /**
   * Ask the model for a root-cause analysis given an incident prompt.
   * Returns the raw completion text; the diagnoser parses it into a
   * Diagnosis object.
   */
  complete(prompt: string): Promise<string>
}

/**
 * Build the operator prompt for LLM-assisted diagnosis. Deliberately
 * concise — the loop always prefers runbook matches over LLM output, so the
 * LLM is the fallback path.
 */
export function buildDiagnosisPrompt(incident: Incident): string {
  return [
    `You are an SRE assistant. An incident was observed:`,
    ``,
    `Source: ${incident.source}`,
    `Kind: ${incident.kind}`,
    `Severity: ${incident.severity}`,
    `Namespace: ${incident.namespace}`,
    `Resource: ${incident.resource}`,
    `Summary: ${incident.summary}`,
    ``,
    `Details (JSON):`,
    JSON.stringify(incident.details, null, 2),
    ``,
    `Respond with a short plain-text root cause analysis (2-4 sentences).`,
    `Do not propose commands — proposal is handled separately.`,
  ].join('\n')
}

/**
 * Fallback diagnoser that asks a model when no runbook matches.
 *
 * Contract: the injected LlmClient must be backed by the background model
 * service (ctx.auxiliaryModel.completeText, with an AuxPurpose added for it
 * when it is wired), never by the model gateway directly. Nothing wires it
 * today: ops/index.ts passes no `llm`, so runbooks are the only diagnoser.
 */
export function createLlmDiagnoser(client: LlmClient) {
  return async function diagnose(incident: Incident): Promise<Diagnosis> {
    const prompt = buildDiagnosisPrompt(incident)
    let text: string
    try {
      text = await client.complete(prompt)
    } catch (err) {
      return {
        incidentId: incident.id,
        source: 'none',
        rootCause: 'llm-diagnoser-error',
        confidence: 0,
        explanation: `LLM diagnoser failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    const trimmed = (text ?? '').trim()
    return {
      incidentId: incident.id,
      source: 'llm',
      rootCause: trimmed.split('\n')[0]?.slice(0, 200) ?? 'unknown',
      confidence: 0.5,
      explanation: trimmed.length > 0 ? trimmed : 'LLM returned empty response.',
    }
  }
}
