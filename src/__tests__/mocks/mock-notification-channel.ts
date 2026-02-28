import { vi } from 'vitest'
import type { NotificationChannel } from '../../channels/channel.js'
import type { AccessRequest } from '../../core/types.js'

export type MockResponse = 'approved' | 'denied' | 'timeout'

export interface MockNotificationChannelOptions {
  /** Default response for all approval requests */
  defaultResponse?: MockResponse
  /** Response delay in milliseconds (simulates network latency) */
  responseDelayMs?: number
}

/**
 * A mock NotificationChannel for testing.
 *
 * Records all sent approval requests and notifications for inspection.
 * Supports configurable default responses and per-request overrides.
 */
export class MockNotificationChannel implements NotificationChannel {
  /** All approval requests sent to this channel */
  readonly sentRequests: AccessRequest[] = []
  /** All notification messages sent to this channel */
  readonly notifications: string[] = []

  private defaultResponse: MockResponse
  private responseDelayMs: number
  private messageCounter = 0
  private responseOverrides = new Map<string, MockResponse>()

  // Vitest spies for method call verification
  readonly sendApprovalRequestSpy = vi.fn<(request: AccessRequest) => Promise<string>>()
  readonly waitForResponseSpy =
    vi.fn<(messageId: string, timeoutMs: number) => Promise<MockResponse>>()
  readonly sendNotificationSpy = vi.fn<(message: string) => Promise<void>>()

  constructor(options: MockNotificationChannelOptions = {}) {
    this.defaultResponse = options.defaultResponse ?? 'approved'
    this.responseDelayMs = options.responseDelayMs ?? 0
  }

  /**
   * Set a specific response for a message ID.
   * Call this before waitForResponse to control per-request behavior.
   */
  setResponseForMessage(messageId: string, response: MockResponse): void {
    this.responseOverrides.set(messageId, response)
  }

  /**
   * Queue responses in order they will be returned.
   * Each call to waitForResponse consumes one response from the queue.
   */
  queueResponses(...responses: MockResponse[]): void {
    for (const response of responses) {
      const nextId = `msg-${this.messageCounter + this.responseOverrides.size + 1}`
      this.responseOverrides.set(nextId, response)
    }
  }

  /**
   * Change the default response for future requests.
   */
  setDefaultResponse(response: MockResponse): void {
    this.defaultResponse = response
  }

  /**
   * Get the last sent approval request (convenience method).
   */
  get lastRequest(): AccessRequest | undefined {
    return this.sentRequests[this.sentRequests.length - 1]
  }

  /**
   * Get the last sent notification message (convenience method).
   */
  get lastNotification(): string | undefined {
    return this.notifications[this.notifications.length - 1]
  }

  /**
   * Reset all recorded state for clean test isolation.
   */
  reset(): void {
    this.sentRequests.length = 0
    this.notifications.length = 0
    this.messageCounter = 0
    this.responseOverrides.clear()
    this.sendApprovalRequestSpy.mockClear()
    this.waitForResponseSpy.mockClear()
    this.sendNotificationSpy.mockClear()
  }

  // --- NotificationChannel interface implementation ---

  async sendApprovalRequest(request: AccessRequest): Promise<string> {
    this.sentRequests.push(request)
    const messageId = `msg-${++this.messageCounter}`
    this.sendApprovalRequestSpy(request)
    return messageId
  }

  async waitForResponse(messageId: string, _timeoutMs: number): Promise<MockResponse> {
    if (this.responseDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.responseDelayMs))
    }

    const override = this.responseOverrides.get(messageId)
    const response = override ?? this.defaultResponse
    this.waitForResponseSpy(messageId, _timeoutMs)
    return response
  }

  async sendNotification(message: string): Promise<void> {
    this.notifications.push(message)
    this.sendNotificationSpy(message)
  }
}

/**
 * Factory function for backward compatibility with existing tests.
 * Creates a simple mock channel with spy methods that can be used with
 * Vitest's toHaveBeenCalledWith assertions.
 */
export function createMockChannel(response: MockResponse = 'approved'): NotificationChannel {
  return {
    sendApprovalRequest: vi.fn().mockResolvedValue('msg-123'),
    waitForResponse: vi.fn().mockResolvedValue(response),
    sendNotification: vi.fn().mockResolvedValue(undefined),
  }
}
