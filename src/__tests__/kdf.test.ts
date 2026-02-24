import { describe, it, expect } from 'vitest'
import { generateSalt, deriveKek, DEFAULT_SCRYPT_PARAMS } from '../core/kdf.js'

// Use low-cost params for fast tests
const TEST_PARAMS = { N: 1024, r: 8, p: 1 }

describe('kdf', () => {
  describe('generateSalt', () => {
    it('returns a 16-byte buffer', () => {
      const salt = generateSalt()
      expect(Buffer.isBuffer(salt)).toBe(true)
      expect(salt.length).toBe(16)
    })

    it('generates unique salts', () => {
      const a = generateSalt()
      const b = generateSalt()
      expect(a.equals(b)).toBe(false)
    })
  })

  describe('deriveKek', () => {
    it('returns a 32-byte buffer', async () => {
      const salt = generateSalt()
      const kek = await deriveKek('my-password', salt, TEST_PARAMS)
      expect(Buffer.isBuffer(kek)).toBe(true)
      expect(kek.length).toBe(32)
    })

    it('is deterministic for same password + salt', async () => {
      const salt = generateSalt()
      const a = await deriveKek('same-password', salt, TEST_PARAMS)
      const b = await deriveKek('same-password', salt, TEST_PARAMS)
      expect(a.equals(b)).toBe(true)
    })

    it('produces different output for different salts', async () => {
      const salt1 = generateSalt()
      const salt2 = generateSalt()
      const a = await deriveKek('same-password', salt1, TEST_PARAMS)
      const b = await deriveKek('same-password', salt2, TEST_PARAMS)
      expect(a.equals(b)).toBe(false)
    })

    it('produces different output for different passwords', async () => {
      const salt = generateSalt()
      const a = await deriveKek('password-1', salt, TEST_PARAMS)
      const b = await deriveKek('password-2', salt, TEST_PARAMS)
      expect(a.equals(b)).toBe(false)
    })

    it('rejects empty password', async () => {
      const salt = generateSalt()
      await expect(deriveKek('', salt, TEST_PARAMS)).rejects.toThrow('Password must not be empty')
    })

    it('uses default params when none provided', async () => {
      expect(DEFAULT_SCRYPT_PARAMS.N).toBe(32768)
      expect(DEFAULT_SCRYPT_PARAMS.r).toBe(8)
      expect(DEFAULT_SCRYPT_PARAMS.p).toBe(1)
    })
  })
})
