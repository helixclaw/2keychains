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

describe('resolveService', () => {
  it('returns LocalService for standalone mode', () => {
    const config = defaultConfig()
    const service = resolveService(config)
    expect(service).toBeInstanceOf(LocalService)
  })

  it('returns RemoteService for client mode', () => {
    const config = {
      ...defaultConfig(),
      mode: 'client' as const,
      server: { host: '127.0.0.1', port: 2274, authToken: 'test-token' },
    }
    const service = resolveService(config)
    expect(service).toBeInstanceOf(RemoteService)
  })

  it('throws when defaultRequireApproval is true and discord not configured', () => {
    const config = { ...defaultConfig(), defaultRequireApproval: true }
    expect(() => resolveService(config)).toThrow(
      'Discord must be configured when defaultRequireApproval is true',
    )
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
    createGrant: vi.fn().mockReturnValue(makeGrantMock()),
  } as unknown as GrantManager

  const workflowEngine = {
    processRequest: vi.fn().mockResolvedValue('approved'),
  } as unknown as WorkflowEngine

  const injector = {
    inject: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' }),
  } as unknown as SecretInjector

  const requestLog = {
    add: vi.fn(),
  } as unknown as RequestLog

  const startTime = Date.now() - 1000

  const service = new LocalService({
    store,
    unlockSession,
    grantManager,
    workflowEngine,
    injector,
    requestLog,
    startTime,
  })
  return {
    service,
    store,
    unlockSession,
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
    it('creates request, calls workflow, creates grant when approved', async () => {
      const { service, workflowEngine, grantManager, requestLog } = makeService()
      ;(workflowEngine.processRequest as MockInstance).mockImplementation(async (req) => {
        req.status = 'approved'
        return 'approved'
      })
      const result = await service.requests.create(['u1'], 'need access', 'task-1', 300)
      expect(result.status).toBe('approved')
      expect(requestLog.add).toHaveBeenCalledWith(result)
      expect(grantManager.createGrant).toHaveBeenCalledWith(result)
    })

    it('returns request with denied status when workflow denies', async () => {
      const { service, workflowEngine, grantManager, requestLog } = makeService()
      ;(workflowEngine.processRequest as MockInstance).mockImplementation(async (req) => {
        req.status = 'denied'
        return 'denied'
      })
      const result = await service.requests.create(['u1'], 'need access', 'task-1', 300)
      expect(result.status).toBe('denied')
      expect(requestLog.add).toHaveBeenCalledWith(result)
      expect(grantManager.createGrant).not.toHaveBeenCalled()
    })
  })

  describe('grants.validate()', () => {
    it('returns true for valid grant by requestId', async () => {
      const { service, grantManager } = makeService()
      ;(grantManager.getGrantByRequestId as MockInstance).mockReturnValue(makeGrantMock())
      ;(grantManager.validateGrant as MockInstance).mockReturnValue(true)
      const result = await service.grants.validate('request-id')
      expect(result).toBe(true)
    })

    it('returns false when no grant found for requestId', async () => {
      const { service, grantManager } = makeService()
      ;(grantManager.getGrantByRequestId as MockInstance).mockReturnValue(undefined)
      const result = await service.grants.validate('unknown-request')
      expect(result).toBe(false)
      expect(grantManager.validateGrant).not.toHaveBeenCalled()
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
  })

  describe('destroy()', () => {
    it('removes the locked event listener from unlockSession', () => {
      const { service, unlockSession } = makeService()
      const onCall = (unlockSession.on as MockInstance).mock.calls[0]
      service.destroy()
      expect(unlockSession.off).toHaveBeenCalledWith('locked', onCall[1])
    })
  })
})
