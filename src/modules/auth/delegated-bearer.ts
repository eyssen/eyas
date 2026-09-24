// Part of eYssen. See LICENSE file for full copyright and licensing details.
//
// Bearer credentials a module issues for its own exact API paths, to callers
// that have no EYAS session: the OpenCode memory plugin's one-time session
// proofs (opencode/plugin-tokens.ts). The deny-by-default authenticate
// middleware lets such a request through WITHOUT a user — no userId, role or
// ability is set — and only when the registering module verifies the bearer
// as valid (without using it up). The route then redeems it itself and acts
// only with what it grants; any other bearer on the same path is
// authenticated as usual (API key, JWT), so a signed-in caller still works
// and a forged or dead one is a 401.
//
// Exact paths only, never a prefix: nothing else on the segment is affected.
// Module state is process-global, like the routes it guards.

type BearerVerifier = (token: string) => boolean

const verifiers = new Map<string, BearerVerifier>()

/**
 * Accept a module's own bearer keys on `paths` (exact matches). Returns the
 * function that withdraws them (module stop). A path has one verifier: a
 * later registration (a restarted module) replaces the earlier one.
 */
export function registerDelegatedBearer(paths: readonly string[], verify: BearerVerifier): () => void {
  for (const path of paths) {
    if (!path.startsWith('/api/v1/')) throw new Error(`delegated bearer path must be an /api/v1 path: ${path}`)
  }
  for (const path of paths) verifiers.set(path, verify)
  return () => {
    for (const path of paths) {
      if (verifiers.get(path) === verify) verifiers.delete(path)
    }
  }
}

/** True when `path` has a delegated verifier and it accepts `token`. A throwing verifier refuses. */
export function acceptsDelegatedBearer(path: string, token: string): boolean {
  const verify = verifiers.get(path)
  if (!verify || !token) return false
  try {
    return verify(token) === true
  } catch {
    return false
  }
}

/** Tests only. */
export function resetDelegatedBearers(): void {
  verifiers.clear()
}
