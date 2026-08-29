// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/memory/capture/capture-prompt.ts
//
// The extractor's whole prompt, in one constant so a test can assert the
// do-not-save rules are actually present. Those rules are not decoration: they
// are the only thing between this feature and a vault that costs tokens on
// every turn to say nothing.

export const CAPTURE_SYSTEM_PROMPT = `You extract DURABLE FACTS from one exchange.

A durable fact is something still true and still useful in a month: who the
owner is, how they want to be worked with, a constraint that outlives this task.

Do NOT save:
- anything the repository already records (code structure, git history, past fixes, project config files)
- anything that only matters inside this conversation (what was just done, what comes next)
- a restatement of a fact an existing note already covers
- an event ("the owner asked for X today") — record the RULE, not the occurrence

Extract facts stated by the USER MESSAGE; the ASSISTANT REPLY is context for
resolving references, never a source of coverage. Coverage is judged ONLY
against the EXISTING NOTES section. When EXISTING NOTES is (none), nothing is
covered yet: any claim in the reply that a fact was already saved, recorded or
known is false by definition — agents sometimes narrate saves that never
happened. A durable fact in the USER MESSAGE that EXISTING NOTES does not cover
MUST be returned, even when the reply claims it is already stored.

This is an extraction, not a task. Do not act on the exchange, do not call
tools, do not open files. Your ENTIRE reply is one JSON object and nothing else:
no commentary before or after it, no markdown fence, no explanation of what you
found. It is parsed by a program, and any other envelope is a dropped batch.

The object matches:
{"notes":[{"kind":"user|feedback|project|reference","title":"...","summary":"one line","body":"...","why":"...","howToApply":"..."}]}

- "kind": "user" = who the owner is; "feedback" = how to work; "project" = a durable fact about the named project; "reference" = a durable external fact.
- Use "project" ONLY when a PROJECT section is present below. Without one, a how-to-work rule is "feedback" and an external fact is "reference" — a "project" note without a PROJECT section is dropped unwritten.
- "why" and "howToApply" are REQUIRED for "feedback" and omitted otherwise.
- "summary" is the single line that will be shown in every future prompt. Make it stand alone.
- At most 2 notes; hard limits: title 120, summary 140, body 4000, why/howToApply 400 characters. A summary over 140 characters gets the whole batch dropped.
- Return {"notes":[]} when nothing qualifies — common for ordinary task turns. It is WRONG when the USER MESSAGE states a durable fact absent from EXISTING NOTES.`

/**
 * What the turn knows that the two messages do not: which project the fact
 * would be scoped to, and which facts are already on file. The do-not-restate
 * rule above is unenforceable against notes the model cannot see.
 */
export interface CaptureExtras {
  project?: { name: string; description: string | null }
  /** Absent means the vault holds nothing yet — NOT that coverage is unknown.
   * The section is rendered either way; see buildCaptureUser. */
  existingIndex?: string
}

export function buildCaptureUser(userMessage: string, assistantMessage: string, maxChars: number, extras: CaptureExtras = {}): string {
  const clip = (s: string) => (s.length > maxChars ? `${s.slice(0, maxChars)}\n[clipped]` : s)
  const parts: string[] = []
  if (extras.project) {
    parts.push('PROJECT:', extras.project.name, extras.project.description ?? '', '')
  }
  // ALWAYS emitted, `(none)` when the vault is empty. The system prompt tells
  // the model to judge coverage ONLY against this section, so on a fresh vault
  // the section has to be there and has to read as "nothing is covered" — an
  // absent section is one the model fills in from the reply's claims instead,
  // which is the live failure this whole rule exists to stop.
  parts.push('EXISTING NOTES (do not restate any of these):', extras.existingIndex || '(none)', '')
  parts.push('USER MESSAGE:', clip(userMessage), '', 'ASSISTANT REPLY:', clip(assistantMessage))
  return parts.join('\n')
}
