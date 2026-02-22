/// <reference types="vitest/globals" />
import { DiscordChannel } from '../channels/discord.js'
import type { AccessRequest } from '../core/types.js'

const TEST_CONFIG = {
  webhookUrl: 'https://discord.com/api/webhooks/123/abc',
  botToken: 'test-bot-token',
  channelId: '999888777',
}

const TEST_REQUEST: AccessRequest = {
  uuids: ['req-001'],
  requester: 'alice',
  justification: 'Need access for deployment',
  durationMs: 3600000,
  secretNames: ['prod-db-password'],
}

describe('DiscordChannel', () => {
  let channel: DiscordChannel
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    channel = new DiscordChannel(TEST_CONFIG)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('sendApprovalRequest', () => {
    it('should POST embed to webhook URL with ?wait=true and return message ID', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: '123456' }),
      })

      const messageId = await channel.sendApprovalRequest(TEST_REQUEST)

      expect(messageId).toBe('123456')
      expect(fetchMock).toHaveBeenCalledOnce()

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${TEST_CONFIG.webhookUrl}?wait=true`)
      expect(options.method).toBe('POST')
      expect(options.headers).toEqual({
        'Content-Type': 'application/json',
      })

      const body = JSON.parse(options.body as string)
      expect(body.embeds).toHaveLength(1)
      expect(body.embeds[0].title).toBe('Access Request')
      expect(body.embeds[0].color).toBe(0xffa500)

      const fields = body.embeds[0].fields
      expect(fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'UUIDs', value: 'req-001' }),
          expect.objectContaining({ name: 'Requester', value: 'alice' }),
          expect.objectContaining({
            name: 'Secrets',
            value: 'prod-db-password',
          }),
          expect.objectContaining({
            name: 'Justification',
            value: 'Need access for deployment',
          }),
          expect.objectContaining({ name: 'Duration', value: '1h' }),
        ]),
      )
    })

    it('should throw on non-ok response from webhook', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      })

      await expect(channel.sendApprovalRequest(TEST_REQUEST)).rejects.toThrow(
        'Discord webhook failed: 400 Bad Request',
      )
    })
  })

  describe('waitForResponse', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should return "approved" when approve emoji reaction is found', async () => {
      // First call: check approve emoji -> found
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'user1', username: 'bob' }],
      })

      const promise = channel.waitForResponse('msg-1', 10000)
      const result = await promise

      expect(result).toBe('approved')
    })

    it('should return "denied" when deny emoji reaction is found', async () => {
      // First call: check approve emoji -> empty
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      // Second call: check deny emoji -> found
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'user2', username: 'carol' }],
      })

      const result = await channel.waitForResponse('msg-1', 10000)

      expect(result).toBe('denied')
    })

    it('should return "timeout" when no reactions within timeout window', async () => {
      // Mock all fetch calls to return empty reactions
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => [],
      })

      // Use a short timeout and advance timers in a loop to drain all pending work
      const promise = channel.waitForResponse('msg-1', 100)

      // Advance enough to exceed the timeout and all poll intervals
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(2600)
      }

      const result = await promise
      expect(result).toBe('timeout')
    })

    it('should treat 404 as no reactions and continue polling', async () => {
      // First poll: approve check returns 404 (message not found yet)
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })
      // First poll: deny check returns 404
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      // After sleep, second poll: approve found
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'user1' }],
      })

      const promise = channel.waitForResponse('msg-1', 10000)

      // Advance past the poll interval to trigger second iteration
      await vi.advanceTimersByTimeAsync(2500)

      const result = await promise
      expect(result).toBe('approved')
    })

    it('should throw on non-404 API errors', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      })

      await expect(channel.waitForResponse('msg-1', 10000)).rejects.toThrow(
        'Discord reactions API failed: 401 Unauthorized',
      )
    })
  })

  describe('sendNotification', () => {
    it('should POST text content to webhook URL', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })

      await channel.sendNotification('Request approved by bob')

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(TEST_CONFIG.webhookUrl)
      expect(options.method).toBe('POST')

      const body = JSON.parse(options.body as string)
      expect(body.content).toBe('Request approved by bob')
    })

    it('should throw on non-ok response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      await expect(channel.sendNotification('test message')).rejects.toThrow(
        'Discord webhook failed: 500 Internal Server Error',
      )
    })
  })
})
