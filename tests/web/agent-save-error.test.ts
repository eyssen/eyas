// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// E3 — a colleague save refused for an effort the model does not offer shows
// a translated message naming the rungs it does offer; nothing is lost.

import { describe, it, expect, afterEach } from 'vitest'
import { ApiError } from '@/lib/api'
import { agentSaveErrorText } from '@/pages/agents/save-error'
import { useLanguageStore } from '@/stores/language-store'

const refusal = (levels: string[]) => new ApiError(400, "Effort 'max' is not supported by gpt-5.5", 'EFFORT_UNSUPPORTED', {
  code: 'EFFORT_UNSUPPORTED', level: 'max', levels, modelId: 'gpt-5.5',
})

describe('agentSaveErrorText', () => {
  afterEach(() => useLanguageStore.getState().setLang('en'))

  it('EFFORT_UNSUPPORTED → the translated message with the model and its rungs (positive)', () => {
    useLanguageStore.getState().setLang('en')
    expect(agentSaveErrorText(refusal(['low', 'medium', 'high', 'xhigh'])))
      .toBe("gpt-5.5 does not offer the effort level 'max'. Nothing was saved — choose Auto or one of: low, medium, high, xhigh.")
    useLanguageStore.getState().setLang('es')
    const es = agentSaveErrorText(refusal(['low']))
    expect(es).toContain('gpt-5.5')
    expect(es).toContain('No se guardó nada')
  })

  it('no rungs at all reads as Auto-only', () => {
    useLanguageStore.getState().setLang('en')
    expect(agentSaveErrorText(refusal([]))).toContain('only Auto can be set')
  })

  it('any other failure keeps the server text, prefixed in the user\'s language (negative)', () => {
    useLanguageStore.getState().setLang('fr')
    expect(agentSaveErrorText(new ApiError(500, 'boom'))).toBe("Échec de l'enregistrement : boom")
    expect(agentSaveErrorText(new Error('offline'))).toBe("Échec de l'enregistrement : offline")
  })
})
