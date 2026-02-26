import { generateKeyPair, exportSPKI, SignJWT } from 'jose'

import { GrantVerifier } from '../core/grant-verifier.js'
import type { GrantJWSPayload } from '../core/grant-verifier.js'

async function makeKeyPair() {
  return generateKeyPair('EdDSA', { crv: 'Ed25519' })
}

async function makeJWS(
  payload: Partial<GrantJWSPayload>,
  privateKey: CryptoKey,
  options?: { expiresAt?: Date },
): Promise<string> {
  const expiresAt = options?.expiresAt ?? new Date(Date.now() + 60_000)
  const fullPayload: GrantJWSPayload = {
    grantId: 'grant-1',
    requestId: 'req-1',
    secretUuids: ['uuid-1'],
    expiresAt: expiresAt.toISOString(),
    ...payload,
  }
  return new SignJWT(fullPayload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'EdDSA' })
    .sign(privateKey)
}

function mockFetchPublicKey(publicKeyPem: string, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue({ publicKey: publicKeyPem }),
  } as unknown as Response)
}

describe('GrantVerifier', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  describe('fetchPublicKey', () => {
    it('fetches public key from GET /api/keys/public', async () => {
      const { privateKey, publicKey } = await makeKeyPair()
      const pem = await exportSPKI(publicKey)
      const fetchMock = mockFetchPublicKey(pem)
      globalThis.fetch = fetchMock

      const verifier = new GrantVerifier('http://127.0.0.1:2274', 'test-token')
      const key = await verifier.fetchPublicKey()

      expect(key).toBeDefined()
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:2274/api/keys/public',
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-token' },
        }),
      )
      // suppress unused warning
      void privateKey
    })

    it('caches public key for subsequent calls', async () => {
      const { publicKey } = await makeKeyPair()
      const pem = await exportSPKI(publicKey)
      const fetchMock = mockFetchPublicKey(pem)
      globalThis.fetch = fetchMock

      const verifier = new GrantVerifier('http://127.0.0.1:2274', 'test-token')
      await verifier.fetchPublicKey()
      await verifier.fetchPublicKey()

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('refreshes cache after TTL expires', async () => {
      const { publicKey } = await makeKeyPair()
      const pem = await exportSPKI(publicKey)
      const fetchMock = mockFetchPublicKey(pem)
      globalThis.fetch = fetchMock

      const verifier = new GrantVerifier('http://127.0.0.1:2274', 'test-token')
      // First call
      await verifier.fetchPublicKey()
      // Manually expire cache by setting cachedAt to far in the past
      ;(verifier as unknown as { cachedAt: number }).cachedAt = Date.now() - 10 * 60 * 1000

      await verifier.fetchPublicKey()

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('throws clear error when server unreachable', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))

      const verifier = new GrantVerifier('http://127.0.0.1:2274', 'test-token')
      await expect(verifier.fetchPublicKey()).rejects.toThrow(
        'Server not running. Start with `2kc server start`',
      )
    })

    it('throws on non-OK response', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: vi.fn().mockResolvedValue({}),
      } as unknown as Response)
      globalThis.fetch = fetchMock

      const verifier = new GrantVerifier('http://127.0.0.1:2274', 'test-token')
      await expect(verifier.fetchPublicKey()).rejects.toThrow('Failed to fetch server public key')
    })

    it('throws timeout error when fetch times out with DOMException', async () => {
      const err = new DOMException('The operation was aborted', 'TimeoutError')
      globalThis.fetch = vi.fn().mockRejectedValue(err)

      const verifier = new GrantVerifier('http://127.0.0.1:2274', 'test-token')
      await expect(verifier.fetchPublicKey()).rejects.toThrow(
        'Request timed out after 30s. Is the server responding?',
      )
    })

    it('re-throws unexpected non-TypeError errors from fetch', async () => {
      const err = new RangeError('unexpected')
      globalThis.fetch = vi.fn().mockRejectedValue(err)

      const verifier = new GrantVerifier('http://127.0.0.1:2274', 'test-token')
      await expect(verifier.fetchPublicKey()).rejects.toThrow('unexpected')
    })
  })

  describe('verifyGrant', () => {
    let privateKey: CryptoKey
    let publicKeyPem: string
    let verifier: GrantVerifier

    beforeEach(async () => {
      const keyPair = await makeKeyPair()
      privateKey = keyPair.privateKey
      publicKeyPem = await exportSPKI(keyPair.publicKey)
      globalThis.fetch = mockFetchPublicKey(publicKeyPem)
      verifier = new GrantVerifier('http://127.0.0.1:2274', 'test-token')
    })

    it('returns parsed payload for valid JWS', async () => {
      const jws = await makeJWS({}, privateKey)
      const payload = await verifier.verifyGrant(jws)

      expect(payload.grantId).toBe('grant-1')
      expect(payload.requestId).toBe('req-1')
      expect(payload.secretUuids).toEqual(['uuid-1'])
    })

    it('rejects tampered JWS signature', async () => {
      const jws = await makeJWS({}, privateKey)
      // Tamper with the payload part (middle segment)
      const parts = jws.split('.')
      parts[1] = Buffer.from(JSON.stringify({ tampered: true })).toString('base64url')
      const tampered = parts.join('.')

      await expect(verifier.verifyGrant(tampered)).rejects.toThrow('Invalid grant signature')
    })

    it('rejects grant with missing required fields (no grantId)', async () => {
      const jws = await new SignJWT({
        requestId: 'req-1',
        secretUuids: ['uuid-1'],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
        .setProtectedHeader({ alg: 'EdDSA' })
        .sign(privateKey)

      await expect(verifier.verifyGrant(jws)).rejects.toThrow('Grant is missing required fields')
    })

    it('rejects grant with missing expiresAt', async () => {
      const jws = await new SignJWT({
        grantId: 'grant-1',
        requestId: 'req-1',
        secretUuids: ['uuid-1'],
      })
        .setProtectedHeader({ alg: 'EdDSA' })
        .sign(privateKey)

      await expect(verifier.verifyGrant(jws)).rejects.toThrow('Grant is missing expiry claim')
    })

    it('rejects expired grant (expiresAt in past)', async () => {
      const pastDate = new Date(Date.now() - 60_000)
      const jws = await makeJWS({}, privateKey, { expiresAt: pastDate })

      await expect(verifier.verifyGrant(jws)).rejects.toThrow('Grant has expired')
    })

    it('rejects when expectedCommandHash provided but payload has no commandHash', async () => {
      const jws = await makeJWS({}, privateKey) // no commandHash in payload

      await expect(verifier.verifyGrant(jws, 'expected-hash')).rejects.toThrow(
        'Grant is missing command hash',
      )
    })

    it('rejects grant with wrong command hash when bound', async () => {
      const jws = await makeJWS({ commandHash: 'expected-hash' }, privateKey)

      await expect(verifier.verifyGrant(jws, 'different-hash')).rejects.toThrow(
        'Grant command hash does not match',
      )
    })

    it('accepts grant with matching command hash', async () => {
      const jws = await makeJWS({ commandHash: 'correct-hash' }, privateKey)

      const payload = await verifier.verifyGrant(jws, 'correct-hash')
      expect(payload.commandHash).toBe('correct-hash')
    })

    it('accepts grant with no command hash binding', async () => {
      const jws = await makeJWS({}, privateKey)

      // No expectedCommandHash — should pass regardless
      const payload = await verifier.verifyGrant(jws)
      expect(payload.commandHash).toBeUndefined()
    })
  })
})
