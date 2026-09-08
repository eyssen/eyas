---
name: secret-management
description: Secret management patterns — environment variables, vaults, and rotation
trigger_patterns:
  - "secret management"
  - "api key storage"
  - "environment variable"
  - "vault"
  - "secret rotation"
capabilities:
  - security
version: "1.0.0"
---
# Secret Management

## Hierarchy of Secret Storage
1. **Hardware Security Module (HSM)** — highest security, hardware-backed
2. **Secret manager** (Vault, AWS Secrets Manager) — encrypted, audited, rotatable
3. **Encrypted config file** — AES-encrypted at rest, key from env
4. **Environment variables** — acceptable for non-sensitive config
5. **Plaintext config file** — NEVER for secrets

## Environment Variables Pattern
```bash
# .env.example (committed — no real values)
DATABASE_URL=postgresql://user:password@localhost:5432/db
JWT_SECRET=change-me-in-production

# .env (NEVER committed — in .gitignore)
DATABASE_URL=postgresql://prod_user:s3cr3t@db.internal:5432/app
JWT_SECRET=a1b2c3d4e5f6...
```

## Runtime Secret Loading
```typescript
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const config = {
  dbUrl: requireEnv('DATABASE_URL'),
  jwtSecret: requireEnv('JWT_SECRET'),
} as const;
```

## Secret Rotation
1. Generate new secret
2. Configure app to accept both old and new (dual-read period)
3. Update all consumers to use new secret
4. Remove old secret after grace period
5. Verify old secret no longer works

## Best Practices
- Never log secrets — mask them in log output
- Never commit secrets to git (use `.gitignore`, pre-commit hooks)
- Use different secrets per environment (dev, staging, prod)
- Audit secret access — who read what, when
- Set expiration on secrets — force rotation
- Use short-lived tokens where possible (15 min JWT vs permanent API key)
- Scan repos for leaked secrets (gitleaks, truffleHog)
