import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { RemoteService } from '../core/remote-service.js'
import type { ServerConfig } from '../core/config.js'

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

    it('add() calls POST /api/secrets with name, value, tags', async () => {
      const fetchMock = mockFetchResponse(200, { uuid: 'new-uuid' })
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      const result = await service.secrets.add('my-secret', 's3cret', ['tag1'])

      expect(result).toEqual({ uuid: 'new-uuid' })
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:2274/api/secrets',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'my-secret', value: 's3cret', tags: ['tag1'] }),
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

    it('getMetadata() calls GET /api/secrets/:uuid', async () => {
      const metadata = { uuid: 'x', name: 'n', tags: [] }
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
          }),
        }),
      )
    })
  })

  describe('grants', () => {
    it('validate() calls GET /api/grants/:grantId', async () => {
      const fetchMock = mockFetchResponse(200, true)
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      const result = await service.grants.validate('grant-1')

      expect(result).toBe(true)
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:2274/api/grants/grant-1',
        expect.objectContaining({ method: 'GET' }),
      )
    })
  })

  describe('inject', () => {
    it('calls POST /api/inject with body', async () => {
      const processResult = { exitCode: 0, stdout: 'ok', stderr: '' }
      const fetchMock = mockFetchResponse(200, processResult)
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig())
      const result = await service.inject('req-1', 'SECRET_VAR', 'echo hello')

      expect(result).toEqual(processResult)
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:2274/api/inject',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            requestId: 'req-1',
            envVarName: 'SECRET_VAR',
            command: 'echo hello',
          }),
        }),
      )
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
  })

  describe('authorization header', () => {
    it('sets Bearer token on all requests', async () => {
      const fetchMock = mockFetchResponse(200, { status: 'ok' })
      globalThis.fetch = fetchMock

      const service = new RemoteService(makeConfig({ authToken: 'my-secret-token' }))
      await service.health()

      const callArgs = fetchMock.mock.calls[0] as [string, RequestInit]
      const headers = callArgs[1].headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer my-secret-token')
    })
  })
})
