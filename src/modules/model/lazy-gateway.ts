// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type {
  ModelGateway, ModelRequest, ModelResponse, StreamEvent,
  EmbedRequest, EmbedResponse, AIProvider, ModelInfo,
} from './types.js'

/**
 * A ModelGateway that re-resolves the underlying gateway on every call.
 *
 * Wrapper modules (privacy PII scanning, observability tracing) reassign
 * `ctx.model` during their onStart. Any module that captured `ctx.model`
 * during onRegister pins the pre-wrap gateway and silently bypasses those
 * wrappers. Passing `createLazyGateway(() => ctx.model)` keeps destructuring
 * call sites working while every call goes through the *current* gateway.
 */
export function createLazyGateway(resolve: () => ModelGateway): ModelGateway {
  return {
    registerProvider: (provider: AIProvider) => resolve().registerProvider(provider),
    unregisterProvider: (id: string) => resolve().unregisterProvider(id),
    getProvider: (id: string) => resolve().getProvider(id),
    listProviders: () => resolve().listProviders(),
    listAllModels: (): Promise<ModelInfo[]> => resolve().listAllModels(),
    complete: (request: ModelRequest): Promise<ModelResponse> => resolve().complete(request),
    stream: (request: ModelRequest): AsyncIterable<StreamEvent> => resolve().stream(request),
    embed: (request: EmbedRequest): Promise<EmbedResponse> => resolve().embed(request),
  }
}
