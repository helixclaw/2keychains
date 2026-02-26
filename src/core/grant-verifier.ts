import { jwtVerify, importSPKI } from 'jose'

export interface GrantJWSPayload {
  grantId: string
  requestId: string
  secretUuids: string[]
  expiresAt: string
  commandHash?: string
}

export class GrantVerifier {
  private cachedKey: CryptoKey | null = null
  private cachedAt = 0
  private readonly cacheTtlMs = 5 * 60 * 1000

  constructor(
    private readonly baseUrl: string,
    private readonly authToken: string,
  ) {}

  async fetchPublicKey(): Promise<CryptoKey> {
    const now = Date.now()
    if (this.cachedKey !== null && now - this.cachedAt < this.cacheTtlMs) {
      return this.cachedKey
    }

    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/api/keys/public`, {
        headers: { Authorization: `Bearer ${this.authToken}` },
        signal: AbortSignal.timeout(30_000),
      })
    } catch (err: unknown) {
      if (err instanceof TypeError) {
        throw new Error('Server not running. Start with `2kc server start`')
      }
      if (err instanceof DOMException || (err instanceof Error && err.name === 'TimeoutError')) {
        throw new Error('Request timed out after 30s. Is the server responding?')
      }
      throw err
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch server public key: ${response.status} ${response.statusText}`,
      )
    }

    const body = (await response.json()) as { publicKey: string }
    const key = await importSPKI(body.publicKey, 'EdDSA')

    this.cachedKey = key
    this.cachedAt = now
    return key
  }

  async verifyGrant(jwsToken: string, expectedCommandHash?: string): Promise<GrantJWSPayload> {
    const key = await this.fetchPublicKey()

    let raw: Record<string, unknown>
    try {
      const result = await jwtVerify(jwsToken, key)
      raw = result.payload as Record<string, unknown>
    } catch (err: unknown) {
      if (err instanceof Error) {
        throw new Error(`Invalid grant signature: ${err.message}`)
      }
      throw new Error('Invalid grant: signature verification failed')
    }

    if (!raw.grantId || !raw.requestId || !raw.secretUuids) {
      throw new Error('Grant is missing required fields')
    }

    if (!raw.expiresAt) {
      throw new Error('Grant is missing expiry claim')
    }

    const payload = raw as unknown as GrantJWSPayload

    if (Date.now() > new Date(payload.expiresAt).getTime()) {
      throw new Error('Grant has expired')
    }

    if (expectedCommandHash !== undefined) {
      if (payload.commandHash === undefined) {
        throw new Error('Grant is missing command hash')
      }
      if (payload.commandHash !== expectedCommandHash) {
        throw new Error('Grant command hash does not match the requested command')
      }
    }

    return payload
  }
}
