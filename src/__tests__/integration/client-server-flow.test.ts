import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { verify, type KeyObject } from 'node:crypto'

import type { FastifyInstance } from 'fastify'

import { createServer } from '../../server/app.js'
import { LocalService } from '../../core/service.js'
import { EncryptedSecretStore } from '../../core/encrypted-store.js'
import { UnlockSession } from '../../core/unlock-session.js'
import { GrantManager } from '../../core/grant.js'
import { WorkflowEngine } from '../../core/workflow.js'
import { SecretInjector } from '../../core/injector.js'
import { RequestLog } from '../../core/request.js'
import { loadOrGenerateKeyPair } from '../../core/key-manager.js'
import { SessionLock } from '../../core/session-lock.js'
import type { NotificationChannel } from '../../channels/channel.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Low-cost scrypt params for fast test initialisation
const TEST_PARAMS = { N: 1024, r: 8, p: 1 }
const PASSWORD = 'test-pw'
const AUTH_TOKEN = 'test-static-token'
/** Short TTL used in the session-expiry test — server sessions expire within ms */
const SHORT_TTL = 1500

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock NotificationChannel that resolves every approval request with
 *  the given response. */
function createMockChannel(response: 'approved' | 'denied' | 'timeout'): NotificationChannel {
  return {
    sendApprovalRequest: vi.fn().mockResolvedValue('msg-id'),
    waitForResponse: vi.fn().mockResolvedValue(response),
    sendNotification: vi.fn().mockResolvedValue(undefined),
  }
}

/** POST /api/auth/login with the static auth token; returns the session payload. */
async function login(
  server: FastifyInstance,
  token: string,
): Promise<{ sessionToken: string; expiresAt: string }> {
  const res = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { token },
  })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { sessionToken: string; expiresAt: string }
  expect(body).toHaveProperty('sessionToken')
  return body
}

/** Poll GET /api/grants/:requestId until the status matches expectedStatus (or
 *  the 5 s timeout fires), then return the full grant payload. */
async function waitForGrant(
  server: FastifyInstance,
  requestId: string,
  headers: Record<string, string>,
  expectedStatus: string,
): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {}
  await vi.waitFor(
    async () => {
      const res = await server.inject({
        method: 'GET',
        url: `/api/grants/${requestId}`,
        headers,
      })
      body = res.json() as Record<string, unknown>
      expect(body.status).toBe(expectedStatus)
    },
    { timeout: 5_000, interval: 50 },
  )
  return body
}

interface BuildServiceOpts {
  bindCommand?: boolean
  channelResponse?: 'approved' | 'denied' | 'timeout'
  /** Skip store.initialize() — use when the store file already exists (e.g. restart test). */
  loadExisting?: boolean
}

interface ServiceBundle {
  service: LocalService
  publicKey: KeyObject
}

/** Assemble a fully-wired LocalService backed by a real EncryptedSecretStore
 *  and GrantManager, but with a mock notification channel. */
async function buildService(tmpDir: string, opts: BuildServiceOpts = {}): Promise<ServiceBundle> {
  const storePath = join(tmpDir, 'secrets.enc.json')
  const grantsPath = join(tmpDir, 'server-grants.json')
  const requestsPath = join(tmpDir, 'server-requests.json')
  const keysPath = join(tmpDir, 'server-keys.json')

  const store = new EncryptedSecretStore(storePath)
  if (!opts.loadExisting) {
    await store.initialize(PASSWORD, TEST_PARAMS)
  }

  const { privateKey, publicKey } = await loadOrGenerateKeyPair(keysPath)
  const unlockConfig = { ttlMs: 3_600_000 }
  const unlockSession = new UnlockSession(unlockConfig)
  const sessionLockPath = join(tmpDir, 'session.lock')
  const sessionLock = new SessionLock(unlockConfig, sessionLockPath)
  const grantManager = new GrantManager(grantsPath, privateKey)
  const mockChannel = createMockChannel(opts.channelResponse ?? 'approved')
  const workflowEngine = new WorkflowEngine({
    store,
    channel: mockChannel,
    config: { requireApproval: {}, defaultRequireApproval: true, approvalTimeoutMs: 5_000 },
  })
  const injector = new SecretInjector(grantManager, store)
  const requestLog = new RequestLog(requestsPath)

  const service = new LocalService({
    store,
    unlockSession,
    sessionLock,
    grantManager,
    workflowEngine,
    injector,
    requestLog,
    startTime: Date.now(),
    bindCommand: opts.bindCommand ?? false,
    publicKey,
  })

  return { service, publicKey }
}

/** Create and ready a Fastify server wrapping the given service. */
async function buildServer(
  service: LocalService,
  opts: { sessionTtlMs?: number } = {},
): Promise<FastifyInstance> {
  const server = createServer(service, AUTH_TOKEN, {
    sessionTtlMs: opts.sessionTtlMs,
  })
  await server.ready()
  return server
}

/** Verify a JWS compact string against a public KeyObject.
 *  Returns true when the signature is valid, false when tampered. */
function isJwsValid(jws: string, publicKey: KeyObject): boolean {
  const parts = jws.split('.')
  if (parts.length !== 3) return false
  const signingInput = `${parts[0]}.${parts[1]}`
  const signature = Buffer.from(parts[2], 'base64url')
  return verify(null, Buffer.from(signingInput), publicKey, signature)
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let tmpDir: string
let service: LocalService | null
let publicKey: KeyObject
let server: FastifyInstance | null
let secretUuid: string
let sessionToken: string

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Phase 2 Client-Server Flow', () => {
  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), '2kc-cs-'))
    ;({ service, publicKey } = await buildService(tmpDir))
    server = await buildServer(service)
    await service.unlock(PASSWORD)
    secretUuid = (await service.secrets.add('test-key', 'secret-value', [])).uuid
    ;({ sessionToken } = await login(server, AUTH_TOKEN))
  })

  afterEach(async () => {
    service?.destroy()
    await server?.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('happy path', () => {
    it('login → request → approve → inject → verify env + redaction', async () => {
      const headers = { authorization: `Bearer ${sessionToken}` }

      // Create an access request via HTTP
      const reqRes = await server.inject({
        method: 'POST',
        url: '/api/requests',
        headers,
        payload: {
          secretUuids: [secretUuid],
          reason: 'test reason',
          taskRef: 'TASK-1',
        },
      })
      expect(reqRes.statusCode).toBe(201)
      const { id: requestId } = reqRes.json() as { id: string }

      // Poll until the mock channel approves the request
      const grantBody = await waitForGrant(server, requestId, headers, 'approved')
      expect(typeof grantBody.jws).toBe('string')
      expect((grantBody.jws as string).length).toBeGreaterThan(0)

      // Inject: secret injected as env var, stdout must be redacted
      const injectRes = await server.inject({
        method: 'POST',
        url: '/api/inject',
        headers,
        payload: {
          requestId,
          command: 'echo $TEST_SECRET',
          envVarName: 'TEST_SECRET',
        },
      })
      expect(injectRes.statusCode).toBe(200)
      const result = injectRes.json() as { stdout: string; exitCode: number | null }
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('[REDACTED]')
      expect(result.stdout).not.toContain('secret-value')
    })
  })

  describe('auth failure', () => {
    it('missing Authorization header → 401', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/secrets',
      })
      expect(res.statusCode).toBe(401)
    })

    it('wrong static token → 401', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/secrets',
        headers: { authorization: 'Bearer wrong-token' },
      })
      expect(res.statusCode).toBe(401)
    })
  })

  describe('session expiry', () => {
    it('expired session token → 401 → re-login → success', async () => {
      // sessionTtlMs: 1500 → exp = now + Math.floor(1500/1000) = now + 1.
      // jose's jwtVerify rejects when clockTimestamp >= exp, so the token
      // is expired once the clock reaches second (now + 1).
      const shortServer = await buildServer(service, { sessionTtlMs: SHORT_TTL })
      try {
        const { sessionToken: expiredToken } = await login(shortServer, AUTH_TOKEN)

        // Wait SHORT_TTL + 100 ms — at this point Math.floor(Date.now()/1000) = now + 1 = exp,
        // triggering the >= boundary and invalidating the JWT.
        await new Promise<void>((resolve) => setTimeout(resolve, SHORT_TTL + 100))

        // Expired session token must be rejected
        const expiredRes = await shortServer.inject({
          method: 'GET',
          url: '/api/secrets',
          headers: { authorization: `Bearer ${expiredToken}` },
        })
        expect(expiredRes.statusCode).toBe(401)

        // Re-login with the static token: fresh JWT has exp = now_relogin + 1 ≥ now + 2,
        // which is in the future relative to the current clock second (now + 1).
        const { sessionToken: freshToken } = await login(shortServer, AUTH_TOKEN)

        // Fresh token must be accepted immediately (clock is still at now + 1 < exp)
        const freshRes = await shortServer.inject({
          method: 'GET',
          url: '/api/secrets',
          headers: { authorization: `Bearer ${freshToken}` },
        })
        expect(freshRes.statusCode).toBe(200)
      } finally {
        await shortServer.close()
      }
    })
  })

  describe('grant verification failure', () => {
    it('tampered JWS signature is detected as invalid', async () => {
      const headers = { authorization: `Bearer ${sessionToken}` }

      // Complete approval flow to obtain a valid JWS
      const reqRes = await server.inject({
        method: 'POST',
        url: '/api/requests',
        headers,
        payload: { secretUuids: [secretUuid], reason: 'tamper test', taskRef: 'TASK-T' },
      })
      expect(reqRes.statusCode).toBe(201)
      const { id: requestId } = reqRes.json() as { id: string }

      const grantBody = await waitForGrant(server, requestId, headers, 'approved')
      const validJws = grantBody.jws as string
      expect(typeof validJws).toBe('string')
      expect(validJws.length).toBeGreaterThan(0)

      // Verify the untampered JWS passes signature check
      expect(isJwsValid(validJws, publicKey)).toBe(true)

      // Tamper the signature segment (last 4 chars replaced with 'XXXX')
      const parts = validJws.split('.')
      const tamperedJws = `${parts[0]}.${parts[1]}.${parts[2].slice(0, -4)}XXXX`

      // Tampered JWS must fail signature verification
      expect(isJwsValid(tamperedJws, publicKey)).toBe(false)
    })
  })

  describe('command binding', () => {
    it('inject with wrong command is rejected when grant has commandHash', async () => {
      // Build a separate service with bindCommand: true, using a fresh tmpDir
      const bindTmpDir = mkdtempSync(join(tmpdir(), '2kc-bind-'))
      try {
        const { service: bindService } = await buildService(bindTmpDir, { bindCommand: true })
        const bindServer = await buildServer(bindService)

        await bindService.unlock(PASSWORD)
        const bindSecretUuid = (await bindService.secrets.add('bind-key', 'bind-value', [])).uuid
        const { sessionToken: bindToken } = await login(bindServer, AUTH_TOKEN)
        const bindHeaders = { authorization: `Bearer ${bindToken}` }

        try {
          // Create request directly on service with a specific command → produces commandHash
          const request = await bindService.requests.create(
            [bindSecretUuid],
            'bind test',
            'TASK-B',
            undefined,
            'echo hello',
          )

          // Wait for approval
          await waitForGrant(bindServer, request.id, bindHeaders, 'approved')

          // Inject with wrong command → should fail (500)
          const wrongRes = await bindServer.inject({
            method: 'POST',
            url: '/api/inject',
            headers: bindHeaders,
            payload: {
              requestId: request.id,
              command: 'echo wrong',
              envVarName: 'BIND_SECRET',
            },
          })
          expect(wrongRes.statusCode).toBe(500)

          // Inject with correct command → should succeed (200)
          const correctRes = await bindServer.inject({
            method: 'POST',
            url: '/api/inject',
            headers: bindHeaders,
            payload: {
              requestId: request.id,
              command: 'echo hello',
              envVarName: 'BIND_SECRET',
            },
          })
          expect(correctRes.statusCode).toBe(200)
          const result = correctRes.json() as { exitCode: number | null }
          expect(result.exitCode).toBe(0)
        } finally {
          bindService.destroy()
          await bindServer.close()
        }
      } finally {
        rmSync(bindTmpDir, { recursive: true, force: true })
      }
    })
  })

  describe('approval denied', () => {
    it('denied request → GET /api/grants returns denied status, no grant', async () => {
      // Build service with a channel that denies every request
      const denyTmpDir = mkdtempSync(join(tmpdir(), '2kc-deny-'))
      try {
        const { service: denyService } = await buildService(denyTmpDir, {
          channelResponse: 'denied',
        })
        const denyServer = await buildServer(denyService)

        await denyService.unlock(PASSWORD)
        const denySecretUuid = (await denyService.secrets.add('deny-key', 'deny-value', [])).uuid
        const { sessionToken: denyToken } = await login(denyServer, AUTH_TOKEN)
        const denyHeaders = { authorization: `Bearer ${denyToken}` }

        try {
          // Submit access request
          const reqRes = await denyServer.inject({
            method: 'POST',
            url: '/api/requests',
            headers: denyHeaders,
            payload: {
              secretUuids: [denySecretUuid],
              reason: 'deny test',
              taskRef: 'TASK-D',
            },
          })
          expect(reqRes.statusCode).toBe(201)
          const { id: requestId } = reqRes.json() as { id: string }

          // Poll until the mock channel denies the request
          const grantBody = await waitForGrant(denyServer, requestId, denyHeaders, 'denied')

          // Denied response must have no JWS / grant data
          expect(grantBody.jws).toBeUndefined()
          expect(grantBody.grant).toBeUndefined()
        } finally {
          denyService.destroy()
          await denyServer.close()
        }
      } finally {
        rmSync(denyTmpDir, { recursive: true, force: true })
      }
    })
  })

  describe('server restart', () => {
    it('grant persists across server restart using same tmpDir', async () => {
      const headers = { authorization: `Bearer ${sessionToken}` }

      // Complete approval flow on the original server
      const reqRes = await server.inject({
        method: 'POST',
        url: '/api/requests',
        headers,
        payload: {
          secretUuids: [secretUuid],
          reason: 'restart test',
          taskRef: 'TASK-R',
        },
      })
      expect(reqRes.statusCode).toBe(201)
      const { id: requestId } = reqRes.json() as { id: string }

      const originalGrantBody = await waitForGrant(server, requestId, headers, 'approved')
      const originalJws = originalGrantBody.jws as string
      expect(typeof originalJws).toBe('string')
      expect(originalJws.length).toBeGreaterThan(0)

      // Tear down original server/service (simulates restart)
      service.destroy()
      await server.close()
      service = null
      server = null

      // Re-create service and server pointing at the same tmpDir (persisted files)
      const { service: service2, publicKey: publicKey2 } = await buildService(tmpDir, {
        loadExisting: true,
      })
      const server2 = await buildServer(service2)

      try {
        await service2.unlock(PASSWORD)
        // New server instance has new sessionSecret → must re-login
        const { sessionToken: token2 } = await login(server2, AUTH_TOKEN)
        const headers2 = { authorization: `Bearer ${token2}` }

        // Grant must still be present and approved after restart
        const restartedBody = await waitForGrant(server2, requestId, headers2, 'approved')
        expect(restartedBody.jws).toBe(originalJws)

        // Signing key was persisted → public key must be the same
        expect(publicKey2.export({ type: 'spki', format: 'pem' })).toBe(
          publicKey.export({ type: 'spki', format: 'pem' }),
        )
      } finally {
        service2.destroy()
        await server2.close()
        // afterEach still calls service.destroy() + server.close() on the originals,
        // but both are already closed — guard by reassigning to no-ops is unnecessary
        // because service.destroy() is idempotent and server.close() on a closed
        // instance resolves immediately.
      }
    })
  })
})
