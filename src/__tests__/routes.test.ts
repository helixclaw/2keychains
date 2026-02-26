/// <reference types="vitest/globals" />

import { createServer } from '../server/app.js'
import type { Service } from '../core/service.js'
import type { AccessGrant } from '../core/grant.js'

const TEST_TOKEN = 'test-token'
const authHeaders = { Authorization: `Bearer ${TEST_TOKEN}` }
const TEST_UUID = '550e8400-e29b-41d4-a716-446655440000'
const MISSING_UUID = '550e8400-e29b-41d4-a716-446655440001'

function makeGrantMock(overrides?: Partial<AccessGrant>): AccessGrant {
  return {
    id: 'grant-id',
    requestId: 'req-123',
    secretUuids: ['secret-uuid'],
    grantedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    used: false,
    revokedAt: null,
    ...overrides,
  }
}

function makeMockService(): Service {
  return {
    health: vi.fn().mockResolvedValue({ status: 'unlocked' }),
    secrets: {
      list: vi.fn().mockResolvedValue([]),
      add: vi.fn().mockResolvedValue({ uuid: TEST_UUID }),
      remove: vi.fn().mockResolvedValue(undefined),
      getMetadata: vi.fn().mockResolvedValue({ uuid: TEST_UUID, ref: 'MY_SECRET', tags: [] }),
      resolve: vi.fn().mockResolvedValue({ uuid: TEST_UUID, ref: 'MY_SECRET', tags: [] }),
    },
    requests: {
      create: vi.fn().mockResolvedValue({
        id: 'req-123',
        secretUuids: ['test-uuid'],
        reason: 'testing',
        taskRef: 'task-1',
        durationSeconds: 300,
        requestedAt: new Date().toISOString(),
        status: 'pending',
      }),
    },
    grants: {
      getStatus: vi.fn().mockResolvedValue({
        status: 'approved',
        grant: makeGrantMock(),
        jws: 'test.jws.token',
      }),
    },
    inject: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'output', stderr: '' }),
  } as unknown as Service
}

describe('API Routes', () => {
  describe('GET /api/secrets', () => {
    it('returns 200 with secret list', async () => {
      const service = makeMockService()
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'GET',
        url: '/api/secrets',
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(200)
      expect(JSON.parse(response.body)).toEqual([])
      expect(service.secrets.list).toHaveBeenCalled()

      await server.close()
    })

    it('returns 401 without auth header', async () => {
      const server = createServer(makeMockService(), TEST_TOKEN)
      const response = await server.inject({ method: 'GET', url: '/api/secrets' })

      expect(response.statusCode).toBe(401)

      await server.close()
    })
  })

  describe('POST /api/secrets', () => {
    it('returns 201 with uuid on success', async () => {
      const service = makeMockService()
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'POST',
        url: '/api/secrets',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        payload: { ref: 'MY_SECRET', value: 'supersecret', tags: ['prod'] },
      })

      expect(response.statusCode).toBe(201)
      expect(JSON.parse(response.body)).toEqual({ uuid: TEST_UUID })
      expect(service.secrets.add).toHaveBeenCalledWith('MY_SECRET', 'supersecret', ['prod'])

      await server.close()
    })

    it('returns 400 on missing ref', async () => {
      const server = createServer(makeMockService(), TEST_TOKEN)
      const response = await server.inject({
        method: 'POST',
        url: '/api/secrets',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        payload: { value: 'supersecret' },
      })

      expect(response.statusCode).toBe(400)

      await server.close()
    })

    it('returns 409 when ref already exists', async () => {
      const service = makeMockService()
      ;(service.secrets.add as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('already exists'),
      )
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'POST',
        url: '/api/secrets',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        payload: { ref: 'MY_SECRET', value: 'val' },
      })

      expect(response.statusCode).toBe(409)

      await server.close()
    })

    it('returns 403 when store is locked', async () => {
      const service = makeMockService()
      ;(service.secrets.add as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Store is locked'),
      )
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'POST',
        url: '/api/secrets',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        payload: { ref: 'MY_SECRET', value: 'val' },
      })

      expect(response.statusCode).toBe(403)

      await server.close()
    })
  })

  describe('DELETE /api/secrets/:uuid', () => {
    it('returns 204 on success', async () => {
      const service = makeMockService()
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/secrets/${TEST_UUID}`,
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(204)
      expect(service.secrets.remove).toHaveBeenCalledWith(TEST_UUID)

      await server.close()
    })

    it('returns 404 when secret not found', async () => {
      const service = makeMockService()
      ;(service.secrets.remove as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('not found'),
      )
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/secrets/${MISSING_UUID}`,
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(404)

      await server.close()
    })
  })

  describe('GET /api/secrets/:uuid', () => {
    it('returns 200 with metadata', async () => {
      const service = makeMockService()
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'GET',
        url: `/api/secrets/${TEST_UUID}`,
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.uuid).toBe(TEST_UUID)
      expect(service.secrets.getMetadata).toHaveBeenCalledWith(TEST_UUID)

      await server.close()
    })

    it('returns 404 when not found', async () => {
      const service = makeMockService()
      ;(service.secrets.getMetadata as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('not found'),
      )
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'GET',
        url: `/api/secrets/${MISSING_UUID}`,
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(404)

      await server.close()
    })
  })

  describe('GET /api/secrets/resolve/:refOrUuid', () => {
    it('returns 200 with resolved metadata', async () => {
      const service = makeMockService()
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'GET',
        url: '/api/secrets/resolve/MY_SECRET',
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.ref).toBe('MY_SECRET')
      expect(service.secrets.resolve).toHaveBeenCalledWith('MY_SECRET')

      await server.close()
    })

    it('returns 404 when not found', async () => {
      const service = makeMockService()
      ;(service.secrets.resolve as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('not found'),
      )
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'GET',
        url: '/api/secrets/resolve/MISSING',
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(404)

      await server.close()
    })
  })

  describe('POST /api/requests', () => {
    it('returns 201 with access request', async () => {
      const service = makeMockService()
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'POST',
        url: '/api/requests',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        payload: { secretUuids: ['test-uuid'], reason: 'testing', taskRef: 'task-1' },
      })

      expect(response.statusCode).toBe(201)
      const body = JSON.parse(response.body)
      expect(body.id).toBe('req-123')
      expect(service.requests.create).toHaveBeenCalledWith(
        ['test-uuid'],
        'testing',
        'task-1',
        undefined,
      )

      await server.close()
    })

    it('returns 400 on missing required fields', async () => {
      const server = createServer(makeMockService(), TEST_TOKEN)
      const response = await server.inject({
        method: 'POST',
        url: '/api/requests',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        payload: { secretUuids: ['test-uuid'] },
      })

      expect(response.statusCode).toBe(400)

      await server.close()
    })
  })

  describe('GET /api/grants/:requestId', () => {
    it('returns 200 with grant status', async () => {
      const service = makeMockService()
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'GET',
        url: '/api/grants/req-123',
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.status).toBe('approved')
      expect(body.jws).toBe('test.jws.token')
      expect(service.grants.getStatus).toHaveBeenCalledWith('req-123')

      await server.close()
    })

    it('returns 404 when request not found', async () => {
      const service = makeMockService()
      ;(service.grants.getStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Request not found: unknown'),
      )
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'GET',
        url: '/api/grants/unknown',
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(404)

      await server.close()
    })
  })

  describe('error handling edge cases', () => {
    it('returns 500 for errors with no matching keyword', async () => {
      const service = makeMockService()
      ;(service.secrets.list as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('something went wrong'),
      )
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'GET',
        url: '/api/secrets',
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(500)

      await server.close()
    })

    it('returns 400 for errors containing "must"', async () => {
      const service = makeMockService()
      ;(service.secrets.add as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('ref must not be empty'),
      )
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'POST',
        url: '/api/secrets',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        payload: { ref: 'MY_SECRET', value: 'val' },
      })

      expect(response.statusCode).toBe(400)

      await server.close()
    })

    it('returns 500 when a non-Error value is thrown', async () => {
      const service = makeMockService()
      ;(service.secrets.list as ReturnType<typeof vi.fn>).mockRejectedValue('raw string error')
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'GET',
        url: '/api/secrets',
        headers: authHeaders,
      })

      expect(response.statusCode).toBe(500)

      await server.close()
    })
  })

  describe('POST /api/inject', () => {
    it('returns 200 with process result', async () => {
      const service = makeMockService()
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'POST',
        url: '/api/inject',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        payload: { requestId: 'req-123', command: 'echo hello' },
      })

      expect(response.statusCode).toBe(200)
      const body = JSON.parse(response.body)
      expect(body.exitCode).toBe(0)
      expect(service.inject).toHaveBeenCalledWith('req-123', 'echo hello', undefined)

      await server.close()
    })

    it('passes envVarName when provided', async () => {
      const service = makeMockService()
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'POST',
        url: '/api/inject',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        payload: { requestId: 'req-123', command: 'echo hello', envVarName: 'MY_VAR' },
      })

      expect(response.statusCode).toBe(200)
      expect(service.inject).toHaveBeenCalledWith('req-123', 'echo hello', { envVarName: 'MY_VAR' })

      await server.close()
    })

    it('returns 403 when store is locked', async () => {
      const service = makeMockService()
      ;(service.inject as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Store is locked'))
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'POST',
        url: '/api/inject',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        payload: { requestId: 'req-123', command: 'echo hello' },
      })

      expect(response.statusCode).toBe(403)

      await server.close()
    })

    it('returns 404 when no grant found', async () => {
      const service = makeMockService()
      ;(service.inject as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('No grant found for request'),
      )
      const server = createServer(service, TEST_TOKEN)
      const response = await server.inject({
        method: 'POST',
        url: '/api/inject',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        payload: { requestId: 'req-123', command: 'echo hello' },
      })

      expect(response.statusCode).toBe(404)

      await server.close()
    })
  })
})
