import { scrypt, randomBytes } from 'node:crypto'

const SALT_LENGTH = 16 // 128-bit
const KEY_LENGTH = 32 // 256-bit KEK

export interface ScryptParams {
  N: number // CPU/memory cost (must be power of 2)
  r: number // block size
  p: number // parallelization
}

/** Secure defaults: N=2^15=32768, r=8, p=1 */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = {
  N: 32768,
  r: 8,
  p: 1,
}

/**
 * Generate a random 128-bit salt.
 */
export function generateSalt(): Buffer {
  return randomBytes(SALT_LENGTH)
}

/**
 * Derive a 256-bit KEK from a password and salt using scrypt.
 * Async to avoid blocking the event loop.
 */
export function deriveKek(
  password: string,
  salt: Buffer,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): Promise<Buffer> {
  if (!password) {
    return Promise.reject(new Error('Password must not be empty'))
  }

  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: params.N, r: params.r, p: params.p, maxmem: 256 * params.N * params.r },
      (err, derivedKey) => {
        if (err) return reject(err)
        resolve(derivedKey)
      },
    )
  })
}
