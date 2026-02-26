import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { AccessRequest } from './request.js'
import { signGrant } from './signed-grant.js'

export interface AccessGrant {
  id: string
  requestId: string
  secretUuids: string[]
  grantedAt: string
  expiresAt: string
  used: boolean
  revokedAt: string | null
  commandHash?: string
}

const DEFAULT_GRANTS_PATH = join(homedir(), '.2kc', 'grants.json')

export class GrantManager {
  private grants: Map<string, AccessGrant> = new Map()
  private readonly grantsFilePath: string

  constructor(
    grantsFilePath: string = DEFAULT_GRANTS_PATH,
    private readonly signingKey: CryptoKey | null = null,
  ) {
    this.grantsFilePath = grantsFilePath
    this.load()
  }

  async createGrant(request: AccessRequest): Promise<{ grant: AccessGrant; jws: string | null }> {
    if (request.status !== 'approved') {
      throw new Error(`Cannot create grant for request with status: ${request.status}`)
    }
    const now = Date.now()
    const grant: AccessGrant = {
      id: randomUUID(),
      requestId: request.id,
      secretUuids: request.secretUuids,
      grantedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + request.durationSeconds * 1000).toISOString(),
      used: false,
      revokedAt: null,
      commandHash: request.commandHash,
    }
    this.grants.set(grant.id, grant)
    let jws: string | null = null
    if (this.signingKey) {
      jws = await signGrant(grant, this.signingKey)
    }
    this.save()
    return { grant, jws }
  }

  validateGrant(grantId: string): boolean {
    const grant = this.grants.get(grantId)
    if (!grant) return false
    if (Date.now() > new Date(grant.expiresAt).getTime()) return false
    if (grant.used) return false
    if (grant.revokedAt !== null) return false
    return true
  }

  markUsed(grantId: string): void {
    const grant = this.grants.get(grantId)
    if (!grant) {
      throw new Error(`Grant not found: ${grantId}`)
    }
    if (!this.validateGrant(grantId)) {
      throw new Error(`Grant is not valid: ${grantId}`)
    }
    grant.used = true
    this.save()
  }

  revokeGrant(grantId: string): void {
    const grant = this.grants.get(grantId)
    if (!grant) {
      throw new Error(`Grant not found: ${grantId}`)
    }
    if (grant.revokedAt !== null) {
      throw new Error(`Grant already revoked: ${grantId}`)
    }
    grant.revokedAt = new Date().toISOString()
    this.save()
  }

  cleanup(): void {
    const now = Date.now()
    // Deleting from a Map during for..of iteration is safe per the ES spec.
    for (const [id, grant] of this.grants) {
      if (now > new Date(grant.expiresAt).getTime()) {
        this.grants.delete(id)
      }
    }
  }

  getGrant(grantId: string): AccessGrant | undefined {
    const grant = this.grants.get(grantId)
    if (!grant) return undefined
    return { ...grant }
  }

  getGrantSecrets(grantId: string): string[] | undefined {
    const grant = this.grants.get(grantId)
    if (!grant) return undefined
    return [...grant.secretUuids]
  }

  getGrantByRequestId(requestId: string): AccessGrant | undefined {
    for (const grant of this.grants.values()) {
      if (grant.requestId === requestId) return { ...grant }
    }
    return undefined
  }

  private load(): void {
    try {
      const data = JSON.parse(readFileSync(this.grantsFilePath, 'utf-8')) as AccessGrant[]
      for (const grant of data) this.grants.set(grant.id, grant)
    } catch {
      // File absent or corrupted — start with empty map
    }
  }

  private save(): void {
    const dir = dirname(this.grantsFilePath)
    mkdirSync(dir, { recursive: true })
    const grants = [...this.grants.values()]
    writeFileSync(this.grantsFilePath, JSON.stringify(grants, null, 2), 'utf-8')
    chmodSync(this.grantsFilePath, 0o600)
  }
}
