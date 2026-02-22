/// <reference types="vitest/globals" />

import { WorkflowEngine } from '../core/workflow.js'
import type { NotificationChannel } from '../channels/channel.js'
import type { SecretStore } from '../core/secret-store.js'
import type { SecretMetadata } from '../core/types.js'
import type { AccessRequest } from '../core/request.js'
import type { AppConfig } from '../core/config.js'

function createMockStore(metadataMap: Record<string, SecretMetadata>): SecretStore {
  return {
    getMetadata: vi.fn().mockImplementation((uuid: string) => {
      const metadata = metadataMap[uuid]
      if (!metadata) return Promise.reject(new Error(`Secret not found: ${uuid}`))
      return Promise.resolve(metadata)
    }),
  }
}

function createSingleMockStore(metadata: SecretMetadata): SecretStore {
  return {
    getMetadata: vi.fn().mockResolvedValue(metadata),
  }
}

function createMockChannel(response: 'approved' | 'denied' | 'timeout' = 'approved') {
  return {
    sendApprovalRequest: vi.fn().mockResolvedValue('msg-123'),
    waitForResponse: vi.fn().mockResolvedValue(response),
  } satisfies NotificationChannel
}

function createRequest(overrides?: Partial<AccessRequest>): AccessRequest {
  return {
    id: 'req-1',
    secretUuids: ['secret-uuid-1'],
    reason: 'Need access for deployment',
    durationSeconds: 3600,
    requestedAt: new Date(),
    status: 'pending',
    ...overrides,
  }
}

function createConfig(
  overrides?: Partial<
    Pick<AppConfig, 'requireApproval' | 'defaultRequireApproval' | 'approvalTimeoutMs'>
  >,
) {
  return {
    requireApproval: { production: true },
    defaultRequireApproval: false,
    approvalTimeoutMs: 300_000,
    ...overrides,
  }
}

describe('WorkflowEngine', () => {
  describe('processRequest', () => {
    it('sends approval request and returns approved when channel approves', async () => {
      const store = createSingleMockStore({
        uuid: 'secret-uuid-1',
        ref: 'db-password',
        tags: ['production'],
      })
      const channel = createMockChannel('approved')
      const engine = new WorkflowEngine({ store, channel, config: createConfig() })
      const request = createRequest()

      const result = await engine.processRequest(request)

      expect(result).toBe('approved')
      expect(request.status).toBe('approved')
      expect(channel.sendApprovalRequest).toHaveBeenCalledWith({
        uuids: ['secret-uuid-1'],
        requester: 'agent',
        justification: 'Need access for deployment',
        durationMs: 3_600_000,
        secretNames: ['db-password'],
      })
      expect(channel.waitForResponse).toHaveBeenCalledWith('msg-123', 300_000)
    })

    it('sends approval request and returns denied when channel denies', async () => {
      const store = createSingleMockStore({
        uuid: 'secret-uuid-1',
        ref: 'db-password',
        tags: ['production'],
      })
      const channel = createMockChannel('denied')
      const engine = new WorkflowEngine({ store, channel, config: createConfig() })
      const request = createRequest()

      const result = await engine.processRequest(request)

      expect(result).toBe('denied')
      expect(request.status).toBe('denied')
      expect(channel.sendApprovalRequest).toHaveBeenCalled()
    })

    it('sends approval request and returns timeout when channel times out', async () => {
      const store = createSingleMockStore({
        uuid: 'secret-uuid-1',
        ref: 'db-password',
        tags: ['production'],
      })
      const channel = createMockChannel('timeout')
      const engine = new WorkflowEngine({ store, channel, config: createConfig() })
      const request = createRequest()

      const result = await engine.processRequest(request)

      expect(result).toBe('timeout')
      expect(request.status).toBe('timeout')
    })

    it('auto-approves when no tags match requireApproval', async () => {
      const store = createSingleMockStore({
        uuid: 'secret-uuid-1',
        ref: 'dev-key',
        tags: ['dev'],
      })
      const channel = createMockChannel()
      const engine = new WorkflowEngine({
        store,
        channel,
        config: createConfig({ requireApproval: { production: true } }),
      })
      const request = createRequest()

      const result = await engine.processRequest(request)

      expect(result).toBe('approved')
      expect(request.status).toBe('approved')
      expect(channel.sendApprovalRequest).not.toHaveBeenCalled()
    })

    it('auto-approves untagged secret when defaultRequireApproval is false', async () => {
      const store = createSingleMockStore({
        uuid: 'secret-uuid-1',
        ref: 'misc-secret',
        tags: [],
      })
      const channel = createMockChannel()
      const engine = new WorkflowEngine({
        store,
        channel,
        config: createConfig({ defaultRequireApproval: false }),
      })
      const request = createRequest()

      const result = await engine.processRequest(request)

      expect(result).toBe('approved')
      expect(request.status).toBe('approved')
      expect(channel.sendApprovalRequest).not.toHaveBeenCalled()
    })

    it('requires approval for untagged secret when defaultRequireApproval is true', async () => {
      const store = createSingleMockStore({
        uuid: 'secret-uuid-1',
        ref: 'misc-secret',
        tags: [],
      })
      const channel = createMockChannel('approved')
      const engine = new WorkflowEngine({
        store,
        channel,
        config: createConfig({ defaultRequireApproval: true }),
      })
      const request = createRequest()

      const result = await engine.processRequest(request)

      expect(result).toBe('approved')
      expect(channel.sendApprovalRequest).toHaveBeenCalled()
    })

    it('throws when store lookup fails and sets status to denied', async () => {
      const store: SecretStore = {
        getMetadata: vi.fn().mockRejectedValue(new Error('Store unavailable')),
      }
      const channel = createMockChannel()
      const engine = new WorkflowEngine({ store, channel, config: createConfig() })
      const request = createRequest()

      await expect(engine.processRequest(request)).rejects.toThrow('Store unavailable')
      expect(request.status).toBe('denied')
    })

    it('throws when channel send fails and sets status to denied', async () => {
      const store = createSingleMockStore({
        uuid: 'secret-uuid-1',
        ref: 'db-password',
        tags: ['production'],
      })
      const channel: NotificationChannel = {
        sendApprovalRequest: vi.fn().mockRejectedValue(new Error('Channel send failed')),
        waitForResponse: vi.fn(),
      }
      const engine = new WorkflowEngine({ store, channel, config: createConfig() })
      const request = createRequest()

      await expect(engine.processRequest(request)).rejects.toThrow('Channel send failed')
      expect(request.status).toBe('denied')
    })

    it('skips approval when tag explicitly set to false even if default is true', async () => {
      const store = createSingleMockStore({
        uuid: 'secret-uuid-1',
        ref: 'dev-key',
        tags: ['dev'],
      })
      const channel = createMockChannel()
      const engine = new WorkflowEngine({
        store,
        channel,
        config: createConfig({
          requireApproval: { dev: false },
          defaultRequireApproval: true,
        }),
      })
      const request = createRequest()

      const result = await engine.processRequest(request)

      expect(result).toBe('approved')
      expect(request.status).toBe('approved')
      expect(channel.sendApprovalRequest).not.toHaveBeenCalled()
    })
  })

  describe('processRequest - batch', () => {
    it('fetches metadata for all secretUuids', async () => {
      const store = createMockStore({
        'uuid-1': { uuid: 'uuid-1', ref: 'secret-a', tags: ['dev'] },
        'uuid-2': { uuid: 'uuid-2', ref: 'secret-b', tags: ['dev'] },
      })
      const channel = createMockChannel()
      const engine = new WorkflowEngine({
        store,
        channel,
        config: createConfig({ requireApproval: {} }),
      })
      const request = createRequest({ secretUuids: ['uuid-1', 'uuid-2'] })

      await engine.processRequest(request)

      expect(store.getMetadata).toHaveBeenCalledTimes(2)
      expect(store.getMetadata).toHaveBeenCalledWith('uuid-1')
      expect(store.getMetadata).toHaveBeenCalledWith('uuid-2')
    })

    it('requires approval if ANY secret has approval-required tag', async () => {
      const store = createMockStore({
        'uuid-1': { uuid: 'uuid-1', name: 'dev-key', tags: ['dev'] },
        'uuid-2': { uuid: 'uuid-2', name: 'prod-db', tags: ['production'] },
      })
      const channel = createMockChannel('approved')
      const engine = new WorkflowEngine({
        store,
        channel,
        config: createConfig({ requireApproval: { production: true } }),
      })
      const request = createRequest({ secretUuids: ['uuid-1', 'uuid-2'] })

      const result = await engine.processRequest(request)

      expect(result).toBe('approved')
      expect(channel.sendApprovalRequest).toHaveBeenCalled()
    })

    it('auto-approves if NO secret has approval-required tag', async () => {
      const store = createMockStore({
        'uuid-1': { uuid: 'uuid-1', name: 'dev-key-1', tags: ['dev'] },
        'uuid-2': { uuid: 'uuid-2', name: 'dev-key-2', tags: ['dev'] },
      })
      const channel = createMockChannel()
      const engine = new WorkflowEngine({
        store,
        channel,
        config: createConfig({ requireApproval: { production: true } }),
      })
      const request = createRequest({ secretUuids: ['uuid-1', 'uuid-2'] })

      const result = await engine.processRequest(request)

      expect(result).toBe('approved')
      expect(channel.sendApprovalRequest).not.toHaveBeenCalled()
    })

    it('channel request includes all secret names and UUIDs', async () => {
      const store = createMockStore({
        'uuid-1': { uuid: 'uuid-1', ref: 'secret-a', tags: ['production'] },
        'uuid-2': { uuid: 'uuid-2', ref: 'secret-b', tags: ['production'] },
      })
      const channel = createMockChannel('approved')
      const engine = new WorkflowEngine({
        store,
        channel,
        config: createConfig(),
      })
      const request = createRequest({ secretUuids: ['uuid-1', 'uuid-2'] })

      await engine.processRequest(request)

      expect(channel.sendApprovalRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          uuids: ['uuid-1', 'uuid-2'],
          secretNames: ['secret-a', 'secret-b'],
        }),
      )
    })
  })
})
