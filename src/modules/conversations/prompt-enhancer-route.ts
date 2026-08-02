// Part of eYssen. See LICENSE file for full copyright and licensing details.

/**
 * Prompt Enhancer — creates a sub-conversation pre-seeded with a system prompt
 * that instructs the assistant to act as a prompt-refinement coach.
 *
 * The UI opens this sub-conversation in a dialog; when the user is satisfied,
 * the dialog's "Apply" button inserts the last assistant suggestion into the
 * parent conversation's input.
 */

import type { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requirePermission } from '@modules/permissions/middleware'
import type { ConversationService } from './conversation-service.js'
import type { DecisionEngine } from '@modules/model/routing/decision-engine'

const ENHANCER_SYSTEM_PROMPT = `Te egy prompt-finomító coach vagy. A felhasználó egy másik conversationben készít egy promptot egy AI asszisztensnek, és segítséget kér ahhoz, hogy azt világosabbá, konkrétabbá és hatékonyabbá tegye.

Feladatod:
- Először röviden tisztázó kérdéseket tegyél fel ha a cél homályos (max 1–2 kérdés, ne árassz el vele).
- Javasolj konkrét, működőképes promptot, ami tartalmazza: kontextust, elérendő célt, elvárt kimeneti formátumot, és a fontos megkötéseket.
- Adj vissza egy CSAK a finomított promptot tartalmazó blokkot a válaszod végén, ebben a formában:

<final-prompt carry-attachments="all|none">
...itt a végleges prompt...
</final-prompt>

Fájlkezelés — FONTOS:
- Ha a felhasználó csatolt fájl(oka)t (képet, PDF-et, dokumentumot), döntsd el, hogy a célul kitűzött promptnak SZÜKSÉGE VAN-E rájuk.
- Ha a prompt a csatolmányokra hivatkozik vagy azok tartalmát feldolgozni hivatott, használd: \`carry-attachments="all"\` — így a fájlok automatikusan átkerülnek a fő conversationbe is.
- Ha a csatolmányok csak kontextusként szolgáltak a finomításhoz, de a végső prompt önmagában működik, használd: \`carry-attachments="none"\`.
- Ha nincs csatolmány, az attribútum nem kötelező (alapértelmezett: "none").

Egyebek:
- Ha a felhasználó módosításokat kér, iteráld tovább. Minden válasz tartalmazzon frissített <final-prompt> blokkot ha már van konvergencia.
- Rövid, lényegre törő légy. Ne magyarázkodj — a fő érték a jó prompt.
- A válaszod nyelve kövesse a felhasználó nyelvét.`

export function registerPromptEnhancerRoute(
  app: Hono,
  chatService: ConversationService,
  getDecisionEngine?: () => DecisionEngine | undefined,
) {
  app.post(
    '/api/v1/conversations/:id/prompt-enhancer',
    requirePermission('create', 'Conversation'),
    async (c: any) => {
      const userId = c.get('userId') as string | undefined
      if (!userId) throw new HTTPException(401, { message: 'Authentication required' })

      const parentId = c.req.param('id')
      const parent = chatService.get(parentId)
      if (!parent || parent.userId !== userId) {
        throw new HTTPException(404, { message: 'Parent conversation not found' })
      }

      const body = await c.req.json().catch(() => ({}))
      const draft = typeof body.draft === 'string' ? body.draft.trim() : ''

      // Reuse an existing enhancer sub-conversation for this parent if one is
      // already open — avoids spawning a new dialog every time the button is
      // clicked mid-session. Otherwise create a fresh sub.
      const existing = chatService
        .getChildren(parentId)
        .find(
          (c) =>
            c.goalDescription === 'prompt-enhancer' &&
            c.status !== 'completed' &&
            c.status !== 'failed',
        )

      let sub
      if (existing) {
        sub = existing
      } else {
        sub = chatService.createSubConversation({
          title: 'Prompt Enhancer',
          goalDescription: 'prompt-enhancer',
          parentConversationId: parentId,
        })
        // Persist the enhancer system prompt on the sub-conversation so the
        // PromptAssembler picks it up on every message turn.
        chatService.update(sub.id, { prompt: ENHANCER_SYSTEM_PROMPT })

        // Apply the dedicated `prompt_enhancer` routing tier if configured —
        // gives the user a single place (Settings → Routing) to pick which
        // model acts as the coach, rather than per-message auto-routing.
        const engine = getDecisionEngine?.()
        const tierPick = engine?.resolveForTier('prompt_enhancer')
        if (tierPick?.provider && tierPick?.model) {
          chatService.update(sub.id, { providerId: tierPick.provider, modelId: tierPick.model })
        }

        // Seed with the user's current draft if provided — kicks off the
        // refinement loop automatically on dialog open.
        if (draft.length > 0) {
          chatService.addMessage(sub.id, {
            role: 'user',
            content: `Szeretnék finomítani ezen a prompt-piszkozaton:\n\n${draft}`,
          })
        }
      }

      return c.json({ id: sub.id, taskId: sub.taskId, title: sub.title, seededDraft: draft.length > 0 }, existing ? 200 : 201)
    },
  )
}
