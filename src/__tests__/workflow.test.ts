/// <reference types="vitest/globals" />

import { WorkflowEngine } from '../core/workflow.js'
import type { NotificationChannel } from '../channels/channel.js'
import type { SecretStore, SecretMetadata } from '../core/secret-store.js'
import type { AccessRequest } from '../core/request.js'
import type { AppConfig } from '../core/config.js'

function createMockStore(metadata: SecretMetadata): SecretStore {
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
    secretUuid: 'secret-uuid-1',
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
      const store = createMockStore({
        uuid: 'secret-uuid-1',
        name: 'db-password',
        tags: ['production'],
      })
      const channel = createMockChannel('approved')
      const engine = new WorkflowEngine({ store, channel, config: createConfig() })
      const request = createRequest()

      const result = await engine.processRequest(request)

      expect(result).toBe('approved')
      expect(request.status).toBe('approved')
      expect(channel.sendApprovalRequest).toHaveBeenCalledWith({
        uuid: 'secret-uuid-1',
        requester: 'agent',
        justification: 'Need access for deployment',
        durationMs: 3_600_000,
        secretName: 'db-password',
      })
      expect(channel.waitForResponse).toHaveBeenCalledWith('msg-123', 300_000)
    })

    it('sends approval request and returns denied when channel denies', async () => {
      const store = createMockStore({
        uuid: 'secret-uuid-1',
        name: 'db-password',
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
      const store = createMockStore({
        uuid: 'secret-uuid-1',
        name: 'db-password',
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
      const store = createMockStore({ uuid: 'secret-uuid-1', name: 'dev-key', tags: ['dev'] })
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
      const store = createMockStore({ uuid: 'secret-uuid-1', name: 'misc-secret', tags: [] })
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
      const store = createMockStore({ uuid: 'secret-uuid-1', name: 'misc-secret', tags: [] })
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
      const store = createMockStore({
        uuid: 'secret-uuid-1',
        name: 'db-password',
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
      const store = createMockStore({
        uuid: 'secret-uuid-1',
        name: 'dev-key',
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
})
