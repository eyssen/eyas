// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Graduated poisoning gate (spec §6; research §2-12 — AgentPoison / MINJA
// are demonstrated, not theoretical). Instruction-shaped text never becomes
// a fact or a gist at full trust:
//   high   — explicit override phrasing            → reject + count
//   medium — imperative aimed at the assistant, tool/function invocation
//            directive, memory-wipe directive        → quarantine + count
//   low    — suspicious formatting (fake role tags) → quarantine + count
// en/hu/de/es/fr. Regex only. Unicode lookarounds replace \b, which is
// ASCII-only in JavaScript and fails next to accented letters.

export type InjectionLevel = 'none' | 'low' | 'medium' | 'high'
export interface InjectionScan { level: InjectionLevel; pattern?: string }

interface Family { name: string; level: Exclude<InjectionLevel, 'none'>; regex: RegExp }

const HIGH: Family[] = [
  { name: 'override-en', level: 'high', regex: /(?<![\p{L}\p{N}])(?:ignore|disregard|forget)\s+(?:(?:all|any|the|your|every|of)\s+){0,4}(?:previous|prior|earlier|above|preceding|existing)\s+(?:instructions?|rules?|facts?|messages?|memor(?:y|ies)|context|prompts?)(?![\p{L}\p{N}])/iu },
  { name: 'override-en-forget', level: 'high', regex: /(?:(?:^|[.!?][ \t\n]{1,4})[ \t]{0,8}forget\s{1,4}everything|(?<![\p{L}\p{N}])(?:please|now|should|must)\s{1,4}forget\s{1,4}everything\s{1,4}(?:you|above|and|i\s{1,4}told))(?![\p{L}\p{N}])/imu },
  { name: 'override-hu', level: 'high', regex: /(?<![\p{L}\p{N}])(?:hagyd|hagyja|hagyjátok)\s+figyelmen\s+kívül(?![\p{L}\p{N}])/iu },
  { name: 'override-hu-forget', level: 'high', regex: /(?<![\p{L}\p{N}])(?:felejtsd\s+el|felejtse\s+el|vedd\s+semmisnek)\s+(?:(?:az|a)\s+){0,2}(?:összes|korábbi|előző|eddigi|minden|teljes)(?![\p{L}\p{N}])/iu },
  { name: 'override-de', level: 'high', regex: /(?<![\p{L}\p{N}])(?:ignorier(?:e|en|t)|vergiss|vergessen\s+sie|missachte)\s+(?:(?:alle|die|der|das|deine|deinen|sämtliche|meine)\s+){0,4}(?:vorherigen|bisherigen|früheren|obigen|vorangegangenen)\s+(?:anweisungen|regeln|fakten|nachrichten|instruktionen)(?![\p{L}\p{N}])/iu },
  { name: 'override-de-forget', level: 'high', regex: /(?<![\p{L}\p{N}])vergiss\s+alles(?![\p{L}\p{N}])/iu },
  { name: 'override-es', level: 'high', regex: /(?<![\p{L}\p{N}])(?:ignora|ignore|olvida|descarta)\s+(?:(?:todas?|todos?|las?|los?|tus?|sus?|de)\s+){0,4}(?:instrucciones|reglas|hechos|mensajes)\s+(?:anteriores|previas?|previos?)(?![\p{L}\p{N}])/iu },
  { name: 'override-es-forget', level: 'high', regex: /(?<![\p{L}\p{N}])olvida\s+todo(?![\p{L}\p{N}])/iu },
  { name: 'override-fr', level: 'high', regex: /(?<![\p{L}\p{N}])(?:ignor(?:e|ez)|oubli(?:e|ez)|néglig(?:e|ez))\s+(?:(?:toutes?|tous?|les|la|le|vos|tes|ta|ton|de)\s+){0,4}(?:instructions|règles|faits|messages|consignes)\s+(?:précédentes?|antérieures?|ci-dessus)(?![\p{L}\p{N}])/iu },
  { name: 'override-fr-forget', level: 'high', regex: /(?<![\p{L}\p{N}])oublie(?:z)?\s+tout(?![\p{L}\p{N}])/iu },
  { name: 'system-override', level: 'high', regex: /(?<![\p{L}\p{N}])(?:system\s+prompt\s+override|new\s+system\s+prompt|override\s+(?:the\s+)?system\s+prompt|rendszerprompt\s+felülírás|systemprompt\s+überschreiben|anular\s+el\s+prompt\s+del\s+sistema|remplacer\s+le\s+prompt\s+système)(?![\p{L}\p{N}])/iu },
  { name: 'role-en', level: 'high', regex: /(?<![\p{L}\p{N}])(?:from\s+now\s+on|starting\s+now|henceforth)(?![\p{L}\p{N}])[^.!?\n]{0,60}(?:\n(?![ \t]*(?:[-*#>+]|\d+[.)]))[^.!?\n]{0,60})?(?<![\p{L}\p{N}])you\s+(?:are|will\s+be|must\s+act\s+as|act\s+as)(?![\p{L}\p{N}])/iu },
  { name: 'role-hu', level: 'high', regex: /(?<![\p{L}\p{N}])mostantól(?![\p{L}\p{N}])[^.!?\n]{0,60}(?:\n(?![ \t]*(?:[-*#>+]|\d+[.)]))[^.!?\n]{0,60})?(?<![\p{L}\p{N}])(?:vagy|leszel|legyél|viselkedj)(?![\p{L}\p{N}])/iu },
  { name: 'role-de', level: 'high', regex: /(?<![\p{L}\p{N}])(?:ab\s+(?:jetzt|sofort)|von\s+nun\s+an)(?![\p{L}\p{N}])[^.!?\n]{0,60}(?:\n(?![ \t]*(?:[-*#>+]|\d+[.)]))[^.!?\n]{0,60})?(?<![\p{L}\p{N}])bist\s+du(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])du\s+bist\s+(?:ab\s+jetzt|von\s+nun\s+an)(?![\p{L}\p{N}])/iu },
  { name: 'role-es', level: 'high', regex: /(?<![\p{L}\p{N}])a\s+partir\s+de\s+ahora(?![\p{L}\p{N}])[^.!?\n]{0,60}(?:\n(?![ \t]*(?:[-*#>+]|\d+[.)]))[^.!?\n]{0,60})?(?<![\p{L}\p{N}])(?:eres|serás|actúas?\s+como|debes\s+ser)(?![\p{L}\p{N}])/iu },
  { name: 'role-fr', level: 'high', regex: /(?<![\p{L}\p{N}])(?:à\s+partir\s+de\s+maintenant|désormais|dorénavant)(?![\p{L}\p{N}])[^.!?\n]{0,60}(?:\n(?![ \t]*(?:[-*#>+]|\d+[.)]))[^.!?\n]{0,60})?(?<![\p{L}\p{N}])(?:tu\s+es|vous\s+êtes|tu\s+seras|agis\s+comme|agissez\s+comme)(?![\p{L}\p{N}])/iu },
]

const MEDIUM: Family[] = [
  { name: 'imperative-en', level: 'medium', regex: /(?<![\p{L}\p{N}])(?:the\s+)?(?:assistant|ai|eyas|agent|model)[ \t]{0,4}[,:]?\s{1,4}(?:must|should|shall|has\s+to|needs\s+to|will\s+now|is\s+required\s+to)\s+(?:(?:now|always|never|immediately|first)\s+){0,2}(?:ignore|forget|delete|erase|reveal|call|invoke|override|obey)(?![\p{L}\p{N}])/iu },
  { name: 'role-now-en', level: 'medium', regex: /(?<![\p{L}\p{N}])you\s+are\s+now\s+(?:a|an|the|my|in)(?![\p{L}\p{N}])/iu },
  { name: 'tool-en', level: 'medium', regex: /(?<![\p{L}\p{N}])(?:(?:call|invoke)\s+(?:the\s+)?(?:tool|function)|execute\s+(?:the\s+)?following\s+(?:command|code|instructions))(?![\p{L}\p{N}])/iu },
  { name: 'wipe-en', level: 'medium', regex: /(?<![\p{L}\p{N}])(?:delete|erase|wipe|purge|clear)\s+(?:(?:all|any|the|your|every|of)\s+){0,4}(?:memor(?:y|ies)|facts|history|context(?!\s+menu))(?![\p{L}\p{N}])/iu },
  { name: 'imperative-hu', level: 'medium', regex: /(?<![\p{L}\p{N}])(?:az?\s+)?(?:asszisztens|ügynök|modell|eyas)[ \t]{0,4}[,:]?\s{1,4}(?:köteles|muszáj)\s+(?:\S{1,40}\s{1,4}){0,3}?(?:törölni|törölnie|felfedni|futtatni|meghívni|végrehajtani|engedelmeskedni|figyelmen)(?![\p{L}\p{N}])/iu },
  { name: 'role-now-hu', level: 'medium', regex: /(?<![\p{L}\p{N}])te\s+most\s+(?:egy|az?)(?![\p{L}\p{N}])[^.!?\n]{0,60}(?:\n(?![ \t]*(?:[-*#>+]|\d+[.)]))[^.!?\n]{0,60})?(?<![\p{L}\p{N}])vagy(?![\p{L}\p{N}])/iu },
  { name: 'tool-hu', level: 'medium', regex: /(?<![\p{L}\p{N}])(?:hívd\s+meg\s+(?:az?\s+)?(?:eszközt|toolt|függvényt)|hajtsd\s+végre\s+(?:az?\s+)?következő\s+(?:parancsot|kódot|utasítást))(?![\p{L}\p{N}])/iu },
  { name: 'wipe-hu', level: 'medium', regex: /(?<![\p{L}\p{N}])(?:töröld|törölje|tisztítsd)\s+(?:(?:az|a|minden|összes|teljes)\s+){0,4}(?:memóriát|memóriádat|tényeket|előzményeket|kontextust)(?![\p{L}\p{N}])/iu },
  { name: 'imperative-de', level: 'medium', regex: /(?<![\p{L}\p{N}])(?:der\s+|das\s+)?(?:assistent|agent|modell|eyas)[ \t]{0,4}[,:]?\s{1,4}(?:muss|soll)\s+(?:jetzt\s+|nun\s+)?(?:\S{1,40}\s{1,4}){0,3}?(?:löschen|ignorieren|vergessen|offenlegen|ausführen|aufrufen|gehorchen|immer|nie)(?![\p{L}\p{N}])/iu },
  { name: 'role-now-de', level: 'medium', regex: /(?<![\p{L}\p{N}])du\s+bist\s+(?:jetzt|nun)\s+(?:ein|eine|der|die|das|mein)(?![\p{L}\p{N}])/iu },
  { name: 'tool-de', level: 'medium', regex: /(?<![\p{L}\p{N}])(?:(?:führe|führen\s+sie)\s{1,8}(?:den|die|das)?[ \t]{0,8}(?:folgenden|folgende|diesen)\s+(?:befehl|kommando|code|skript)|rufe\s{1,4}(?:das|den|die)?[ \t]{0,4}(?:tool|werkzeug|funktion))(?![\p{L}\p{N}])/iu },
  { name: 'wipe-de', level: 'medium', regex: /(?<![\p{L}\p{N}])(?:lösche|leere|entferne)\s+(?:(?:alle|allen|den|das|die|deine|deinen|deiner|sämtliche)\s+){0,4}(?:speicher|erinnerungen|fakten|verlauf|kontext)(?![\p{L}\p{N}])/iu },
  { name: 'imperative-es', level: 'medium', regex: /(?<![\p{L}\p{N}])(?:el\s+)?(?:asistente|agente|modelo|eyas)[ \t]{0,4}[,:]?\s{1,4}(?:debe|tiene\s+que|deberá)\s+(?:ahora\s+)?(?:\S{1,40}\s{1,4}){0,3}?(?:borrar|ignorar|olvidar|revelar|ejecutar|llamar|obedecer|siempre|nunca)(?![\p{L}\p{N}])/iu },
  { name: 'role-now-es', level: 'medium', regex: /(?<![\p{L}\p{N}])ahora\s+eres\s+(?:un|una|el|la|mi)(?![\p{L}\p{N}])/iu },
  { name: 'tool-es', level: 'medium', regex: /(?<![\p{L}\p{N}])(?:llama\s+a\s+la\s+(?:herramienta|función)|ejecuta\s+(?:el|la)\s+siguiente\s+(?:comando|código|instrucción))(?![\p{L}\p{N}])/iu },
  { name: 'wipe-es', level: 'medium', regex: /(?<![\p{L}\p{N}])(?:borra|elimina|limpia)\s+(?:(?:toda|todo|todas|todos|la|el|los|las|tu|tus|de)\s+){0,4}(?:memoria|hechos|historial|contexto)(?![\p{L}\p{N}])/iu },
  { name: 'imperative-fr', level: 'medium', regex: /(?<![\p{L}\p{N}])(?:l['’]\s*)?(?:assistant|agent|modèle|eyas)[ \t]{0,4}[,:]?\s{1,4}(?:doit|devra)\s+(?:maintenant\s+)?(?:\S{1,40}\s{1,4}){0,3}?(?:effacer|ignorer|oublier|révéler|exécuter|appeler|obéir|toujours|jamais)(?![\p{L}\p{N}])/iu },
  { name: 'role-now-fr', level: 'medium', regex: /(?<![\p{L}\p{N}])tu\s+es\s+(?:maintenant|désormais)\s+(?:un|une|le|la|mon)(?![\p{L}\p{N}])/iu },
  { name: 'tool-fr', level: 'medium', regex: /(?<![\p{L}\p{N}])(?:appell?e(?:z)?\s{1,8}(?:l['’][ \t]{0,8}|la\s{1,8}|le\s{1,8})?(?:outil|fonction)|exécute(?:z)?\s+(?:la|le)\s+(?:commande|code)\s+suivante?)(?![\p{L}\p{N}])/iu },
  { name: 'wipe-fr', level: 'medium', regex: /(?<![\p{L}\p{N}])(?:efface|effacez|supprime|supprimez|vide|videz)\s+(?:(?:toute|toutes|tout|tous|la|le|les|ta|ton|votre|vos|de)\s+){0,4}(?:mémoire|faits|historique|contexte)(?![\p{L}\p{N}])/iu },
]

const LOW: Family[] = [
  { name: 'fake-tags', level: 'low', regex: /<\/?\s{0,12}(?:system|assistant|tool|tool_call|function_call|instructions?|sys)\s{0,12}>/iu },
  { name: 'bracket-roles', level: 'low', regex: /\[\/?\s{0,12}(?:system|inst|assistant|sys)\s{0,12}\]|<<\s{0,12}sys\s{0,12}>>/iu },
  // Lower-case "System: Odoo 18" is an engineer's key/value line; only the shouted form and the chat roles count.
  { name: 'line-roles', level: 'low', regex: /^\s{0,12}(?:assistant|developer|SYSTEM)[ \t]{0,4}:[ \t]{0,4}\S/mu },
  { name: 'md-headers', level: 'low', regex: /^#{1,6}\s*(?:system|instructions?|new\s+instructions|rendszer|anweisungen|instrucciones|consignes)\s*[:：]/imu },
  // Separate family, deliberately WITHOUT the `i` flag: a shouted heading is the
  // same discriminator `line-roles` uses. `### System requirements` and
  // `# Instructions\n1. Install Bun.` stay clean because they are not shouted,
  // while `# SYSTEM` followed by a payload is a fake system block that carries no
  // marker vocabulary of its own and nothing else in this module would see.
  { name: 'md-shouted', level: 'low', regex: /^#{1,6}[ \t]{0,4}(?:SYSTEM|INSTRUCTIONS?)[ \t]{0,4}$/mu },
  { name: 'begin-block', level: 'low', regex: /(?<![\p{L}\p{N}])BEGIN\s+(?:SYSTEM|INSTRUCTIONS)(?![\p{L}\p{N}])/u },
]

const FAMILIES: Family[] = [...HIGH, ...MEDIUM, ...LOW]

/** First matching family wins; families are ordered high → medium → low. */
export function scanForInjection(text: string): InjectionScan {
  if (!text) return { level: 'none' }
  // NFC alone leaves format characters in place, and one U+200B or U+00AD inside a
  // keyword defeats every family below. Strip them before matching.
  const normalised = text.normalize('NFC').replace(/[\p{Cf}\u00AD]/gu, '')
  for (const family of FAMILIES) {
    if (family.regex.test(normalised)) return { level: family.level, pattern: family.name }
  }
  return { level: 'none' }
}

/** Keep only the sentences that scan clean — the gist fallback when a candidate gist is rejected. */
export function stripInjectionSentences(text: string): string {
  const joined = text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && scanForInjection(s).level === 'none')
    .join(' ')
    .trim()
  // The splitter treats a newline as a sentence end and the joiner replaces it
  // with a space, so a line-wrapped injection can be cut into two clean halves
  // and glued back together. Task 10 uses this as the gist fallback, so without
  // this guard the fallback text could be the exact string that was rejected.
  return scanForInjection(joined).level === 'none' ? joined : ''
}
