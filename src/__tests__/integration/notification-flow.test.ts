import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { EncryptedSecretStore } from '../../core/encrypted-store.js'
import { WorkflowEngine } from '../../core/workflow.js'
import { createAccessRequest } from '../../core/request.js'
import type { ISecretStore } from '../../core/secret-store.js'
import { MockNotificationChannel } from '../mocks/mock-notification-channel.js'

// Low-cost scrypt params for fast tests
const TEST_PARAMS = { N: 1024, r: 8, p: 1 }
const PASSWORD = 'notification-test-pw'

describe('Notification Channel Workflow Integration', () => {
  let tmpDir: string
  let storePath: string
  let store: EncryptedSecretStore
  let mockChannel: MockNotificationChannel

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), '2kc-notification-'))
    storePath = join(tmpDir, 'secrets.enc.json')
    store = new EncryptedSecretStore(storePath)
    await store.initialize(PASSWORD, TEST_PARAMS)
    mockChannel = new MockNotificationChannel()
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function buildEngine(
    channel: MockNotificationChannel,
    config: {
      requireApproval?: Record<string, boolean>
      defaultRequireApproval?: boolean
      approvalTimeoutMs?: number
    } = {},
  ) {
    return new WorkflowEngine({
      store: store as unknown as ISecretStore,
      channel,
      config: {
        requireApproval: config.requireApproval ?? {},
        defaultRequireApproval: config.defaultRequireApproval ?? true,
        approvalTimeoutMs: config.approvalTimeoutMs ?? 30_000,
      },
    })
  }

  describe('approval request content', () => {
    it('channel receives correct UUIDs in request', async () => {
      const uuid = store.add('api-key', 'secret-value', ['prod'])
      const request = createAccessRequest([uuid], 'deploy to production', 'TASK-1', 3600)

      const engine = buildEngine(mockChannel)
      await engine.processRequest(request)

      expect(mockChannel.sentRequests).toHaveLength(1)
      expect(mockChannel.lastRequest?.uuids).toEqual([uuid])
    })

    it('channel receives correct justification/reason', async () => {
      const uuid = store.add('db-creds', 'password123', [])
      const request = createAccessRequest([uuid], 'Need database access for migration', 'TASK-2')

      const engine = buildEngine(mockChannel)
      await engine.processRequest(request)

      expect(mockChannel.lastRequest?.justification).toBe('Need database access for migration')
    })

    it('channel receives secret names (refs)', async () => {
      const uuid1 = store.add('first-secret', 'value1', [])
      const uuid2 = store.add('second-secret', 'value2', [])
      const request = createAccessRequest([uuid1, uuid2], 'batch access', 'TASK-3')

      const engine = buildEngine(mockChannel)
      await engine.processRequest(request)

      expect(mockChannel.lastRequest?.secretNames).toEqual(['first-secret', 'second-secret'])
    })

    it('channel receives duration in milliseconds', async () => {
      const uuid = store.add('short-lived', 'temp-secret', [])
      const request = createAccessRequest([uuid], 'short access', 'TASK-4', 300) // 300 seconds

      const engine = buildEngine(mockChannel)
      await engine.processRequest(request)

      expect(mockChannel.lastRequest?.durationMs).toBe(300_000) // 300 * 1000
    })

    it('channel receives commandHash when present', async () => {
      const uuid = store.add('cmd-secret', 'cmd-value', [])
      const request = createAccessRequest(
        [uuid],
        'run specific command',
        'TASK-5',
        300,
        'echo hello',
        'abc123commandhash',
      )

      const engine = buildEngine(mockChannel)
      await engine.processRequest(request)

      expect(mockChannel.lastRequest?.commandHash).toBe('abc123commandhash')
    })

    it('channel receives command when present', async () => {
      const uuid = store.add('bound-secret', 'bound-value', [])
      const request = createAccessRequest(
        [uuid],
        'run deployment',
        'TASK-6',
        300,
        'npm run deploy',
        'deployhash',
      )

      const engine = buildEngine(mockChannel)
      await engine.processRequest(request)

      expect(mockChannel.lastRequest?.command).toBe('npm run deploy')
    })
  })

  describe('denial flow', () => {
    it('request status becomes denied when channel denies', async () => {
      mockChannel.setDefaultResponse('denied')
      const uuid = store.add('denied-key', 'denied-value', [])
      const request = createAccessRequest([uuid], 'will be denied', 'TASK-D')

      const engine = buildEngine(mockChannel)
      const result = await engine.processRequest(request)

      expect(result).toBe('denied')
      expect(request.status).toBe('denied')
    })

    it('sendApprovalRequest is called before denial', async () => {
      mockChannel.setDefaultResponse('denied')
      const uuid = store.add('tracked-deny', 'track-value', [])
      const request = createAccessRequest([uuid], 'tracking denial', 'TASK-TD')

      const engine = buildEngine(mockChannel)
      await engine.processRequest(request)

      expect(mockChannel.sendApprovalRequestSpy).toHaveBeenCalled()
    })
  })

  describe('timeout handling', () => {
    it('request status becomes timeout when channel times out', async () => {
      mockChannel.setDefaultResponse('timeout')
      const uuid = store.add('timeout-key', 'timeout-value', [])
      const request = createAccessRequest([uuid], 'will timeout', 'TASK-T')

      const engine = buildEngine(mockChannel)
      const result = await engine.processRequest(request)

      expect(result).toBe('timeout')
      expect(request.status).toBe('timeout')
    })

    it('timeout with correct timeout value passed to waitForResponse', async () => {
      const customTimeout = 60_000
      const uuid = store.add('custom-timeout', 'value', [])
      const request = createAccessRequest([uuid], 'custom timeout test', 'TASK-CT')

      const engine = buildEngine(mockChannel, { approvalTimeoutMs: customTimeout })
      await engine.processRequest(request)

      expect(mockChannel.waitForResponseSpy).toHaveBeenCalledWith(expect.any(String), customTimeout)
    })
  })

  describe('tag-based approval routing', () => {
    it('triggers channel when secret has approval-required tag', async () => {
      const uuid = store.add('prod-db', 'prod-password', ['production'])
      const request = createAccessRequest([uuid], 'prod access', 'TASK-P')

      const engine = buildEngine(mockChannel, {
        requireApproval: { production: true },
        defaultRequireApproval: false,
      })
      await engine.processRequest(request)

      expect(mockChannel.sendApprovalRequestSpy).toHaveBeenCalled()
    })

    it('skips channel when secret has no approval-required tag', async () => {
      const uuid = store.add('dev-key', 'dev-value', ['dev'])
      const request = createAccessRequest([uuid], 'dev access', 'TASK-DEV')

      const engine = buildEngine(mockChannel, {
        requireApproval: { production: true },
        defaultRequireApproval: false,
      })
      const result = await engine.processRequest(request)

      expect(result).toBe('approved')
      expect(mockChannel.sendApprovalRequestSpy).not.toHaveBeenCalled()
    })

    it('triggers channel for any secret with approval-required tag in batch', async () => {
      const devUuid = store.add('dev-secret', 'dev-val', ['dev'])
      const prodUuid = store.add('prod-secret', 'prod-val', ['production'])
      const request = createAccessRequest([devUuid, prodUuid], 'mixed access', 'TASK-MIX')

      const engine = buildEngine(mockChannel, {
        requireApproval: { production: true },
        defaultRequireApproval: false,
      })
      await engine.processRequest(request)

      // Should require approval because one secret has 'production' tag
      expect(mockChannel.sendApprovalRequestSpy).toHaveBeenCalled()
    })

    it('uses defaultRequireApproval for untagged secrets', async () => {
      const uuid = store.add('untagged-secret', 'untagged-value', [])
      const request = createAccessRequest([uuid], 'untagged access', 'TASK-U')

      const engine = buildEngine(mockChannel, {
        requireApproval: {},
        defaultRequireApproval: true,
      })
      await engine.processRequest(request)

      expect(mockChannel.sendApprovalRequestSpy).toHaveBeenCalled()
    })

    it('skips approval for untagged secrets when defaultRequireApproval is false', async () => {
      const uuid = store.add('untagged-skip', 'skip-value', [])
      const request = createAccessRequest([uuid], 'skip approval', 'TASK-SKIP')

      const engine = buildEngine(mockChannel, {
        requireApproval: {},
        defaultRequireApproval: false,
      })
      const result = await engine.processRequest(request)

      expect(result).toBe('approved')
      expect(mockChannel.sendApprovalRequestSpy).not.toHaveBeenCalled()
    })

    it('explicit false tag overrides defaultRequireApproval true', async () => {
      const uuid = store.add('safe-dev', 'dev-value', ['dev'])
      const request = createAccessRequest([uuid], 'safe dev access', 'TASK-SAFE')

      const engine = buildEngine(mockChannel, {
        requireApproval: { dev: false },
        defaultRequireApproval: true,
      })
      const result = await engine.processRequest(request)

      // dev: false should skip approval even though defaultRequireApproval is true
      expect(result).toBe('approved')
      expect(mockChannel.sendApprovalRequestSpy).not.toHaveBeenCalled()
    })
  })

  describe('multiple sequential requests', () => {
    it('handles multiple sequential approval requests correctly', async () => {
      const uuid1 = store.add('seq-1', 'value-1', [])
      const uuid2 = store.add('seq-2', 'value-2', [])

      const engine = buildEngine(mockChannel)

      const request1 = createAccessRequest([uuid1], 'first request', 'TASK-SEQ1')
      const request2 = createAccessRequest([uuid2], 'second request', 'TASK-SEQ2')

      const result1 = await engine.processRequest(request1)
      const result2 = await engine.processRequest(request2)

      expect(result1).toBe('approved')
      expect(result2).toBe('approved')
      expect(mockChannel.sentRequests).toHaveLength(2)
    })

    it('queued responses are consumed in order', async () => {
      // First request approved, second denied
      mockChannel.queueResponses('approved', 'denied')

      const uuid1 = store.add('queue-1', 'value-1', [])
      const uuid2 = store.add('queue-2', 'value-2', [])

      const engine = buildEngine(mockChannel)

      const request1 = createAccessRequest([uuid1], 'first queued', 'TASK-Q1')
      const request2 = createAccessRequest([uuid2], 'second queued', 'TASK-Q2')

      const result1 = await engine.processRequest(request1)
      const result2 = await engine.processRequest(request2)

      // Queued responses are consumed in order
      expect(result1).toBe('approved')
      expect(result2).toBe('denied')
    })
  })

  describe('error handling', () => {
    it('request is denied when store lookup fails', async () => {
      const uuid = 'nonexistent-uuid'
      const request = createAccessRequest([uuid], 'bad lookup', 'TASK-ERR')

      const engine = buildEngine(mockChannel)

      await expect(engine.processRequest(request)).rejects.toThrow()
      expect(request.status).toBe('denied')
    })
  })
})
