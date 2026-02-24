import { describe, it, expect } from 'vitest'
import {
  generateDek,
  buildAad,
  encryptValue,
  decryptValue,
  wrapDek,
  unwrapDek,
} from '../core/crypto.js'

describe('crypto', () => {
  describe('generateDek', () => {
    it('returns a 32-byte buffer', () => {
      const dek = generateDek()
      expect(Buffer.isBuffer(dek)).toBe(true)
      expect(dek.length).toBe(32)
    })

    it('generates unique keys', () => {
      const a = generateDek()
      const b = generateDek()
      expect(a.equals(b)).toBe(false)
    })
  })

  describe('buildAad', () => {
    it('produces expected format', () => {
      const aad = buildAad('abc-123', 'my-secret')
      expect(aad.toString('utf-8')).toBe('2kc:v1:abc-123:my-secret')
    })
  })

  describe('encryptValue / decryptValue', () => {
    it('round-trips plaintext', () => {
      const dek = generateDek()
      const aad = buildAad('uuid-1', 'ref-1')
      const plaintext = 'super-secret-api-key'

      const encrypted = encryptValue(dek, plaintext, aad)
      const decrypted = decryptValue(dek, encrypted.ciphertext, encrypted.nonce, encrypted.tag, aad)

      expect(decrypted).toBe(plaintext)
    })

    it('round-trips empty string', () => {
      const dek = generateDek()
      const aad = buildAad('uuid-2', 'ref-2')

      const encrypted = encryptValue(dek, '', aad)
      const decrypted = decryptValue(dek, encrypted.ciphertext, encrypted.nonce, encrypted.tag, aad)

      expect(decrypted).toBe('')
    })

    it('round-trips unicode', () => {
      const dek = generateDek()
      const aad = buildAad('uuid-3', 'ref-3')
      const plaintext = '🔑 密码 пароль'

      const encrypted = encryptValue(dek, plaintext, aad)
      const decrypted = decryptValue(dek, encrypted.ciphertext, encrypted.nonce, encrypted.tag, aad)

      expect(decrypted).toBe(plaintext)
    })

    it('detects AAD mismatch', () => {
      const dek = generateDek()
      const aad1 = buildAad('uuid-1', 'ref-1')
      const aad2 = buildAad('uuid-1', 'ref-WRONG')

      const encrypted = encryptValue(dek, 'secret', aad1)

      expect(() =>
        decryptValue(dek, encrypted.ciphertext, encrypted.nonce, encrypted.tag, aad2),
      ).toThrow()
    })

    it('detects tampered ciphertext', () => {
      const dek = generateDek()
      const aad = buildAad('uuid-1', 'ref-1')

      const encrypted = encryptValue(dek, 'secret', aad)

      // Flip a byte in ciphertext
      const buf = Buffer.from(encrypted.ciphertext, 'base64')
      buf[0] ^= 0xff
      const tampered = buf.toString('base64')

      expect(() => decryptValue(dek, tampered, encrypted.nonce, encrypted.tag, aad)).toThrow()
    })

    it('detects tampered tag', () => {
      const dek = generateDek()
      const aad = buildAad('uuid-1', 'ref-1')

      const encrypted = encryptValue(dek, 'secret', aad)

      const tagBuf = Buffer.from(encrypted.tag, 'base64')
      tagBuf[0] ^= 0xff
      const tamperedTag = tagBuf.toString('base64')

      expect(() =>
        decryptValue(dek, encrypted.ciphertext, encrypted.nonce, tamperedTag, aad),
      ).toThrow()
    })

    it('generates unique nonces per encryption', () => {
      const dek = generateDek()
      const aad = buildAad('uuid-1', 'ref-1')

      const a = encryptValue(dek, 'same plaintext', aad)
      const b = encryptValue(dek, 'same plaintext', aad)

      expect(a.nonce).not.toBe(b.nonce)
    })

    it('fails with wrong key', () => {
      const dek1 = generateDek()
      const dek2 = generateDek()
      const aad = buildAad('uuid-1', 'ref-1')

      const encrypted = encryptValue(dek1, 'secret', aad)

      expect(() =>
        decryptValue(dek2, encrypted.ciphertext, encrypted.nonce, encrypted.tag, aad),
      ).toThrow()
    })
  })

  describe('wrapDek / unwrapDek', () => {
    it('round-trips a DEK', () => {
      const kek = generateDek() // KEK is also 256-bit
      const dek = generateDek()

      const wrapped = wrapDek(kek, dek)
      const unwrapped = unwrapDek(kek, wrapped.ciphertext, wrapped.nonce, wrapped.tag)

      expect(unwrapped.equals(dek)).toBe(true)
    })

    it('fails with wrong KEK', () => {
      const kek1 = generateDek()
      const kek2 = generateDek()
      const dek = generateDek()

      const wrapped = wrapDek(kek1, dek)

      expect(() => unwrapDek(kek2, wrapped.ciphertext, wrapped.nonce, wrapped.tag)).toThrow()
    })

    it('detects tampered wrapped DEK', () => {
      const kek = generateDek()
      const dek = generateDek()

      const wrapped = wrapDek(kek, dek)

      const buf = Buffer.from(wrapped.ciphertext, 'base64')
      buf[0] ^= 0xff
      const tampered = buf.toString('base64')

      expect(() => unwrapDek(kek, tampered, wrapped.nonce, wrapped.tag)).toThrow()
    })
  })
})
