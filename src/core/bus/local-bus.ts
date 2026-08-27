import type { Logger } from 'pino'
import type { EyasBus, BusSubscription } from './types.js'

export function createLocalBus(logger?: Logger): EyasBus {
  const handlers = new Map<string, Map<string, (data: unknown, emittedSubject?: string) => Promise<void>>>()
  let nextId = 0

  const dispatch = (
    subject: string,
    data: unknown,
    subHandlers: Map<string, (data: unknown, emittedSubject?: string) => Promise<void>>,
  ) => {
    for (const handler of subHandlers.values()) {
      Promise.resolve(handler(data, subject)).catch((err) => {
        if (logger) {
          logger.error({ err, subject }, 'Bus handler error')
        } else {
          console.error('Bus handler error on %s:', subject, err)
        }
      })
    }
  }

  return {
    emit(subject: string, data: unknown) {
      // Exact-match fast path
      const subHandlers = handlers.get(subject)
      if (subHandlers) dispatch(subject, data, subHandlers)

      // Wildcard/prefix matching: also invoke handlers registered on a
      // key ending in '.*' whose prefix is a prefix of the emitted subject
      // (e.g. 'eyas.board.*' fires for emit('eyas.board.card_moved')).
      // Skip the exact key already handled above to avoid double dispatch.
      for (const [key, keyHandlers] of handlers) {
        if (key === subject) continue
        if (!key.endsWith('.*')) continue
        const prefix = key.slice(0, -1) // keep the trailing '.', drop '*'
        if (subject.startsWith(prefix)) {
          dispatch(subject, data, keyHandlers)
        }
      }
    },

    on(subject: string, handler: (data: unknown, emittedSubject?: string) => Promise<void>): BusSubscription {
      if (!handlers.has(subject)) handlers.set(subject, new Map())
      const id = String(++nextId)
      handlers.get(subject)!.set(id, handler)
      return {
        subject,
        id,
        unsubscribe() { handlers.get(subject)?.delete(id) },
      }
    },

    off(subscription: BusSubscription) {
      subscription.unsubscribe()
    },
  }
}
