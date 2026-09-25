---
name: encryption
description: Encryption fundamentals — symmetric, asymmetric, hashing, and key management
trigger_patterns:
  - "encryption"
  - "aes"
  - "hashing"
  - "cryptography"
  - "key management"
capabilities:
  - security
version: "1.0.0"
---
# Encryption Best Practices

## Symmetric Encryption (AES-256-GCM)
```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function encrypt(plaintext: string, key: Buffer): { ciphertext: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decrypt(data: { ciphertext: string; iv: string; tag: string }, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(data.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(data.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
```

## Hashing (One-Way)
- **Passwords** — bcrypt (cost 12+) or argon2id
- **Data integrity** — SHA-256
- **HMAC** — SHA-256 with secret key (webhook signatures, API auth)

## Algorithm Selection
| Use Case | Algorithm | Notes |
|----------|-----------|-------|
| Encrypt data at rest | AES-256-GCM | Authenticated encryption |
| Password storage | bcrypt / argon2id | Slow by design |
| Data integrity | SHA-256 | Fast, no key needed |
| Message authentication | HMAC-SHA256 | Requires shared secret |
| Asymmetric (signing) | Ed25519 | Modern, fast |
| Key exchange | X25519 | ECDH curve |

## Key Management
- Generate keys with `crypto.randomBytes(32)` — never use passwords directly
- Derive keys from passwords with PBKDF2 or scrypt
- Rotate encryption keys periodically — re-encrypt data with new key
- Store keys separately from encrypted data
- Use envelope encryption for large datasets

## Security Rules
- Never implement your own crypto — use established libraries
- Always use authenticated encryption (GCM, not ECB/CBC without HMAC)
- Use unique IV/nonce for every encryption operation
- Use constant-time comparison for MACs and signatures
