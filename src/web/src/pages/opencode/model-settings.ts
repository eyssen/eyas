// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Pure helpers of the OpenCode "Model and reasoning" card: the model and
// reasoning-variant options come from GET /opencode/models (the running
// server's own list), the saved choice from GET /opencode/settings.

/** One reasoning variant: OpenCode's name, plus its canonical effort rung when the name is one. */
export interface OcVariant {
  id: string
  level: string | null
}

export interface OcModel {
  id: string
  name: string
  variants: OcVariant[]
}

export interface OcProvider {
  id: string
  name: string
  models: OcModel[]
}

export interface OcModelsResponse {
  running: boolean
  providers: OcProvider[]
  defaults: Record<string, string>
}

export interface OcModelRef {
  providerID: string
  modelID: string
}

/** The select value of a model ('' = OpenCode's default). Ids may contain '/', so the pair is JSON. */
export function modelKey(ref: OcModelRef | null | undefined): string {
  return ref ? JSON.stringify([ref.providerID, ref.modelID]) : ''
}

export function parseModelKey(key: string): OcModelRef | null {
  if (!key) return null
  try {
    const pair = JSON.parse(key) as unknown
    if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && typeof pair[1] === 'string' && pair[0] && pair[1]) {
      return { providerID: pair[0], modelID: pair[1] }
    }
  } catch {
    /* not a model key */
  }
  return null
}

export function findModel(providers: readonly OcProvider[] | undefined, ref: OcModelRef | null): OcModel | null {
  if (!ref || !providers) return null
  return providers.find((p) => p.id === ref.providerID)?.models.find((m) => m.id === ref.modelID) ?? null
}

/**
 * The variants the select offers for a model. With the server's list: that
 * model's variants (none = the select is hidden). The current variant is
 * always kept as an option — also when the list does not have it (server not
 * running, model not listed, variant withdrawn) — so the select never shows
 * a value it does not hold; a task drops a variant the model does not offer.
 */
export function variantChoices(
  providers: readonly OcProvider[] | undefined,
  ref: OcModelRef | null,
  current: string | null,
): OcVariant[] {
  if (!ref) return []
  const offered = findModel(providers, ref)?.variants ?? []
  if (!current || offered.some((v) => v.id === current)) return offered
  return [...offered, { id: current, level: null }]
}

/** After a model change: keep the chosen variant only when the new model offers it. */
export function variantAfterModelChange(
  providers: readonly OcProvider[] | undefined,
  next: OcModelRef | null,
  variant: string,
): string {
  if (!next || !variant) return ''
  const model = findModel(providers, next)
  return model?.variants.some((v) => v.id === variant) ? variant : ''
}

/**
 * The label of a variant: a name on the canonical effort ladder uses the
 * shared effort label (common.effort.level.<rung>) when that key exists;
 * any other name is OpenCode's own, shown as it is.
 */
export function variantLabel(variant: OcVariant, translate: (key: string, fallback: string) => string): string {
  return variant.level ? translate(`common.effort.level.${variant.level}`, variant.id) : variant.id
}

/** The PUT /opencode/settings body of a draft. */
export function settingsPayload(key: string, variant: string): { model: OcModelRef | null; variant: string | null } {
  const model = parseModelKey(key)
  return { model, variant: model && variant ? variant : null }
}
