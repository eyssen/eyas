// Part of eYssen. See LICENSE file for full copyright and licensing details.

const APPROX_CHARS_PER_TOKEN = 4

/** Per-section token caps of one assembled prompt. */
export interface SectionBudget {
  coreIdentity: number
  coreRules: number
  personality: number
  projectCascade: number
  identityMd: number
  soulMd: number
  agentsMd: number
  toolsMd: number
  skillsList: number
  toolsList: number
  availableAgents: number
  teamContext: number
  /**
   * Working memory + goal ancestry (the suffix 'memory-context' section; the
   * code-search and working-directories blocks borrow this bucket). NOT the
   * recalled durable memory — that is memoryRecall.
   */
  memoryContext: number
  /**
   * The per-turn recall block (durable memory: standing notes, retrieved and
   * expanded hits) that the turn block carries (assembler.ts buildTurn →
   * ctx.memoryRecall, memory/v2/assemble.ts). Its baseline is
   * memory.index.budgetChars, in tokens; the renderer fills the block to this
   * cap, frame included, and never beyond it.
   */
  memoryRecall: number
  runtime: number
  activeVoice: number
}

/** The window at which every section gets exactly its DEFAULT_BUDGET_FULL cap. */
export const BASELINE_WINDOW = 100_000
/** From this window up, scalable sections get SCALE_MAX × their baseline. */
export const LARGE_WINDOW = 250_000
export const SCALE_MAX = 2.5
/**
 * Below the baseline, the whole budget stays within this share of the window.
 * The budget covers the system prompt and the per-turn recall block only. Tool
 * schemas travel beside it over the provider's tool API and are not counted,
 * and the history is not fitted: on a 4k–32k model a large toolset can still
 * fill the window (open; fitting them needs a tool-priority policy shared by
 * the runner, the inventory and the executor's allowlist). A model without
 * tool support is sent no schemas at all.
 */
export const SMALL_WINDOW_SHARE = 0.35

/** memory.index.budgetChars default (config schema): the recall cap at the baseline window. */
export const DEFAULT_MEMORY_RECALL_CHARS = 2_400

/**
 * Sections that are never scaled: EYAS-shipped (owner-editable) master text
 * and the tiny runtime/voice lines. Their caps hold at every window, so the
 * shipped text is never clipped (token-budget.test pins that it fits).
 */
export const LOCKED_BUDGET_KEYS = ['coreIdentity', 'coreRules', 'personality', 'runtime', 'activeVoice'] as const satisfies ReadonlyArray<keyof SectionBudget>

/** The budget at the 100k baseline window. */
export const DEFAULT_BUDGET_FULL: SectionBudget = {
  // Sized to the shipped CORE_IDENTITY (~540 tokens) with headroom; it used to
  // be 200, which cut the identity — memory contract included — mid-sentence.
  coreIdentity: 600,
  // 800, not 500: the shipped CORE_RULES is ~780 tokens, so at 500 every
  // assembled prompt cut it mid-rule and the tail rules reached no model.
  coreRules: 800,
  personality: 200,
  projectCascade: 2_300,
  identityMd: 600,
  soulMd: 500,
  agentsMd: 800,
  toolsMd: 400,
  skillsList: 400,
  toolsList: 500,
  availableAgents: 400,
  teamContext: 400,
  memoryContext: 1_200,
  memoryRecall: Math.ceil(DEFAULT_MEMORY_RECALL_CHARS / APPROX_CHARS_PER_TOKEN),
  runtime: 200,
  activeVoice: 100,
}

export function totalBudget(b: SectionBudget): number {
  return Object.values(b).reduce((sum, v) => sum + v, 0)
}

const LOCKED = new Set<string>(LOCKED_BUDGET_KEYS)

export interface WindowBudgetOptions {
  /**
   * memory.index.budgetChars — the recall block's cap at the baseline window,
   * in characters. Scaled with the window like every other scalable section.
   */
  memoryRecallChars?: number
  /** Per-call caps applied after scaling (BuildOptions.budgetOverride). */
  override?: Partial<SectionBudget>
}

/**
 * The section budget for a model's context window.
 *   - 100k (BASELINE_WINDOW): exactly the baseline caps.
 *   - Larger: scalable sections grow linearly up to SCALE_MAX× at 250k and
 *     above — a large-window model no longer has its notes truncated.
 *   - Smaller: the whole budget stays within 35% of the window; scalable
 *     sections shrink by one ratio (down to 0) once the baseline no longer
 *     fits, which happens below ~29k.
 *   - Locked sections keep their caps at every window, so below ~5.5k their
 *     own size is more than 35% of the window: shipped text is never clipped.
 *   - Monotonic: a larger window never gets a smaller cap for any section.
 * A missing or invalid window counts as the baseline.
 */
export function budgetForWindow(contextWindow: number, opts: WindowBudgetOptions = {}): SectionBudget {
  const base: SectionBudget = { ...DEFAULT_BUDGET_FULL }
  if (typeof opts.memoryRecallChars === 'number' && Number.isFinite(opts.memoryRecallChars) && opts.memoryRecallChars >= 0) {
    base.memoryRecall = Math.ceil(opts.memoryRecallChars / APPROX_CHARS_PER_TOKEN)
  }
  const window = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : BASELINE_WINDOW
  const factor = scaleFactor(window, base)

  const scaled = { ...base }
  for (const key of Object.keys(base) as Array<keyof SectionBudget>) {
    if (LOCKED.has(key)) continue
    scaled[key] = Math.max(0, Math.floor(base[key] * factor))
  }
  return { ...scaled, ...opts.override }
}

/** The multiplier for scalable sections at this window. */
function scaleFactor(window: number, base: SectionBudget): number {
  if (window >= BASELINE_WINDOW) {
    const t = Math.min(1, (window - BASELINE_WINDOW) / (LARGE_WINDOW - BASELINE_WINDOW))
    return 1 + (SCALE_MAX - 1) * t
  }
  let locked = 0
  let scalable = 0
  for (const [key, value] of Object.entries(base)) {
    if (LOCKED.has(key)) locked += value
    else scalable += value
  }
  if (scalable <= 0) return 1
  const room = SMALL_WINDOW_SHARE * window - locked
  return Math.max(0, Math.min(1, room / scalable))
}

export function estimateTokens(text: string): number {
  return charsToTokens(text.length)
}

/** The tokens a character count stands for, under the same chars/4 estimate (0 for a non-positive count). */
export function charsToTokens(chars: number): number {
  return Number.isFinite(chars) && chars > 0 ? Math.ceil(chars / APPROX_CHARS_PER_TOKEN) : 0
}

/**
 * The same chars/4 estimate for a message history as it is sent to a model
 * (ModelMessage[], read structurally): text, reasoning text, tool-call input
 * and tool-result content. Images and other binary blocks are not counted —
 * the provider-reported prompt size replaces this estimate once a call
 * reports one (context occupancy). Never throws; a malformed entry counts 0.
 */
export function estimateMessagesTokens(messages: ReadonlyArray<{ content?: unknown }> | null | undefined): number {
  if (!Array.isArray(messages)) return 0
  let chars = 0
  for (const message of messages) {
    const content = message?.content
    if (typeof content === 'string') {
      chars += content.length
      continue
    }
    if (!Array.isArray(content)) continue
    for (const block of content as Array<Record<string, unknown> | null>) {
      if (!block || typeof block !== 'object') continue
      if (block.type === 'text' && typeof block.text === 'string') chars += block.text.length
      else if (block.type === 'thinking' && typeof block.thinking === 'string') chars += block.thinking.length
      else if (block.type === 'tool_result' && typeof block.content === 'string') chars += block.content.length
      else if (block.type === 'tool_use') {
        try { chars += JSON.stringify(block.input ?? {}).length } catch { /* unserializable input counts 0 */ }
      }
    }
  }
  return Math.ceil(chars / APPROX_CHARS_PER_TOKEN)
}

/** The characters a token cap stands for, under the same chars/4 estimate. */
export function tokensToChars(tokens: number): number {
  return Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) * APPROX_CHARS_PER_TOKEN : 0
}

export function clipToBudget(
  text: string,
  tokenBudget: number,
): { content: string; truncated: boolean; droppedChars: number } {
  const charBudget = tokenBudget * APPROX_CHARS_PER_TOKEN
  if (text.length <= charBudget) return { content: text, truncated: false, droppedChars: 0 }
  return {
    content: text.slice(0, charBudget) + '\n\n[truncated — section budget]',
    truncated: true,
    droppedChars: text.length - charBudget,
  }
}
