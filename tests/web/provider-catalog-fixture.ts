// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// The provider catalog exactly as GET /model/providers serves it (G13): every
// known id with the name and kind from the server's one display source
// (src/modules/model/provider-display.ts). Web tests prime the shared cache
// with it instead of keeping a name map of their own.

import { PROVIDER_DISPLAY_NAMES, providerKind } from '@modules/model/provider-display'
import { setProviderCatalog } from '@/lib/provider-display'

export const SERVED_PROVIDER_ROWS = Object.entries(PROVIDER_DISPLAY_NAMES).map(([id, name]) => ({ id, name, kind: providerKind(id) }))

/** Load the served catalog into the web's shared provider-display cache. */
export function primeProviderCatalog(): void {
  setProviderCatalog(SERVED_PROVIDER_ROWS)
}
