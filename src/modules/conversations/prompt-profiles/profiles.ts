// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { PromptFamily, PromptProfile, PromptTaskType } from './types.js'

export const PROFILES: Record<PromptFamily, PromptProfile> = {
  claude: {
    family: 'claude',
    displayName: 'Claude',
    structureHint:
      'Prefer XML tags for sections (<role>, <task>, <context>, <instructions>, <examples>, <output_format>, <constraints>). Nest when needed.',
    techniques: [
      'Be clear and direct; specify desired output format and constraints explicitly.',
      'Add motivation/context for rules ("why") so the model generalizes correctly.',
      'Use 3–5 diverse, realistic <example> blocks when format or tone matters.',
      'For long inputs: put documents first, query/instructions last; wrap docs in <document> tags.',
      'Give a role in a short system/role section.',
      'For tool/agent work: use explicit action verbs ("Change…", "Implement…") not soft suggestions ("Can you suggest…").',
      'Prefer positive instructions ("Write in flowing prose") over only prohibitions.',
      'Ask the model to ground long-doc answers in quotes before concluding when relevant.',
    ],
    antiPatterns: [
      'Vague one-liners without success criteria.',
      'Contradictory rules that force reconciling effort.',
      'Over-prompting tool use ("MUST always use X") on modern Claude — causes over-triggering.',
      'Asking for suggestions when implementation is intended.',
    ],
    skeleton: `<role>…</role>
<task>…</task>
<context>…</context>
<instructions>
1. …
2. …
</instructions>
<output_format>…</output_format>
<constraints>…</constraints>
<!-- optional -->
<examples>
  <example>…</example>
</examples>`,
  },

  openai: {
    family: 'openai',
    displayName: 'OpenAI / GPT',
    structureHint:
      'Use clear XML-style sections or markdown headings. Keep instructions non-contradictory and steerable (eagerness, verbosity, persistence).',
    techniques: [
      'Surgical instruction following: resolve every contradiction before shipping the prompt.',
      'Calibrate agentic eagerness: either persistence (keep going until done) or bounded context-gathering with early-stop criteria.',
      'For agents: tool preambles (plan → narrate steps → summarize), clear stop conditions, safe vs unsafe actions.',
      'Specify verbosity and reasoning depth when relevant (brief status vs thorough code).',
      'For coding: prefer clear names, match existing codebase style, minimal scope, verify thoroughly.',
      'Decompose multi-part requests into explicit sub-tasks the model must complete before yielding.',
      'Use structured sections the model can reference consistently across long runs.',
    ],
    antiPatterns: [
      'Contradictory rules (e.g. "always confirm" + "never ask").',
      'Vague scope that causes endless exploration or premature hand-back.',
      'Mixed "be thorough" + "be fast" without priority hierarchy.',
    ],
    skeleton: `<role>…</role>
<task>…</task>
<context>…</context>
<instructions>
…
</instructions>
<persistence>
# optional: keep going until fully done / or bound exploration
…
</persistence>
<output_format>…</output_format>
<constraints>…</constraints>`,
  },

  gemini: {
    family: 'gemini',
    displayName: 'Gemini',
    structureHint:
      'Be precise and direct. Use consistent XML tags OR markdown headings (pick one). Put large context first; task last.',
    techniques: [
      'Precise, concise instructions — avoid persuasive or fluffy language.',
      'Define ambiguous parameters explicitly.',
      'Prioritize role, constraints, and output format early (system / top of prompt).',
      'Long context: supply all data first, then a transition ("Based on the above…"), then the task.',
      'Control verbosity explicitly (Gemini defaults to concise).',
      'Few-shot examples with identical formatting when format matters.',
      'For agents: plan → execute → validate; state risk levels for write vs read actions.',
      'Treat multimodal inputs as first-class and reference each modality clearly.',
    ],
    antiPatterns: [
      'Verbose, rhetorical prompts that dilute the task.',
      'Mixing XML and markdown structure inconsistently.',
      'Putting the question before a large document dump.',
      'Assuming detailed narration without requesting it.',
    ],
    skeleton: `<role>…</role>
<constraints>
- …
</constraints>
<context>
…
</context>
<task>
…
</task>
<output_format>
…
</output_format>`,
  },

  grok: {
    family: 'grok',
    displayName: 'Grok',
    structureHint:
      'Markdown headers or XML sections. Surgical context (only relevant files/snippets). Optimize for iterative, agentic multi-step work.',
    techniques: [
      'Specific goals beat vague ones — name endpoints, fields, constraints, success criteria.',
      'Structure context: Current Implementation / Requirements / Available Dependencies.',
      'Think agentic: multi-step exploration and tool use, not pure one-shot Q&A.',
      'Prefer iteration-friendly prompts: clear first target, then refinement hooks.',
      'Point to exact files/sections rather than dumping whole codebases.',
      'For research/multi-agent: set scope dimensions and demand structured output.',
    ],
    antiPatterns: [
      'Entire-repo dumps with a one-line goal.',
      'Vague product ideas without acceptance criteria.',
      'Over-perfecting the prompt instead of a clear, testable first version.',
    ],
    skeleton: `## Role
…

## Goal
…

## Context
- Relevant files / facts only

## Requirements
- …

## Output
- …

## Constraints
- …`,
  },

  kimi: {
    family: 'kimi',
    displayName: 'Kimi',
    structureHint:
      'Clear role + delimiters (XML / triple quotes / headings). Spell out steps. Few-shot when style is hard to describe.',
    techniques: [
      'Include all important details and context in the request.',
      'Assign a role for more accurate specialized output.',
      'Use delimiters to separate articles, data, and instructions.',
      'Define sequential steps for multi-stage tasks.',
      'Provide few-shot examples for style/format consistency.',
      'Specify desired length in paragraphs/bullets (more reliable than exact word counts).',
      'When grounding: instruct to use only provided reference text and admit when missing.',
      'Break complex workflows into classify → specialized instructions patterns.',
    ],
    antiPatterns: [
      'Assuming the model infers missing business context.',
      'Unstructured multi-document dumps without separators.',
      'Ambiguous length/format expectations.',
    ],
    skeleton: `Role: …

Task steps:
1. …
2. …

Context:
"""
…
"""

Output format:
…

Constraints:
- …`,
  },

  generic: {
    family: 'generic',
    displayName: 'Generic',
    structureHint:
      'Universal structure: Role → Task → Context → Instructions → Output format → Constraints → optional Examples.',
    techniques: [
      'Be specific: what, for whom, success criteria, format.',
      'One primary task per prompt; decompose multi-step work into ordered steps.',
      'State what to do and what to avoid.',
      'Use delimiters for pasted data (XML, fences, or headings).',
      'Add 1–3 examples when format is non-obvious.',
      'Match response language to the user unless specified otherwise.',
    ],
    antiPatterns: [
      'Ambiguous verbs ("improve", "fix") without metrics.',
      'Too many unrelated tasks in one prompt.',
      'No output format or length guidance.',
    ],
    skeleton: `## Role
…

## Task
…

## Context
…

## Instructions
1. …
2. …

## Output format
…

## Constraints
- …`,
  },
}

/** Optional extra technique lines by task type (appended to any family). */
export const TASK_TYPE_HINTS: Record<PromptTaskType, string[]> = {
  coding: [
    'Include stack, files/areas to touch, test/verify steps, and "minimal scope / no drive-by refactors".',
    'Prefer "implement and verify" over "suggest changes" when the user wants code done.',
  ],
  research: [
    'Define success criteria, sources to prefer, how to handle uncertainty, and structured output sections.',
    'Ask for competing hypotheses and confidence notes when the topic is complex.',
  ],
  analysis: [
    'State evaluation criteria, comparison dimensions, and the decision the analysis should enable.',
    'Require evidence quotes or data references before conclusions.',
  ],
  writing: [
    'Specify audience, tone, length, structure (outline), and must-include / must-avoid phrases.',
    'Provide a short style sample when voice matters.',
  ],
  agentic: [
    'Define stop conditions, safe vs destructive actions, tool-use expectations, and when to ask the user.',
    'Include persistence vs early-stop guidance so the agent neither loops nor bails early.',
  ],
  multimodal: [
    'Reference each attachment by role (e.g. "screenshot = UI target", "PDF = source of truth").',
    'State whether vision/OCR output should be quoted or transformed.',
  ],
  general: [
    'Cover goal, context, format, and constraints at minimum.',
  ],
}
