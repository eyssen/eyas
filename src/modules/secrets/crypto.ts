const PBKDF2_ITERATIONS = 600_000

export async function generateMasterKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
}

export async function deriveMasterKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptSecret(
  plaintext: string,
  key: CryptoKey,
): Promise<{ encrypted: string; iv: string; tag: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    encoded,
  )
  // AES-GCM appends the 16-byte auth tag to the ciphertext
  const cipherArray = new Uint8Array(cipherBuffer)
  const ciphertext = cipherArray.slice(0, -16)
  const authTag = cipherArray.slice(-16)

  return {
    encrypted: toBase64(ciphertext),
    iv: toBase64(iv),
    tag: toBase64(authTag),
  }
}

export async function decryptSecret(
  encrypted: string,
  iv: string,
  tag: string,
  key: CryptoKey,
): Promise<string> {
  const ciphertext = fromBase64(encrypted)
  const ivBytes = fromBase64(iv)
  const authTag = fromBase64(tag)
  // Reconstruct combined buffer (ciphertext + tag) for AES-GCM
  const combined = new Uint8Array(ciphertext.length + authTag.length)
  combined.set(ciphertext)
  combined.set(authTag, ciphertext.length)

  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes.buffer as ArrayBuffer, tagLength: 128 },
    key,
    combined.buffer as ArrayBuffer,
  )
  return new TextDecoder().decode(plainBuffer)
}

export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key)
  return Array.from(new Uint8Array(raw)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function importKey(hex: string): Promise<CryptoKey> {
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)))
  return crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function fromBase64(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64'))
}
