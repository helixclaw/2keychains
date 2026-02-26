/// <reference types="vitest/globals" />
import { generateKeyPair } from 'jose'
import { randomUUID } from 'node:crypto'
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { signGrant, verifyGrant } from '../core/signed-grant.js'
import { loadOrGenerateKeyPair } from '../core/key-manager.js'
import type { AccessGrant } from '../core/grant.js'

function makeGrant(overrides: Partial<AccessGrant> = {}): AccessGrant {
  const now = Date.now()
  return {
    id: randomUUID(),
    requestId: randomUUID(),
    secretUuids: [randomUUID(), randomUUID()],
    grantedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 3600 * 1000).toISOString(),
    used: false,
    revokedAt: null,
    ...overrides,
  }
}

describe('signGrant / verifyGrant', () => {
  let publicKey: CryptoKey
  let privateKey: CryptoKey

  beforeAll(async () => {
    const keys = await generateKeyPair('EdDSA')
    publicKey = keys.publicKey
    privateKey = keys.privateKey
  })

  describe('round-trip', () => {
    it('verifyGrant returns decoded payload matching original grant', async () => {
      const grant = makeGrant()
      const jws = await signGrant(grant, privateKey)
      const payload = await verifyGrant(jws, publicKey)

      expect(payload.id).toBe(grant.id)
      expect(payload.requestId).toBe(grant.requestId)
      expect(payload.secretUuids).toEqual(grant.secretUuids)
    })

    it('maps jti → id, sub → requestId, secretUuids, grantedAt, expiresAt', async () => {
      const grant = makeGrant()
      const jws = await signGrant(grant, privateKey)
      const payload = await verifyGrant(jws, publicKey)

      expect(payload.id).toBe(grant.id)
      expect(payload.requestId).toBe(grant.requestId)
      expect(payload.secretUuids).toEqual(grant.secretUuids)
      // grantedAt/expiresAt are reconstructed from iat/exp (second precision — within 1s)
      expect(
        Math.abs(new Date(payload.grantedAt).getTime() - new Date(grant.grantedAt).getTime()),
      ).toBeLessThan(1000)
      expect(
        Math.abs(new Date(payload.expiresAt).getTime() - new Date(grant.expiresAt).getTime()),
      ).toBeLessThan(1000)
    })

    it('commandHash present in payload when provided to signGrant', async () => {
      const grant = makeGrant()
      const hash = 'sha256:abc123'
      const jws = await signGrant(grant, privateKey, hash)
      const payload = await verifyGrant(jws, publicKey)

      expect(payload.commandHash).toBe(hash)
    })

    it('commandHash absent when not provided to signGrant', async () => {
      const grant = makeGrant()
      const jws = await signGrant(grant, privateKey)
      const payload = await verifyGrant(jws, publicKey)

      expect(payload.commandHash).toBeUndefined()
    })
  })

  describe('tamper rejection', () => {
    it('throws when compact JWS payload is base64-modified after signing', async () => {
      const grant = makeGrant()
      const jws = await signGrant(grant, privateKey)

      // A compact JWS has three parts: header.payload.signature
      const parts = jws.split('.')
      // Modify the payload part by appending a character
      parts[1] = parts[1] + 'X'
      const tampered = parts.join('.')

      await expect(verifyGrant(tampered, publicKey)).rejects.toThrow()
    })

    it('throws when signed with a different private key', async () => {
      const grant = makeGrant()
      const { privateKey: otherPrivateKey } = await generateKeyPair('EdDSA')
      const jws = await signGrant(grant, otherPrivateKey)

      await expect(verifyGrant(jws, publicKey)).rejects.toThrow()
    })
  })

  describe('expiry', () => {
    it('throws when grant expiresAt is in the past (expired JWS)', async () => {
      const expiredGrant = makeGrant({
        grantedAt: new Date(Date.now() - 7200 * 1000).toISOString(),
        expiresAt: new Date(Date.now() - 3600 * 1000).toISOString(),
      })
      const jws = await signGrant(expiredGrant, privateKey)

      await expect(verifyGrant(jws, publicKey)).rejects.toThrow()
    })
  })

  describe('commandHash', () => {
    it('round-trips commandHash value correctly', async () => {
      const grant = makeGrant()
      const hash = 'sha256:deadbeef1234567890'
      const jws = await signGrant(grant, privateKey, hash)
      const payload = await verifyGrant(jws, publicKey)

      expect(payload.commandHash).toBe(hash)
    })

    it('verifyGrant returns undefined commandHash when not included', async () => {
      const grant = makeGrant()
      const jws = await signGrant(grant, privateKey)
      const payload = await verifyGrant(jws, publicKey)

      expect('commandHash' in payload).toBe(false)
    })
  })
})

describe('loadOrGenerateKeyPair', () => {
  const tempPaths: string[] = []

  afterEach(() => {
    for (const p of tempPaths) {
      try {
        rmSync(p, { force: true })
      } catch {
        // ignore cleanup errors
      }
    }
    tempPaths.length = 0
  })

  function tempKeyPath(): string {
    const p = join(tmpdir(), `2kc-test-${randomUUID()}`, 'server-keys.json')
    tempPaths.push(p)
    return p
  }

  it('generates a new keypair and writes server-keys.json when file absent', async () => {
    const keyPath = tempKeyPath()
    await loadOrGenerateKeyPair(keyPath)

    const stat = statSync(keyPath)
    expect(stat.isFile()).toBe(true)
  })

  it('sets 0o600 permissions on the generated key file', async () => {
    const keyPath = tempKeyPath()
    await loadOrGenerateKeyPair(keyPath)

    const stat = statSync(keyPath)

    const mode = stat.mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('loads existing keypair from file without regenerating (idempotent)', async () => {
    const keyPath = tempKeyPath()
    const first = await loadOrGenerateKeyPair(keyPath)
    const second = await loadOrGenerateKeyPair(keyPath)

    // Both calls should return keys that can sign/verify with each other
    const grant = makeGrant()
    const jws = await signGrant(grant, first.privateKey)
    const payload = await verifyGrant(jws, second.publicKey)
    expect(payload.id).toBe(grant.id)
  })

  it('generated keys produce a valid sign/verify round-trip', async () => {
    const keyPath = tempKeyPath()
    const { publicKey, privateKey } = await loadOrGenerateKeyPair(keyPath)

    const grant = makeGrant()
    const jws = await signGrant(grant, privateKey)
    const payload = await verifyGrant(jws, publicKey)

    expect(payload.id).toBe(grant.id)
    expect(payload.secretUuids).toEqual(grant.secretUuids)
  })

  it('regenerates keys when key file contains invalid JSON', async () => {
    const keyPath = tempKeyPath()
    // Write invalid JSON to the key file
    mkdirSync(dirname(keyPath), { recursive: true })
    writeFileSync(keyPath, 'not valid json', 'utf-8')

    const keys = await loadOrGenerateKeyPair(keyPath)
    expect(keys.publicKey).toBeDefined()
    expect(keys.privateKey).toBeDefined()
  })

  it('regenerates keys when key file contains valid JSON but wrong key format', async () => {
    const keyPath = tempKeyPath()
    mkdirSync(dirname(keyPath), { recursive: true })
    writeFileSync(
      keyPath,
      JSON.stringify({
        publicKey: { kty: 'RSA', n: 'abc' },
        privateKey: { kty: 'RSA', n: 'abc' },
      }),
      'utf-8',
    )

    const keys = await loadOrGenerateKeyPair(keyPath)
    expect(keys.publicKey).toBeDefined()
    expect(keys.privateKey).toBeDefined()
  })
})

describe('verifyGrant claim validation', () => {
  let publicKey: CryptoKey
  let privateKey: CryptoKey

  beforeAll(async () => {
    const keys = await generateKeyPair('EdDSA')
    publicKey = keys.publicKey
    privateKey = keys.privateKey
  })

  it('throws when jti claim is missing', async () => {
    const { SignJWT } = await import('jose')
    const jws = await new SignJWT({ secretUuids: ['a'] })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setSubject('req-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey)

    await expect(verifyGrant(jws, publicKey)).rejects.toThrow('Missing jti claim')
  })

  it('throws when sub claim is missing', async () => {
    const { SignJWT } = await import('jose')
    const jws = await new SignJWT({ secretUuids: ['a'] })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setJti('grant-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey)

    await expect(verifyGrant(jws, publicKey)).rejects.toThrow('Missing sub claim')
  })

  it('throws when secretUuids claim is missing', async () => {
    const { SignJWT } = await import('jose')
    const jws = await new SignJWT({})
      .setProtectedHeader({ alg: 'EdDSA' })
      .setJti('grant-1')
      .setSubject('req-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey)

    await expect(verifyGrant(jws, publicKey)).rejects.toThrow('Missing or invalid secretUuids')
  })

  it('throws when iat claim is missing', async () => {
    const { SignJWT } = await import('jose')
    const jws = await new SignJWT({ secretUuids: ['a'] })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setJti('grant-1')
      .setSubject('req-1')
      .setExpirationTime('1h')
      .sign(privateKey)

    await expect(verifyGrant(jws, publicKey)).rejects.toThrow('Missing iat claim')
  })

  it('throws when exp claim is missing', async () => {
    const { SignJWT } = await import('jose')
    const jws = await new SignJWT({ secretUuids: ['a'] })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setJti('grant-1')
      .setSubject('req-1')
      .setIssuedAt()
      .sign(privateKey)

    await expect(verifyGrant(jws, publicKey)).rejects.toThrow('Missing exp claim')
  })

  it('throws when secretUuids contains non-string elements', async () => {
    const { SignJWT } = await import('jose')
    const jws = await new SignJWT({ secretUuids: [123, true] })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setJti('grant-1')
      .setSubject('req-1')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey)

    await expect(verifyGrant(jws, publicKey)).rejects.toThrow('Missing or invalid secretUuids')
  })
})
