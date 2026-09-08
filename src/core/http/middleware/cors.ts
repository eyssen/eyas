import { cors } from 'hono/cors'

export function createCorsMiddleware(allowedOrigins?: string[]) {
  const hasAllowlist = !!allowedOrigins?.length
  return cors({
    origin: hasAllowlist ? allowedOrigins! : '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Eyas-Request'],
    // Credentials are only safe with an explicit origin allowlist. Combining
    // credentials:true with a wildcard/reflected origin lets any site make
    // credentialed cross-origin requests (CSRF-via-CORS), so when no allowlist
    // is configured we serve a wildcard WITHOUT credentials.
    credentials: hasAllowlist,
    maxAge: 86400,
  })
}

/** @deprecated Use createCorsMiddleware(origins) for configurable CORS */
export const corsMiddleware = createCorsMiddleware()
