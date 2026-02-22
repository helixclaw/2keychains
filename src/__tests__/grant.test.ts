/// <reference types="vitest/globals" />

import { GrantManager } from '../core/grant.js'
import { createAccessRequest } from '../core/request.js'

function makeApprovedRequest(durationSeconds = 300) {
  const request = createAccessRequest(
    ['550e8400-e29b-41d4-a716-446655440000'],
    'Need DB credentials for migration',
    'JIRA-1234',
    durationSeconds,
  )
  request.status = 'approved'
  return request
}

function makePendingRequest(durationSeconds = 300) {
  return createAccessRequest(
    ['550e8400-e29b-41d4-a716-446655440000'],
    'Need DB credentials for migration',
    'JIRA-1234',
    durationSeconds,
  )
}

describe('GrantManager', () => {
  describe('createGrant', () => {
    it('creates a grant with a UUID id', () => {
      const manager = new GrantManager()
      const request = makeApprovedRequest()
      const grant = manager.createGrant(request)

      expect(grant.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    })

    it('sets requestId to request.id', () => {
      const manager = new GrantManager()
      const request = makeApprovedRequest()
      const grant = manager.createGrant(request)

      expect(grant.requestId).toBe(request.id)
    })

    it('sets secretUuids from request.secretUuids', () => {
      const manager = new GrantManager()
      const request = makeApprovedRequest()
      const grant = manager.createGrant(request)

      expect(grant.secretUuids).toEqual(request.secretUuids)
    })

    it('sets used to false and revokedAt to null', () => {
      const manager = new GrantManager()
      const request = makeApprovedRequest()
      const grant = manager.createGrant(request)

      expect(grant.used).toBe(false)
      expect(grant.revokedAt).toBeNull()
    })

    it('throws if request is not approved', () => {
      const manager = new GrantManager()
      const request = makePendingRequest()

      expect(() => manager.createGrant(request)).toThrow(
        'Cannot create grant for request with status: pending',
      )
    })

    describe('with fake timers', () => {
      beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-15T10:00:00.000Z'))
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      it('sets grantedAt to current ISO timestamp', () => {
        const manager = new GrantManager()
        const request = makeApprovedRequest()
        const grant = manager.createGrant(request)

        expect(grant.grantedAt).toBe('2026-01-15T10:00:00.000Z')
      })

      it('sets expiresAt to grantedAt + durationSeconds', () => {
        const manager = new GrantManager()
        const request = makeApprovedRequest(300)
        const grant = manager.createGrant(request)

        expect(grant.expiresAt).toBe('2026-01-15T10:05:00.000Z')
      })
    })

    describe('batch', () => {
      it('copies secretUuids array from request', () => {
        const manager = new GrantManager()
        const request = createAccessRequest(
          ['uuid-1', 'uuid-2', 'uuid-3'],
          'batch access',
          'TASK-1',
        )
        request.status = 'approved'
        const grant = manager.createGrant(request)

        expect(grant.secretUuids).toEqual(['uuid-1', 'uuid-2', 'uuid-3'])
      })

      it('preserves all UUIDs in the array', () => {
        const manager = new GrantManager()
        const uuids = ['a', 'b', 'c', 'd', 'e']
        const request = createAccessRequest(uuids, 'batch access', 'TASK-1')
        request.status = 'approved'
        const grant = manager.createGrant(request)

        expect(grant.secretUuids).toHaveLength(5)
        expect(grant.secretUuids).toEqual(uuids)
      })
    })
  })

  describe('validateGrant', () => {
    it('returns true for valid, unexpired, unused, unrevoked grant', () => {
      const manager = new GrantManager()
      const request = makeApprovedRequest()
      const grant = manager.createGrant(request)

      expect(manager.validateGrant(grant.id)).toBe(true)
    })

    it('returns false for non-existent grantId', () => {
      const manager = new GrantManager()

      expect(manager.validateGrant('nonexistent')).toBe(false)
    })

    it('returns false for used grant', () => {
      const manager = new GrantManager()
      const request = makeApprovedRequest()
      const grant = manager.createGrant(request)

      manager.markUsed(grant.id)

      expect(manager.validateGrant(grant.id)).toBe(false)
    })

    it('returns false for revoked grant', () => {
      const manager = new GrantManager()
      const request = makeApprovedRequest()
      const grant = manager.createGrant(request)

      manager.revokeGrant(grant.id)

      expect(manager.validateGrant(grant.id)).toBe(false)
    })

    describe('with fake timers', () => {
      beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-15T10:00:00.000Z'))
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      it('returns false for expired grant', () => {
        const manager = new GrantManager()
        const request = makeApprovedRequest(300)
        const grant = manager.createGrant(request)

        // Advance past expiry
        vi.setSystemTime(new Date('2026-01-15T10:05:00.001Z'))

        expect(manager.validateGrant(grant.id)).toBe(false)
      })
    })
  })

  describe('markUsed', () => {
    it('marks grant as used', () => {
      const manager = new GrantManager()
      const request = makeApprovedRequest()
      const grant = manager.createGrant(request)

      manager.markUsed(grant.id)

      const updated = manager.getGrant(grant.id)
      expect(updated?.used).toBe(true)
    })

    it('throws for non-existent grantId', () => {
      const manager = new GrantManager()

      expect(() => manager.markUsed('nonexistent')).toThrow('Grant not found: nonexistent')
    })

    it('throws if grant already used', () => {
      const manager = new GrantManager()
      const request = makeApprovedRequest()
      const grant = manager.createGrant(request)

      manager.markUsed(grant.id)

      expect(() => manager.markUsed(grant.id)).toThrow(`Grant is not valid: ${grant.id}`)
    })

    it('throws if grant revoked', () => {
      const manager = new GrantManager()
      const request = makeApprovedRequest()
      const grant = manager.createGrant(request)

      manager.revokeGrant(grant.id)

      expect(() => manager.markUsed(grant.id)).toThrow(`Grant is not valid: ${grant.id}`)
    })

    describe('with fake timers', () => {
      beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-15T10:00:00.000Z'))
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      it('throws if grant expired', () => {
        const manager = new GrantManager()
        const request = makeApprovedRequest(300)
        const grant = manager.createGrant(request)

        vi.setSystemTime(new Date('2026-01-15T10:05:00.001Z'))

        expect(() => manager.markUsed(grant.id)).toThrow(`Grant is not valid: ${grant.id}`)
      })
    })
  })

  describe('revokeGrant', () => {
    it('throws for non-existent grantId', () => {
      const manager = new GrantManager()

      expect(() => manager.revokeGrant('nonexistent')).toThrow('Grant not found: nonexistent')
    })

    it('throws if grant already revoked', () => {
      const manager = new GrantManager()
      const request = makeApprovedRequest()
      const grant = manager.createGrant(request)

      manager.revokeGrant(grant.id)

      expect(() => manager.revokeGrant(grant.id)).toThrow(`Grant already revoked: ${grant.id}`)
    })

    describe('with fake timers', () => {
      beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-15T10:00:00.000Z'))
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      it('sets revokedAt timestamp', () => {
        const manager = new GrantManager()
        const request = makeApprovedRequest()
        const grant = manager.createGrant(request)

        vi.setSystemTime(new Date('2026-01-15T10:01:00.000Z'))
        manager.revokeGrant(grant.id)

        const updated = manager.getGrant(grant.id)
        expect(updated?.revokedAt).toBe('2026-01-15T10:01:00.000Z')
      })
    })
  })

  describe('cleanup', () => {
    it('works on empty store', () => {
      const manager = new GrantManager()

      expect(() => manager.cleanup()).not.toThrow()
    })

    describe('with fake timers', () => {
      beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-15T10:00:00.000Z'))
      })

      afterEach(() => {
        vi.useRealTimers()
      })

      it('removes expired grants from memory', () => {
        const manager = new GrantManager()
        const request = makeApprovedRequest(300)
        const grant = manager.createGrant(request)

        vi.setSystemTime(new Date('2026-01-15T10:05:00.001Z'))
        manager.cleanup()

        expect(manager.getGrant(grant.id)).toBeUndefined()
      })

      it('keeps unexpired grants', () => {
        const manager = new GrantManager()
        const request = makeApprovedRequest(300)
        const grant = manager.createGrant(request)

        vi.setSystemTime(new Date('2026-01-15T10:04:00.000Z'))
        manager.cleanup()

        expect(manager.getGrant(grant.id)).toBeDefined()
      })
    })
  })

  describe('getGrant', () => {
    it('returns a copy of the grant', () => {
      const manager = new GrantManager()
      const request = makeApprovedRequest()
      const grant = manager.createGrant(request)

      const retrieved = manager.getGrant(grant.id)
      expect(retrieved).toEqual(grant)

      // Mutating returned copy should not affect stored grant
      if (retrieved) {
        retrieved.used = true
      }
      expect(manager.getGrant(grant.id)?.used).toBe(false)
    })

    it('returns undefined for non-existent grantId', () => {
      const manager = new GrantManager()

      expect(manager.getGrant('nonexistent')).toBeUndefined()
    })
  })

  describe('getGrantSecrets', () => {
    it('returns secretUuids array for valid grant', () => {
      const manager = new GrantManager()
      const request = createAccessRequest(['uuid-1', 'uuid-2'], 'reason', 'TASK-1')
      request.status = 'approved'
      const grant = manager.createGrant(request)

      const secrets = manager.getGrantSecrets(grant.id)
      expect(secrets).toEqual(['uuid-1', 'uuid-2'])
    })

    it('returns undefined for non-existent grant', () => {
      const manager = new GrantManager()

      expect(manager.getGrantSecrets('nonexistent')).toBeUndefined()
    })
  })
})
