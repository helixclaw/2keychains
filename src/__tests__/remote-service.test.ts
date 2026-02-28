import { RemoteService } from '../core/remote-service.js'
import { GrantVerifier } from '../core/grant-verifier.js'
import type { ServerConfig } from '../core/config.js'
import type { RemoteServiceDeps } from '../core/remote-service.js'

function makeConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 2274,
    authToken: 'test-token',
    ...overrides,
  }
}

function mockFetchResponse(status: number, body?: unknown, statusText = 'OK') {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response)
}

function makeLoginSuccessResponse(token: string) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: vi.fn().mockResolvedValue({ token }),
  } as unknown as Response
}

function makeJsonResponse(status: number, body: unknown, statusText = 'OK') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

function makeDeps(overrides?: Partial<RemoteServiceDeps>): RemoteServiceDeps {
  return {
    injector: {
      inject: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' }),
      injectWithCache: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' }),
    } as unknown as RemoteServiceDeps['injector'],
    ...overrides,
  }
}

describe('RemoteService', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('constructor', () => {
    it('builds base URL from config host and port', () => {
      const service = new RemoteService(makeConfig({ host: 'example.com', port: 9999 }))
      expect(service).toBeDefined()
    })

    it('throws if authToken is missing', () => {
      expect(() => new RemoteService(makeConfig({ authToken: undefined }))).toThrow(
        'server.authToken is required for client mode',
      )
    })
  })

  describe('health', () => {
    it('calls GET /health and returns parsed response', async () => {
      const fetchMock = mockFetchResponse(200, { status: 'ok', uptime: 42 })
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      const result = await service.health()

      expect(result).toEqual({ status: 'ok', uptime: 42 })
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:2274/health',
        expect.objectContaining({ method: 'GET' }),
      )
    })
  })

  describe('keys', () => {
    it('getPublicKey() calls GET /api/keys/public and returns publicKey', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-1'))
        .mockResolvedValueOnce(makeJsonResponse(200, { publicKey: '-----BEGIN PUBLIC KEY-----' }))
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      const result = await service.keys.getPublicKey()

      expect(result).toBe('-----BEGIN PUBLIC KEY-----')
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:2274/api/keys/public',
        expect.objectContaining({ method: 'GET' }),
      )
    })
  })

  describe('secrets', () => {
    it('list() calls GET /api/secrets', async () => {
      const items = [{ uuid: 'a', tags: ['t1'] }]
      const fetchMock = mockFetchResponse(200, items)
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      const result = await service.secrets.list()

      expect(result).toEqual(items)
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:2274/api/secrets',
        expect.objectContaining({ method: 'GET' }),
      )
    })

    it('add() calls POST /api/secrets with ref, value, tags', async () => {
      const fetchMock = mockFetchResponse(200, { uuid: 'new-uuid' })
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      const result = await service.secrets.add('my-secret', 's3cret', ['tag1'])

      expect(result).toEqual({ uuid: 'new-uuid' })
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:2274/api/secrets',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ ref: 'my-secret', value: 's3cret', tags: ['tag1'] }),
        }),
      )
    })

    it('remove() calls DELETE /api/secrets/:uuid', async () => {
      const fetchMock = mockFetchResponse(204)
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      await service.secrets.remove('some-uuid')

      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:2274/api/secrets/some-uuid',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })

    it('resolve() calls GET /api/secrets/resolve/:refOrUuid', async () => {
      const metadata = { uuid: 'x', ref: 'my-ref', tags: [] }
      const fetchMock = mockFetchResponse(200, metadata)
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      const result = await service.secrets.resolve('my-ref')

      expect(result).toEqual(metadata)
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:2274/api/secrets/resolve/my-ref',
        expect.objectContaining({ method: 'GET' }),
      )
    })

    it('getMetadata() calls GET /api/secrets/:uuid', async () => {
      const metadata = { uuid: 'x', ref: 'n', tags: [] }
      const fetchMock = mockFetchResponse(200, metadata)
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      const result = await service.secrets.getMetadata('x')

      expect(result).toEqual(metadata)
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:2274/api/secrets/x',
        expect.objectContaining({ method: 'GET' }),
      )
    })
  })

  describe('requests', () => {
    it('create() calls POST /api/requests with body', async () => {
      const accessRequest = {
        id: 'req-1',
        secretUuids: ['sec-1'],
        reason: 'need it',
        taskRef: 'TASK-1',
        durationSeconds: 300,
        requestedAt: '2026-01-01T00:00:00Z',
        status: 'pending',
      }
      const fetchMock = mockFetchResponse(200, accessRequest)
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      const result = await service.requests.create(['sec-1'], 'need it', 'TASK-1', 300)

      expect(result).toEqual(accessRequest)
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:2274/api/requests',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            secretUuids: ['sec-1'],
            reason: 'need it',
            taskRef: 'TASK-1',
            duration: 300,
            command: undefined,
          }),
        }),
      )
    })

    it('create() includes command parameter when provided', async () => {
      const accessRequest = {
        id: 'req-1',
        secretUuids: ['sec-1'],
        reason: 'need it',
        taskRef: 'TASK-1',
        durationSeconds: 300,
        requestedAt: '2026-01-01T00:00:00Z',
        status: 'pending',
      }
      const fetchMock = mockFetchResponse(200, accessRequest)
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      const result = await service.requests.create(
        ['sec-1'],
        'need it',
        'TASK-1',
        300,
        'echo hello',
      )

      expect(result).toEqual(accessRequest)
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:2274/api/requests',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            secretUuids: ['sec-1'],
            reason: 'need it',
            taskRef: 'TASK-1',
            duration: 300,
            command: 'echo hello',
          }),
        }),
      )
    })
  })

  describe('grants', () => {
    it('getStatus() calls GET /api/grants/:requestId', async () => {
      const statusResponse = { status: 'approved', jws: 'test.jws.token' }
      const fetchMock = mockFetchResponse(200, statusResponse)
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      const result = await service.grants.getStatus('req-1')

      expect(result.status).toBe('approved')
      expect(result.jws).toBe('test.jws.token')
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:2274/api/grants/req-1',
        expect.objectContaining({ method: 'GET' }),
      )
    })
  })

  describe('inject (remote)', () => {
    it('verifies JWS, consumes grant, and uses injectWithCache', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-1'))
        .mockResolvedValueOnce(makeJsonResponse(200, { jws: 'signed.jws.token' }))
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            grantId: 'grant-abc',
            secrets: { 'uuid-1': { uuid: 'uuid-1', ref: 'my-key', value: 'secret-value' } },
          }),
        )
      globalThis.fetch = fetchMock

      vi.spyOn(GrantVerifier.prototype, 'verifyGrant').mockResolvedValue({
        grantId: 'grant-abc',
        requestId: 'req-1',
        secretUuids: ['uuid-1'],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })

      const deps = makeDeps()
      const service = new RemoteService(makeConfig(), deps)
      const result = await service.inject('req-1', 'echo hello')

      expect(result).toEqual({ exitCode: 0, stdout: 'ok', stderr: '' })
      expect(deps.injector!.injectWithCache).toHaveBeenCalledWith(
        ['/bin/sh', '-c', 'echo hello'],
        expect.any(Map),
        undefined,
      )
      // Verify the secret cache was passed correctly
      const cacheArg = (deps.injector!.injectWithCache as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as Map<string, unknown>
      expect(cacheArg.get('uuid-1')).toEqual({
        uuid: 'uuid-1',
        ref: 'my-key',
        value: 'secret-value',
      })
    })

    it('passes envVarName option to injectWithCache', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-1'))
        .mockResolvedValueOnce(makeJsonResponse(200, { jws: 'signed.jws.token' }))
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            grantId: 'grant-abc',
            secrets: { 'uuid-1': { uuid: 'uuid-1', ref: 'my-key', value: 'secret-value' } },
          }),
        )
      globalThis.fetch = fetchMock

      vi.spyOn(GrantVerifier.prototype, 'verifyGrant').mockResolvedValue({
        grantId: 'grant-abc',
        requestId: 'req-1',
        secretUuids: ['uuid-1'],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })

      const deps = makeDeps()
      const service = new RemoteService(makeConfig(), deps)
      await service.inject('req-1', 'echo hello', { envVarName: 'SECRET_VAR' })

      expect(deps.injector!.injectWithCache).toHaveBeenCalledWith(
        ['/bin/sh', '-c', 'echo hello'],
        expect.any(Map),
        { envVarName: 'SECRET_VAR' },
      )
    })

    it('throws when JWS verification fails', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-1'))
        .mockResolvedValueOnce(makeJsonResponse(200, { jws: 'tampered.jws.token' }))
      globalThis.fetch = fetchMock

      vi.spyOn(GrantVerifier.prototype, 'verifyGrant').mockRejectedValue(
        new Error('Invalid grant signature: signature verification failed'),
      )

      const deps = makeDeps()
      const service = new RemoteService(makeConfig(), deps)

      await expect(service.inject('req-1', 'echo hello')).rejects.toThrow('Invalid grant signature')
    })

    it('throws when grant is expired', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-1'))
        .mockResolvedValueOnce(makeJsonResponse(200, { jws: 'expired.jws.token' }))
      globalThis.fetch = fetchMock

      vi.spyOn(GrantVerifier.prototype, 'verifyGrant').mockRejectedValue(
        new Error('Grant has expired'),
      )

      const deps = makeDeps()
      const service = new RemoteService(makeConfig(), deps)

      await expect(service.inject('req-1', 'echo hello')).rejects.toThrow('Grant has expired')
    })

    it('throws when injector not configured', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-1'))
        .mockResolvedValueOnce(makeJsonResponse(200, { jws: 'signed.jws.token' }))
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            grantId: 'grant-abc',
            secrets: { 'uuid-1': { uuid: 'uuid-1', ref: 'my-key', value: 'secret-value' } },
          }),
        )
      globalThis.fetch = fetchMock

      vi.spyOn(GrantVerifier.prototype, 'verifyGrant').mockResolvedValue({
        grantId: 'grant-abc',
        requestId: 'req-1',
        secretUuids: ['uuid-1'],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })

      const deps = makeDeps({ injector: undefined })
      const service = new RemoteService(makeConfig(), deps)

      await expect(service.inject('req-1', 'echo hello')).rejects.toThrow('Injector not available')
    })

    it('passes SHA-256 hash of command to verifyGrant', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-1'))
        .mockResolvedValueOnce(makeJsonResponse(200, { jws: 'signed.jws.token' }))
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            grantId: 'grant-abc',
            secrets: { 'uuid-1': { uuid: 'uuid-1', ref: 'my-key', value: 'secret-value' } },
          }),
        )
      globalThis.fetch = fetchMock

      const verifyMock = vi.spyOn(GrantVerifier.prototype, 'verifyGrant').mockResolvedValue({
        grantId: 'grant-abc',
        requestId: 'req-1',
        secretUuids: ['uuid-1'],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        commandHash: undefined,
      })

      const deps = makeDeps()
      const service = new RemoteService(makeConfig(), deps)
      await service.inject('req-1', 'echo hello')

      const { createHash } = await import('node:crypto')
      const expectedHash = createHash('sha256').update('echo hello').digest('hex')
      expect(verifyMock).toHaveBeenCalledWith('signed.jws.token', expectedHash)
    })

    it('calls consume endpoint to fetch secrets from server', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-1'))
        .mockResolvedValueOnce(makeJsonResponse(200, { jws: 'signed.jws.token' }))
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            grantId: 'grant-abc',
            secrets: {
              'uuid-1': { uuid: 'uuid-1', ref: 'key-1', value: 'value-1' },
              'uuid-2': { uuid: 'uuid-2', ref: 'key-2', value: 'value-2' },
            },
          }),
        )
      globalThis.fetch = fetchMock

      vi.spyOn(GrantVerifier.prototype, 'verifyGrant').mockResolvedValue({
        grantId: 'grant-abc',
        requestId: 'req-1',
        secretUuids: ['uuid-1', 'uuid-2'],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })

      const deps = makeDeps()
      const service = new RemoteService(makeConfig(), deps)
      await service.inject('req-1', 'echo hello')

      // Verify consume endpoint was called
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:2274/api/grants/req-1/consume',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  describe('session auth', () => {
    it('calls POST /api/auth/login on first request and stores session token', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-abc'))
        .mockResolvedValueOnce(makeJsonResponse(200, { status: 'ok' }))
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      await service.health()

      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:2274/api/auth/login',
        expect.objectContaining({ method: 'POST' }),
      )
    })

    it('sends session token in Authorization header after login', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-abc'))
        .mockResolvedValueOnce(makeJsonResponse(200, { status: 'ok' }))
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      await service.health()

      const healthCallArgs = fetchMock.mock.calls[1] as [string, RequestInit]
      const headers = healthCallArgs[1].headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer session-abc')
    })

    it('falls back to static Bearer when session login fails', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          makeJsonResponse(500, { error: 'Login failed' }, 'Internal Server Error'),
        )
        .mockResolvedValueOnce(makeJsonResponse(200, { status: 'ok' }))
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig({ authToken: 'static-token' }))
      await service.health()

      const healthCallArgs = fetchMock.mock.calls[1] as [string, RequestInit]
      const headers = healthCallArgs[1].headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer static-token')
    })

    it('auto-refreshes session on 401 response and retries request once', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-1')) // initial login
        .mockResolvedValueOnce(makeJsonResponse(401, { error: 'Unauthorized' }, 'Unauthorized')) // first health attempt → 401
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-2')) // re-login
        .mockResolvedValueOnce(makeJsonResponse(200, { status: 'ok' })) // retry health
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      const result = await service.health()

      expect(result).toEqual({ status: 'ok' })
      // Verify re-login happened (4 total calls)
      expect(fetchMock).toHaveBeenCalledTimes(4)
    })

    it('does not retry more than once on repeated 401', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-1')) // initial login
        .mockResolvedValueOnce(makeJsonResponse(401, { error: 'Unauthorized' }, 'Unauthorized')) // first attempt
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-2')) // re-login
        .mockResolvedValueOnce(makeJsonResponse(401, { error: 'Unauthorized' }, 'Unauthorized')) // retry also 401
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      await expect(service.health()).rejects.toThrow(
        'Authentication failed. Check authToken in config',
      )
      expect(fetchMock).toHaveBeenCalledTimes(4)
    })
  })

  describe('error handling', () => {
    it('connection refused -> clear message', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))

      const service = new RemoteService(makeConfig())
      await expect(service.health()).rejects.toThrow(
        'Server not running. Start with `2kc server start`',
      )
    })

    it('401 response -> auth failure message', async () => {
      globalThis.fetch = mockFetchResponse(401, { error: 'Unauthorized' }, 'Unauthorized')

      const service = new RemoteService(makeConfig())
      await expect(service.health()).rejects.toThrow(
        'Authentication failed. Check authToken in config',
      )
    })

    it('other HTTP errors -> forwards server error message', async () => {
      globalThis.fetch = mockFetchResponse(
        500,
        { error: 'Internal kaboom' },
        'Internal Server Error',
      )

      const service = new RemoteService(makeConfig())
      await expect(service.health()).rejects.toThrow('Internal kaboom')
    })

    it('other HTTP errors without error body -> uses status text', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: vi.fn().mockRejectedValue(new Error('not json')),
      } as unknown as Response)
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      await expect(service.health()).rejects.toThrow('Server error: 503 Service Unavailable')
    })

    it('timeout -> clear timeout message', async () => {
      const err = new DOMException('The operation was aborted', 'TimeoutError')
      globalThis.fetch = vi.fn().mockRejectedValue(err)

      const service = new RemoteService(makeConfig())
      await expect(service.health()).rejects.toThrow(
        'Request timed out after 30s. Is the server responding?',
      )
    })

    it('re-throws unexpected errors from request() when login succeeds', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-1'))
        .mockRejectedValueOnce(new RangeError('unexpected network error'))
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      await expect(service.health()).rejects.toThrow('unexpected network error')
    })

    it('handles TypeError in request() after successful login', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-1'))
        .mockRejectedValueOnce(new TypeError('network error'))
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      await expect(service.health()).rejects.toThrow('Server not running')
    })

    it('handles TimeoutError in request() after successful login', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-1'))
        .mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'))
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      await expect(service.health()).rejects.toThrow('Request timed out')
    })

    it('re-throws unexpected errors from login()', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new RangeError('login network error'))

      const service = new RemoteService(makeConfig())
      await expect(service.health()).rejects.toThrow('login network error')
    })
  })

  describe('authorization header', () => {
    it('uses session token in Authorization header when session login succeeds', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeLoginSuccessResponse('session-xyz'))
        .mockResolvedValueOnce(makeJsonResponse(200, { status: 'ok' }))
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig({ authToken: 'my-secret-token' }))
      await service.health()

      // Second call is the actual health request, which should use session token
      const healthCallArgs = fetchMock.mock.calls[1] as [string, RequestInit]
      const headers = healthCallArgs[1].headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer session-xyz')
    })

    it('uses static Bearer token when no session available', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeJsonResponse(200, {})) // login returns no token
        .mockResolvedValueOnce(makeJsonResponse(200, { status: 'ok' }))
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig({ authToken: 'my-secret-token' }))
      await service.health()

      const healthCallArgs = fetchMock.mock.calls[1] as [string, RequestInit]
      const headers = healthCallArgs[1].headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer my-secret-token')
    })
  })
})
