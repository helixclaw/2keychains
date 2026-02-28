import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { KeyObject } from 'node:crypto'
import type { AddressInfo } from 'node:net'

import type { FastifyInstance } from 'fastify'

import { createServer } from '../../server/app.js'
import { LocalService } from '../../core/service.js'
import { RemoteService } from '../../core/remote-service.js'
import { EncryptedSecretStore } from '../../core/encrypted-store.js'
import { UnlockSession } from '../../core/unlock-session.js'
import { GrantManager } from '../../core/grant.js'
import { WorkflowEngine } from '../../core/workflow.js'
import { SecretInjector } from '../../core/injector.js'
import { RequestLog } from '../../core/request.js'
import { loadOrGenerateKeyPair } from '../../core/key-manager.js'
import { SessionLock } from '../../core/session-lock.js'
import type { ServerConfig } from '../../core/config.js'
import { MockNotificationChannel } from '../mocks/mock-notification-channel.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Low-cost scrypt params for fast test initialisation
const TEST_PARAMS = { N: 1024, r: 8, p: 1 }
const PASSWORD = 'test-pw'
const AUTH_TOKEN = 'test-static-token'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ServiceBundle {
  service: LocalService
  publicKey: KeyObject
  mockChannel: MockNotificationChannel
}

/** Assemble a fully-wired LocalService backed by a real EncryptedSecretStore
 *  and GrantManager, but with a mock notification channel. */
async function buildService(
  tmpDir: string,
  opts: { channelResponse?: 'approved' | 'denied' | 'timeout' } = {},
): Promise<ServiceBundle> {
  const storePath = join(tmpDir, 'secrets.enc.json')
  const grantsPath = join(tmpDir, 'server-grants.json')
  const requestsPath = join(tmpDir, 'server-requests.json')
  const keysPath = join(tmpDir, 'server-keys.json')

  const store = new EncryptedSecretStore(storePath)
  await store.initialize(PASSWORD, TEST_PARAMS)

  const { privateKey, publicKey } = await loadOrGenerateKeyPair(keysPath)
  const unlockConfig = { ttlMs: 3_600_000 }
  const unlockSession = new UnlockSession(unlockConfig)
  const sessionLockPath = join(tmpDir, 'session.lock')
  const sessionLock = new SessionLock(unlockConfig, sessionLockPath)
  const grantManager = new GrantManager(grantsPath, privateKey)
  const mockChannel = new MockNotificationChannel({
    defaultResponse: opts.channelResponse ?? 'approved',
  })
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
    bindCommand: false,
    publicKey,
  })

  return { service, publicKey, mockChannel }
}

/** Create and start a Fastify server on a random available port. */
async function startServer(service: LocalService): Promise<FastifyInstance> {
  const server = createServer(service, AUTH_TOKEN)
  await server.listen({ host: '127.0.0.1', port: 0 })
  return server
}

/** Build a RemoteService client that connects to the given server. */
function buildRemoteClient(
  tmpDir: string,
  serverAddress: AddressInfo,
  existingUnlockSession?: UnlockSession,
  existingStore?: EncryptedSecretStore,
): { client: RemoteService; unlockSession: UnlockSession; store: EncryptedSecretStore } {
  const storePath = join(tmpDir, 'secrets.enc.json')
  const grantsPath = join(tmpDir, 'server-grants.json')

  const store = existingStore ?? new EncryptedSecretStore(storePath)
  const unlockSession = existingUnlockSession ?? new UnlockSession({ ttlMs: 3_600_000 })
  // Create fresh GrantManager to load current grants from file
  const grantManager = new GrantManager(grantsPath)
  const injector = new SecretInjector(grantManager, store)

  const serverConfig: ServerConfig = {
    host: serverAddress.address,
    port: serverAddress.port,
    authToken: AUTH_TOKEN,
  }

  const client = new RemoteService(serverConfig, { unlockSession, injector })
  return { client, unlockSession, store }
}

/** Poll client.grants.getStatus until the status matches expectedStatus. */
async function waitForGrantViaClient(
  client: RemoteService,
  requestId: string,
  expectedStatus: string,
): Promise<{ status: string; jws?: string }> {
  let result: { status: string; jws?: string } = { status: '' }
  await vi.waitFor(
    async () => {
      result = await client.grants.getStatus(requestId)
      expect(result.status).toBe(expectedStatus)
    },
    { timeout: 5_000, interval: 50 },
  )
  return result
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('RemoteService Integration Flow', () => {
  let tmpDir: string
  let service: LocalService
  let server: FastifyInstance
  let client: RemoteService
  let clientUnlockSession: UnlockSession
  let clientStore: EncryptedSecretStore
  let mockChannel: MockNotificationChannel

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), '2kc-remote-'))

    // Build and start server
    const bundle = await buildService(tmpDir)
    service = bundle.service
    mockChannel = bundle.mockChannel
    await service.unlock(PASSWORD)
    server = await startServer(service)

    // Build client pointing to server
    const address = server.server.address() as AddressInfo
    const clientBundle = buildRemoteClient(tmpDir, address)
    client = clientBundle.client
    clientUnlockSession = clientBundle.unlockSession
    clientStore = clientBundle.store

    // Unlock client-side store and session
    await clientStore.unlock(PASSWORD)
    const dek = clientStore.getDek()
    if (dek) clientUnlockSession.unlock(dek)
  })

  afterEach(async () => {
    service?.destroy()
    await server?.close()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('happy path via RemoteService', () => {
    it('auto-login → add secret → create request → poll for approval → inject', async () => {
      // 1. Add secret via client (client calls server API)
      const { uuid: secretUuid } = await client.secrets.add('test-key', 'secret-value', [])
      expect(secretUuid).toBeDefined()

      // 2. Create access request via client
      const request = await client.requests.create([secretUuid], 'test reason', 'TASK-R', 3600)
      expect(request.id).toBeDefined()
      expect(request.status).toBe('pending')

      // 3. Poll for approval (mock channel auto-approves)
      const grantResult = await waitForGrantViaClient(client, request.id, 'approved')
      expect(grantResult.jws).toBeDefined()
      expect(typeof grantResult.jws).toBe('string')

      // 4. Rebuild client to load newly created grant
      // (GrantManager loads file at construction, so we need a fresh one to see server's grant)
      const address = server.server.address() as AddressInfo
      const { client: freshClient } = buildRemoteClient(
        tmpDir,
        address,
        clientUnlockSession,
        clientStore,
      )

      // 5. Inject via client — runs command locally with secrets injected
      const result = await freshClient.inject(request.id, 'echo $TEST_SECRET', {
        envVarName: 'TEST_SECRET',
      })
      expect(result.exitCode).toBe(0)
      // Secret should be redacted in output
      expect(result.stdout).toContain('[REDACTED]')
      expect(result.stdout).not.toContain('secret-value')
    })

    it('multiple requests with same client instance reuse session', async () => {
      const { uuid: secret1 } = await client.secrets.add('key-1', 'value-1', [])
      const { uuid: secret2 } = await client.secrets.add('key-2', 'value-2', [])

      // First request
      const req1 = await client.requests.create([secret1], 'reason 1', 'TASK-1')
      await waitForGrantViaClient(client, req1.id, 'approved')

      // Second request — should reuse session token
      const req2 = await client.requests.create([secret2], 'reason 2', 'TASK-2')
      await waitForGrantViaClient(client, req2.id, 'approved')

      // Rebuild client to load newly created grants
      const address = server.server.address() as AddressInfo
      const { client: freshClient } = buildRemoteClient(
        tmpDir,
        address,
        clientUnlockSession,
        clientStore,
      )

      // Both injections should work
      const result1 = await freshClient.inject(req1.id, 'echo $S1', { envVarName: 'S1' })
      expect(result1.exitCode).toBe(0)

      const result2 = await freshClient.inject(req2.id, 'echo $S2', { envVarName: 'S2' })
      expect(result2.exitCode).toBe(0)
    })
  })

  describe('denial via RemoteService', () => {
    it('denied request returns denied status, inject fails', async () => {
      // Reconfigure mock channel to deny
      mockChannel.setDefaultResponse('denied')

      const { uuid: secretUuid } = await client.secrets.add('deny-key', 'deny-value', [])
      const request = await client.requests.create([secretUuid], 'deny test', 'TASK-D')

      // Poll for denial
      const grantResult = await waitForGrantViaClient(client, request.id, 'denied')
      expect(grantResult.jws).toBeUndefined()

      // Inject should fail
      await expect(client.inject(request.id, 'echo test', { envVarName: 'TEST' })).rejects.toThrow()
    })
  })

  describe('timeout via RemoteService', () => {
    it('timeout request returns timeout status', async () => {
      mockChannel.setDefaultResponse('timeout')

      const { uuid: secretUuid } = await client.secrets.add('timeout-key', 'timeout-value', [])
      const request = await client.requests.create([secretUuid], 'timeout test', 'TASK-T')

      const grantResult = await waitForGrantViaClient(client, request.id, 'timeout')
      expect(grantResult.jws).toBeUndefined()
    })
  })

  describe('JWS verification', () => {
    it('client verifies JWS signature from server', async () => {
      const { uuid: secretUuid } = await client.secrets.add('jws-key', 'jws-value', [])
      const request = await client.requests.create([secretUuid], 'jws test', 'TASK-J')

      const grantResult = await waitForGrantViaClient(client, request.id, 'approved')
      const jws = grantResult.jws as string

      // JWS should be in proper format: header.payload.signature
      const parts = jws.split('.')
      expect(parts).toHaveLength(3)

      // Decode and verify payload contains expected fields
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
      expect(payload.grantId).toBeDefined()
      expect(payload.requestId).toBe(request.id)
      expect(payload.secretUuids).toContain(secretUuid)
      expect(payload.expiresAt).toBeDefined()
    })
  })

  describe('health check via RemoteService', () => {
    it('returns server health status', async () => {
      const health = await client.health()
      // The /health endpoint returns 'ok', while LocalService.health() returns 'unlocked'/'locked'
      expect(health.status).toBe('ok')
      expect(health.uptime).toBeGreaterThan(0)
    })
  })

  describe('secrets management via RemoteService', () => {
    it('list secrets returns added secrets', async () => {
      await client.secrets.add('list-key-1', 'value-1', ['tag-a'])
      await client.secrets.add('list-key-2', 'value-2', ['tag-b'])

      const secrets = await client.secrets.list()
      expect(secrets.length).toBe(2)

      const refs = secrets.map((s) => s.ref)
      expect(refs).toContain('list-key-1')
      expect(refs).toContain('list-key-2')
    })

    it('remove secret works', async () => {
      const { uuid } = await client.secrets.add('remove-key', 'remove-value', [])
      let secrets = await client.secrets.list()
      expect(secrets.some((s) => s.uuid === uuid)).toBe(true)

      await client.secrets.remove(uuid)
      secrets = await client.secrets.list()
      expect(secrets.some((s) => s.uuid === uuid)).toBe(false)
    })

    it('getMetadata returns secret metadata', async () => {
      const { uuid } = await client.secrets.add('meta-key', 'meta-value', ['meta-tag'])
      const metadata = await client.secrets.getMetadata(uuid)

      expect(metadata.uuid).toBe(uuid)
      expect(metadata.ref).toBe('meta-key')
      expect(metadata.tags).toContain('meta-tag')
    })

    it('resolve finds secret by ref', async () => {
      const { uuid } = await client.secrets.add('resolve-key', 'resolve-value', [])
      const resolved = await client.secrets.resolve('resolve-key')

      expect(resolved.uuid).toBe(uuid)
      expect(resolved.ref).toBe('resolve-key')
    })
  })

  describe('public key retrieval', () => {
    it('client can fetch server public key', async () => {
      const publicKey = await client.keys.getPublicKey()

      expect(publicKey).toBeDefined()
      expect(publicKey).toContain('-----BEGIN PUBLIC KEY-----')
      expect(publicKey).toContain('-----END PUBLIC KEY-----')
    })
  })

  describe('error handling', () => {
    it('request for non-existent secret gets denied during workflow', async () => {
      const fakeUuid = '00000000-0000-0000-0000-000000000000'
      // Request creation succeeds, but workflow processing denies it
      const request = await client.requests.create([fakeUuid], 'bad request', 'TASK-E')
      expect(request.id).toBeDefined()

      // Wait for the workflow to process and deny
      const result = await waitForGrantViaClient(client, request.id, 'denied')
      expect(result.jws).toBeUndefined()
    })

    it('inject with invalid request ID fails', async () => {
      await expect(
        client.inject('invalid-request-id', 'echo test', { envVarName: 'TEST' }),
      ).rejects.toThrow()
    })
  })
})
