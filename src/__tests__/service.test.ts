import { describe, it, expect, vi } from 'vitest'
import type { MockInstance } from 'vitest'

import { resolveService, LocalService } from '../core/service.js'
import { RemoteService } from '../core/remote-service.js'
import { defaultConfig } from '../core/config.js'
import type { EncryptedSecretStore } from '../core/encrypted-store.js'
import type { UnlockSession } from '../core/unlock-session.js'
import type { GrantManager, AccessGrant } from '../core/grant.js'
import type { WorkflowEngine } from '../core/workflow.js'
import type { SecretInjector } from '../core/injector.js'
import type { RequestLog } from '../core/request.js'
import type { SessionLock } from '../core/session-lock.js'

describe('resolveService', () => {
  it('returns LocalService for standalone mode', async () => {
    const config = defaultConfig()
    const service = await resolveService(config)
    expect(service).toBeInstanceOf(LocalService)
  })

  it('returns RemoteService for client mode', async () => {
    const config = {
      ...defaultConfig(),
      mode: 'client' as const,
      server: { host: '127.0.0.1', port: 2274, authToken: 'test-token' },
    }
    const service = await resolveService(config)
    expect(service).toBeInstanceOf(RemoteService)
  })

  it('throws when defaultRequireApproval is true and discord not configured', async () => {
    const config = { ...defaultConfig(), defaultRequireApproval: true }
    await expect(resolveService(config)).rejects.toThrow(
      'Discord must be configured when defaultRequireApproval is true',
    )
  })

  it('creates a noop channel when discord is not configured and approval not required', async () => {
    const config = {
      ...defaultConfig(),
      defaultRequireApproval: false,
      discord: undefined,
    }
    const service = await resolveService(config)
    expect(service).toBeInstanceOf(LocalService)
  })

  it('creates LocalService with discord channel when discord is configured', async () => {
    const config = {
      ...defaultConfig(),
      discord: {
        botToken: 'bot-token',
        channelId: '999888777',
      },
    }
    const service = await resolveService(config)
    expect(service).toBeInstanceOf(LocalService)
  })
})

function makeGrantMock(overrides?: Partial<AccessGrant>): AccessGrant {
  return {
    id: 'grant-id',
    requestId: 'request-id',
    secretUuids: ['secret-uuid'],
    grantedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    used: false,
    revokedAt: null,
    ...overrides,
  }
}

function makeService() {
  const store = {
    list: vi.fn().mockReturnValue([{ uuid: 'u1', ref: 'my-secret', tags: [] }]),
    add: vi.fn().mockReturnValue('new-uuid'),
    remove: vi.fn().mockReturnValue(true),
    getMetadata: vi.fn().mockReturnValue({ uuid: 'u1', ref: 'my-secret', tags: [] }),
    resolve: vi.fn().mockReturnValue({ uuid: 'u1', ref: 'my-secret', tags: [] }),
    getValue: vi.fn(),
    getByRef: vi.fn(),
    getValueByRef: vi.fn(),
    resolveRef: vi.fn(),
    lock: vi.fn(),
    unlock: vi.fn(),
    getDek: vi.fn().mockReturnValue(Buffer.alloc(32)),
  } as unknown as EncryptedSecretStore

  const unlockSession = {
    isUnlocked: vi.fn().mockReturnValue(true),
    recordGrantUsage: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(),
  } as unknown as UnlockSession

  const grantManager = {
    getGrantByRequestId: vi.fn().mockReturnValue(makeGrantMock()),
    validateGrant: vi.fn().mockReturnValue(true),
    createGrant: vi.fn().mockReturnValue({ grant: makeGrantMock(), jws: undefined }),
  } as unknown as GrantManager

  const workflowEngine = {
    processRequest: vi.fn().mockResolvedValue('approved'),
  } as unknown as WorkflowEngine

  const injector = {
    inject: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' }),
  } as unknown as SecretInjector

  const requestLog = {
    add: vi.fn(),
    save: vi.fn(),
    getById: vi.fn().mockReturnValue(undefined),
  } as unknown as RequestLog

  const sessionLock = {
    save: vi.fn(),
    load: vi.fn().mockReturnValue(null),
    clear: vi.fn(),
    touch: vi.fn(),
    exists: vi.fn().mockReturnValue(false),
  } as unknown as SessionLock

  const startTime = Date.now() - 1000

  const publicKey = {
    export: vi.fn().mockReturnValue('-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----'),
  } as unknown as import('node:crypto').KeyObject

  const service = new LocalService({
    store,
    unlockSession,
    sessionLock,
    grantManager,
    workflowEngine,
    injector,
    requestLog,
    startTime,
    bindCommand: false,
    publicKey,
  })
  return {
    service,
    store,
    unlockSession,
    sessionLock,
    grantManager,
    workflowEngine,
    injector,
    requestLog,
    startTime,
  }
}

describe('LocalService', () => {
  describe('health()', () => {
    it('returns status:unlocked when session is unlocked', async () => {
      const { service, unlockSession } = makeService()
      ;(unlockSession.isUnlocked as MockInstance).mockReturnValue(true)
      const result = await service.health()
      expect(result.status).toBe('unlocked')
      expect(typeof result.uptime).toBe('number')
    })

    it('returns status:locked when session is locked', async () => {
      const { service, unlockSession } = makeService()
      ;(unlockSession.isUnlocked as MockInstance).mockReturnValue(false)
      const result = await service.health()
      expect(result.status).toBe('locked')
    })

    it('includes uptime in ms based on startTime', async () => {
      const { service, startTime } = makeService()
      const result = await service.health()
      expect(result.uptime).toBeGreaterThanOrEqual(1000)
      expect(result.uptime).toBeLessThan(Date.now() - startTime + 100)
    })
  })

  describe('secrets.list()', () => {
    it('returns list from store without requiring unlock', async () => {
      const { service, store, unlockSession } = makeService()
      ;(unlockSession.isUnlocked as MockInstance).mockReturnValue(false)
      const result = await service.secrets.list()
      expect(result).toEqual([{ uuid: 'u1', ref: 'my-secret', tags: [] }])
      expect(store.list).toHaveBeenCalledOnce()
    })
  })

  describe('secrets.add()', () => {
    it('adds secret when unlocked', async () => {
      const { service, store } = makeService()
      const result = await service.secrets.add('my-ref', 'my-value', ['tag1'])
      expect(result).toEqual({ uuid: 'new-uuid' })
      expect(store.add).toHaveBeenCalledWith('my-ref', 'my-value', ['tag1'])
    })

    it('throws locked error when session is locked', async () => {
      const { service, unlockSession } = makeService()
      ;(unlockSession.isUnlocked as MockInstance).mockReturnValue(false)
      await expect(service.secrets.add('ref', 'val')).rejects.toThrow(
        'Store is locked. Run `2kc unlock` first.',
      )
    })
  })

  describe('secrets.remove()', () => {
    it('removes secret from store', async () => {
      const { service, store } = makeService()
      await service.secrets.remove('u1')
      expect(store.remove).toHaveBeenCalledWith('u1')
    })
  })

  describe('secrets.getMetadata()', () => {
    it('returns metadata without requiring unlock', async () => {
      const { service, store, unlockSession } = makeService()
      ;(unlockSession.isUnlocked as MockInstance).mockReturnValue(false)
      const result = await service.secrets.getMetadata('u1')
      expect(result).toEqual({ uuid: 'u1', ref: 'my-secret', tags: [] })
      expect(store.getMetadata).toHaveBeenCalledWith('u1')
    })
  })

  describe('secrets.resolve()', () => {
    it('resolves refOrUuid to metadata', async () => {
      const { service, store } = makeService()
      const result = await service.secrets.resolve('my-secret')
      expect(result).toEqual({ uuid: 'u1', ref: 'my-secret', tags: [] })
      expect(store.resolve).toHaveBeenCalledWith('my-secret')
    })
  })

  describe('requests.create()', () => {
    it('returns request with pending status immediately', async () => {
      const { service, requestLog } = makeService()
      const result = await service.requests.create(['u1'], 'need access', 'task-1', 300)
      expect(result.status).toBe('pending')
      expect(requestLog.add).toHaveBeenCalledWith(result)
      expect(requestLog.save).toHaveBeenCalled()
    })

    it('runs workflow in background and creates grant when approved', async () => {
      const { service, workflowEngine, grantManager } = makeService()
      ;(workflowEngine.processRequest as MockInstance).mockImplementation(async (req) => {
        req.status = 'approved'
        return 'approved'
      })
      await service.requests.create(['u1'], 'need access', 'task-1', 300)
      await vi.waitFor(() => {
        expect(grantManager.createGrant).toHaveBeenCalled()
      })
    })

    it('computes commandHash when bindCommand is true and command is provided', async () => {
      const {
        store,
        unlockSession,
        sessionLock,
        grantManager,
        workflowEngine,
        injector,
        requestLog,
        startTime,
      } = makeService()
      const serviceWithBind = new LocalService({
        store,
        unlockSession,
        sessionLock,
        grantManager,
        workflowEngine,
        injector,
        requestLog,
        startTime,
        bindCommand: true,
        publicKey: {
          export: vi.fn().mockReturnValue(''),
        } as unknown as import('node:crypto').KeyObject,
      })
      ;(workflowEngine.processRequest as MockInstance).mockImplementation(async (req) => {
        req.status = 'approved'
        return 'approved'
      })
      const result = await serviceWithBind.requests.create(
        ['u1'],
        'need access',
        'task-1',
        300,
        'echo hello',
      )
      expect(result.commandHash).toBeDefined()
      expect(typeof result.commandHash).toBe('string')
      expect(result.command).toBe('echo hello')
    })

    it('does not create grant when workflow denies', async () => {
      const { service, workflowEngine, grantManager } = makeService()
      ;(workflowEngine.processRequest as MockInstance).mockImplementation(async (req) => {
        req.status = 'denied'
        return 'denied'
      })
      await service.requests.create(['u1'], 'need access', 'task-1', 300)
      await vi.waitFor(() => {
        // Wait for background task to complete
        expect(workflowEngine.processRequest).toHaveBeenCalled()
      })
      expect(grantManager.createGrant).not.toHaveBeenCalled()
    })

    it('sets status to denied on unexpected workflow error', async () => {
      const { service, workflowEngine, requestLog } = makeService()
      ;(workflowEngine.processRequest as MockInstance).mockRejectedValue(new Error('network error'))
      const result = await service.requests.create(['u1'], 'need access', 'task-1', 300)
      await vi.waitFor(() => {
        expect(requestLog.save).toHaveBeenCalledTimes(2) // initial + error handler
      })
      expect(result.status).toBe('denied')
    })
  })

  describe('grants.getStatus()', () => {
    it('returns approved status with grant and jws when grant exists', async () => {
      const { service, grantManager, requestLog } = makeService()
      const pendingReq = { status: 'approved' as const, id: 'request-id' }
      ;(requestLog.getById as MockInstance).mockReturnValue(pendingReq)
      const grantWithJws = { ...makeGrantMock(), jws: 'test.jws.token' }
      ;(grantManager.getGrantByRequestId as MockInstance).mockReturnValue(grantWithJws)

      const result = await service.grants.getStatus('request-id')
      expect(result.status).toBe('approved')
      expect(result.grant).toBeDefined()
      expect(result.jws).toBe('test.jws.token')
    })

    it('returns pending status when request exists but no grant yet', async () => {
      const { service, grantManager, requestLog } = makeService()
      ;(requestLog.getById as MockInstance).mockReturnValue({ status: 'pending', id: 'request-id' })
      ;(grantManager.getGrantByRequestId as MockInstance).mockReturnValue(undefined)

      const result = await service.grants.getStatus('request-id')
      expect(result.status).toBe('pending')
      expect(result.grant).toBeUndefined()
      expect(result.jws).toBeUndefined()
    })

    it('throws when requestId not found', async () => {
      const { service, requestLog } = makeService()
      ;(requestLog.getById as MockInstance).mockReturnValue(undefined)

      await expect(service.grants.getStatus('unknown')).rejects.toThrow(
        'Request not found: unknown',
      )
    })
  })

  describe('inject()', () => {
    it('calls injector with parsed command and records grant usage', async () => {
      const { service, injector, unlockSession, grantManager } = makeService()
      const grant = makeGrantMock()
      ;(grantManager.getGrantByRequestId as MockInstance).mockReturnValue(grant)
      const result = await service.inject('request-id', 'echo hello', { envVarName: 'TOKEN' })
      expect(injector.inject).toHaveBeenCalledWith(grant.id, ['/bin/sh', '-c', 'echo hello'], {
        envVarName: 'TOKEN',
      })
      expect(unlockSession.recordGrantUsage).toHaveBeenCalledOnce()
      expect(result).toEqual({ exitCode: 0, stdout: 'ok', stderr: '' })
    })

    it('throws when session is locked', async () => {
      const { service, unlockSession } = makeService()
      ;(unlockSession.isUnlocked as MockInstance).mockReturnValue(false)
      await expect(service.inject('request-id', 'echo hello')).rejects.toThrow(
        'Store is locked. Run `2kc unlock` first.',
      )
    })

    it('throws when no grant found for requestId', async () => {
      const { service, grantManager } = makeService()
      ;(grantManager.getGrantByRequestId as MockInstance).mockReturnValue(undefined)
      await expect(service.inject('missing-request', 'echo hello')).rejects.toThrow(
        'No grant found for request: missing-request',
      )
    })

    it('passes when grant has no commandHash (pre-binding grants)', async () => {
      const { service, grantManager, injector } = makeService()
      const grant = makeGrantMock({ commandHash: undefined })
      ;(grantManager.getGrantByRequestId as MockInstance).mockReturnValue(grant)
      const result = await service.inject('request-id', 'echo hello')
      expect(injector.inject).toHaveBeenCalled()
      expect(result).toEqual({ exitCode: 0, stdout: 'ok', stderr: '' })
    })

    it('passes when command hash matches grant commandHash', async () => {
      const { service, grantManager, injector } = makeService()
      // Pre-compute the hash of normalizeCommand('echo hello') = 'echo hello'
      // SHA-256 of 'echo hello'
      const { hashCommand, normalizeCommand } = await import('../core/command-hash.js')
      const expectedHash = hashCommand(normalizeCommand('echo hello'))
      const grant = makeGrantMock({ commandHash: expectedHash })
      ;(grantManager.getGrantByRequestId as MockInstance).mockReturnValue(grant)
      const result = await service.inject('request-id', 'echo hello')
      expect(injector.inject).toHaveBeenCalled()
      expect(result).toEqual({ exitCode: 0, stdout: 'ok', stderr: '' })
    })

    it('throws when command hash does not match grant commandHash', async () => {
      const { service, grantManager } = makeService()
      const grant = makeGrantMock({ commandHash: 'wrong-hash-that-does-not-match' })
      ;(grantManager.getGrantByRequestId as MockInstance).mockReturnValue(grant)
      await expect(service.inject('request-id', 'echo hello')).rejects.toThrow(
        'Command does not match the approved command hash',
      )
    })
  })

  describe('unlock()', () => {
    it('unlocks the store and passes DEK to session', async () => {
      const { service, store, unlockSession, sessionLock } = makeService()
      ;(store.unlock as MockInstance).mockResolvedValue(undefined)
      ;(store.getDek as MockInstance).mockReturnValue(Buffer.alloc(32, 0xaa))

      await service.unlock('test-password')

      expect(store.unlock).toHaveBeenCalledWith('test-password')
      expect(unlockSession.unlock).toHaveBeenCalledWith(Buffer.alloc(32, 0xaa))
      expect(sessionLock.save).toHaveBeenCalledWith(Buffer.alloc(32, 0xaa))
    })

    it('throws when DEK is null after unlock', async () => {
      const { service, store } = makeService()
      ;(store.unlock as MockInstance).mockResolvedValue(undefined)
      ;(store.getDek as MockInstance).mockReturnValue(null)

      await expect(service.unlock('pw')).rejects.toThrow('Failed to obtain DEK after unlock')
    })
  })

  describe('lock()', () => {
    it('locks the session and clears sessionLock', () => {
      const { service, unlockSession, sessionLock } = makeService()
      service.lock()
      expect(unlockSession.lock).toHaveBeenCalled()
      expect(sessionLock.clear).toHaveBeenCalled()
    })
  })

  describe('isUnlocked()', () => {
    it('returns true when session is unlocked', () => {
      const { service, unlockSession } = makeService()
      ;(unlockSession.isUnlocked as MockInstance).mockReturnValue(true)
      expect(service.isUnlocked()).toBe(true)
    })

    it('returns false when session is locked', () => {
      const { service, unlockSession } = makeService()
      ;(unlockSession.isUnlocked as MockInstance).mockReturnValue(false)
      expect(service.isUnlocked()).toBe(false)
    })
  })

  describe('destroy()', () => {
    it('removes the locked event listener from unlockSession', () => {
      const { service, unlockSession } = makeService()
      const onCall = (unlockSession.on as MockInstance).mock.calls[0]
      service.destroy()
      expect(unlockSession.off).toHaveBeenCalledWith('locked', onCall[1])
    })
  })

  describe('onLocked callback', () => {
    it('calls store.lock() and sessionLock.clear() when unlockSession emits locked', () => {
      const { store, unlockSession, sessionLock } = makeService()
      const onCall = (unlockSession.on as MockInstance).mock.calls[0]
      expect(onCall[0]).toBe('locked')
      // Invoke the registered handler
      onCall[1]()
      expect(store.lock).toHaveBeenCalledOnce()
      expect(sessionLock.clear).toHaveBeenCalledOnce()
    })
  })

  describe('createGrant error path', () => {
    it('sets status to error when createGrant fails after workflow approval', async () => {
      const { service, workflowEngine, grantManager } = makeService()
      ;(workflowEngine.processRequest as MockInstance).mockImplementation(async (req) => {
        req.status = 'approved'
        return 'approved'
      })
      ;(grantManager.createGrant as MockInstance).mockImplementation(() => {
        throw new Error('signing key unavailable')
      })

      const result = await service.requests.create(['u1'], 'need access', 'task-1', 300)
      await vi.waitFor(() => {
        expect(grantManager.createGrant).toHaveBeenCalled()
      })
      // The result's status may have been updated after the workflow ran
      expect(result.status).toBe('error')
    })
  })

  describe('keys', () => {
    it('getPublicKey() returns exported PEM key', async () => {
      const { service } = makeService()
      const result = await service.keys.getPublicKey()
      expect(result).toBe('-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----')
    })
  })
})
