import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { EncryptedSecretStore } from '../../core/encrypted-store.js'
import { WorkflowEngine } from '../../core/workflow.js'
import { GrantManager } from '../../core/grant.js'
import { SecretInjector } from '../../core/injector.js'
import { UnlockSession } from '../../core/unlock-session.js'
import { createAccessRequest } from '../../core/request.js'
import type { SecretStore } from '../../core/secret-store.js'
import { createMockChannel } from '../mocks/mock-notification-channel.js'

// Low-cost scrypt params for fast tests
const TEST_PARAMS = { N: 1024, r: 8, p: 1 }
const PASSWORD = 'integration-test-pw'

function buildWorkflowConfig(
  overrides?: Partial<{
    requireApproval: Record<string, boolean>
    defaultRequireApproval: boolean
    approvalTimeoutMs: number
  }>,
) {
  return {
    requireApproval: {},
    defaultRequireApproval: true,
    approvalTimeoutMs: 30_000,
    ...overrides,
  }
}

function buildEngine(store: EncryptedSecretStore, channel: NotificationChannel) {
  return new WorkflowEngine({
    store: store as unknown as SecretStore,
    channel,
    config: buildWorkflowConfig({ requireApproval: { prod: true } }),
  })
}

function buildInjector(grantManager: GrantManager, store: EncryptedSecretStore) {
  return new SecretInjector(grantManager, store as unknown as SecretStore)
}

describe('Phase 1 Local Encrypted Flow', () => {
  let tmpDir: string
  let storePath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), '2kc-integration-'))
    storePath = join(tmpDir, 'secrets.enc.json')
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  async function initStore(): Promise<EncryptedSecretStore> {
    const store = new EncryptedSecretStore(storePath)
    await store.initialize(PASSWORD, TEST_PARAMS)
    return store
  }

  describe('happy path', () => {
    it('init → unlock → add → request → approve → inject → verify env + redaction', async () => {
      // 1. Init store and add secret
      const store = await initStore()
      const secretValue = 's3cr3t-value-42'
      const uuid = store.add('api-key', secretValue, ['prod'])

      // 2. Create an access request
      const request = createAccessRequest([uuid], 'integration test', 'task-001')

      // 3. Process request via WorkflowEngine with mocked approval channel
      const mockChannel = createMockChannel('approved')
      const engine = buildEngine(store, mockChannel)
      const result = await engine.processRequest(request)
      expect(result).toBe('approved')

      // 4. Create a grant
      const grantManager = new GrantManager()
      const { grant } = await grantManager.createGrant(request)
      expect(grant.secretUuids).toContain(uuid)

      // 5. Inject via SecretInjector — spawn real subprocess
      const injector = buildInjector(grantManager, store)
      const processResult = await injector.inject(
        grant.id,
        ['node', '-e', 'process.stdout.write(process.env.MY_SECRET ?? "")'],
        {
          envVarName: 'MY_SECRET',
        },
      )

      // 6. Secret value must NOT appear in stdout or stderr (redaction worked)
      expect(processResult.stdout).not.toContain(secretValue)
      expect(processResult.stdout).toContain('[REDACTED]')
      expect(processResult.stderr).not.toContain(secretValue)
      expect(processResult.exitCode).toBe(0)
    })
  })

  describe('locked store rejection', () => {
    it('inject without unlock throws locked error', async () => {
      // 1. Init store and add a secret while unlocked
      const store = await initStore()
      const uuid = store.add('locked-test-key', 'super-secret')

      // 2. Create approved request and grant
      const request = createAccessRequest([uuid], 'test locked rejection', 'task-002')
      request.status = 'approved'
      const grantManager = new GrantManager()
      const { grant } = await grantManager.createGrant(request)

      // 3. Lock the store
      store.lock()
      expect(store.isUnlocked).toBe(false)

      // 4. Inject should fail because getValue() throws when locked
      const injector = buildInjector(grantManager, store)
      await expect(
        injector.inject(grant.id, ['node', '-e', 'console.log("hi")'], { envVarName: 'MY_SECRET' }),
      ).rejects.toThrow('Store is locked')
    })
  })

  describe('TTL expiry', () => {
    it('unlock → advance past TTL → session is locked', () => {
      vi.useFakeTimers()

      const session = new UnlockSession({ ttlMs: 5_000 })
      const fakeDek = Buffer.from('fake-dek-32-bytes-exactly-123456')
      session.unlock(fakeDek)
      expect(session.isUnlocked()).toBe(true)

      // Advance time past TTL
      vi.advanceTimersByTime(6_000)

      expect(session.isUnlocked()).toBe(false)
    })
  })

  describe('wrong password', () => {
    it('unlock with wrong password throws error', async () => {
      // Init store with correct password
      const store = await initStore()
      store.lock()
      expect(store.isUnlocked).toBe(false)

      // Attempt unlock with wrong password
      await expect(store.unlock('completely-wrong-password')).rejects.toThrow('incorrect password')
    })
  })

  describe('approval denied', () => {
    it('request → deny → grant creation fails', async () => {
      // 1. Init store and add secret with approval-required tag
      const store = await initStore()
      const uuid = store.add('prod-key', 'prod-secret', ['prod'])

      // 2. Create request
      const request = createAccessRequest([uuid], 'prod access needed', 'task-003')

      // 3. Process with denial channel
      const mockChannel = createMockChannel('denied')
      const engine = buildEngine(store, mockChannel)
      const result = await engine.processRequest(request)
      expect(result).toBe('denied')
      expect(request.status).toBe('denied')

      // 4. createGrant should throw because status is 'denied'
      const grantManager = new GrantManager()
      await expect(grantManager.createGrant(request)).rejects.toThrow(
        'Cannot create grant for request with status: denied',
      )
    })
  })

  describe('grant expiry', () => {
    it('approve → advance past grant TTL → inject fails', async () => {
      // 1. Init store and add secret
      const store = await initStore()
      const uuid = store.add('expiry-key', 'expiry-secret')

      // 2. Create request (minimum duration: 30 seconds)
      const request = createAccessRequest([uuid], 'expiry test', 'task-004', 30)
      request.status = 'approved'

      // 3. Switch to fake timers before creating the grant so expiry is deterministic
      vi.useFakeTimers()

      // 4. Create grant (expires in 30s)
      const grantManager = new GrantManager()
      const { grant } = await grantManager.createGrant(request)

      // 5. Advance past grant TTL
      vi.advanceTimersByTime(31_000)

      // 6. Inject should fail with grant-invalid error
      const injector = buildInjector(grantManager, store)
      await expect(
        injector.inject(grant.id, ['node', '-e', 'console.log("hi")'], { envVarName: 'MY_SECRET' }),
      ).rejects.toThrow(`Grant is not valid: ${grant.id}`)
    })
  })

  describe('migration', () => {
    it.skip('plaintext store → migrate → unlock → values match', async () => {
      // This test is skipped until issue #57 implements auto-detection and
      // in-place migration of plaintext stores in EncryptedSecretStore.unlock().
      //
      // Expected flow:
      // 1. Write a SecretsFile (plaintext format) to tmpDir/secrets.enc.json
      // 2. Create EncryptedSecretStore pointing at that path
      // 3. Call unlock(password) → expect auto-migration to encrypted format
      // 4. Verify getValue() returns original value
      // 5. Verify on-disk file is now in encrypted format (version: 1)
      const plaintextStore = {
        secrets: [
          {
            uuid: '11111111-1111-1111-1111-111111111111',
            ref: 'old-api-key',
            value: 'plaintext-value',
            tags: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }
      writeFileSync(storePath, JSON.stringify(plaintextStore, null, 2), 'utf-8')

      const store = new EncryptedSecretStore(storePath)
      await store.unlock(PASSWORD)

      expect(store.isUnlocked).toBe(true)
      expect(store.getValue('11111111-1111-1111-1111-111111111111')).toBe('plaintext-value')
    })
  })
})
