import { randomUUID } from 'node:crypto'
import type { AccessRequest } from './request.js'

export interface AccessGrant {
  id: string
  requestId: string
  secretUuids: string[]
  grantedAt: string
  expiresAt: string
  used: boolean
  revokedAt: string | null
}

export class GrantManager {
  private grants: Map<string, AccessGrant> = new Map()

  createGrant(request: AccessRequest): AccessGrant {
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
    }
    this.grants.set(grant.id, grant)
    return grant
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
}
