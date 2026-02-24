import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const NONCE_LENGTH = 12 // 96-bit for AES-GCM
const KEY_LENGTH = 32 // 256-bit
const TAG_LENGTH = 16 // 128-bit auth tag

export interface EncryptedValue {
  ciphertext: string // base64
  nonce: string // base64
  tag: string // base64
}

/**
 * Generate a random 256-bit Data Encryption Key (DEK).
 */
export function generateDek(): Buffer {
  return randomBytes(KEY_LENGTH)
}

/**
 * Build the AAD string for a secret entry.
 */
export function buildAad(uuid: string, ref: string): Buffer {
  return Buffer.from(`2kc:v1:${uuid}:${ref}`, 'utf-8')
}

/**
 * Encrypt a plaintext value using AES-256-GCM.
 */
export function encryptValue(dek: Buffer, plaintext: string, aad: Buffer): EncryptedValue {
  const nonce = randomBytes(NONCE_LENGTH)
  const cipher = createCipheriv(ALGORITHM, dek, nonce, { authTagLength: TAG_LENGTH })
  cipher.setAAD(aad)

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    ciphertext: encrypted.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: tag.toString('base64'),
  }
}

/**
 * Decrypt a ciphertext value using AES-256-GCM.
 */
export function decryptValue(
  dek: Buffer,
  ciphertext: string,
  nonce: string,
  tag: string,
  aad: Buffer,
): string {
  const decipher = createDecipheriv(ALGORITHM, dek, Buffer.from(nonce, 'base64'), {
    authTagLength: TAG_LENGTH,
  })
  decipher.setAAD(aad)
  decipher.setAuthTag(Buffer.from(tag, 'base64'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ])

  return decrypted.toString('utf-8')
}

/**
 * Wrap (encrypt) a DEK with a KEK using AES-256-GCM.
 */
export function wrapDek(kek: Buffer, dek: Buffer): EncryptedValue {
  const nonce = randomBytes(NONCE_LENGTH)
  const cipher = createCipheriv(ALGORITHM, kek, nonce, { authTagLength: TAG_LENGTH })

  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    ciphertext: encrypted.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: tag.toString('base64'),
  }
}

/**
 * Unwrap (decrypt) a DEK using a KEK.
 */
export function unwrapDek(kek: Buffer, wrappedDek: string, nonce: string, tag: string): Buffer {
  const decipher = createDecipheriv(ALGORITHM, kek, Buffer.from(nonce, 'base64'), {
    authTagLength: TAG_LENGTH,
  })
  decipher.setAuthTag(Buffer.from(tag, 'base64'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(wrappedDek, 'base64')),
    decipher.final(),
  ])

  return decrypted
}
