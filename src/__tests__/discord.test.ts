/// <reference types="vitest/globals" />
import { DiscordChannel } from '../channels/discord.js'
import type { AccessRequest } from '../core/types.js'

const TEST_CONFIG = {
  botToken: 'test-bot-token',
  channelId: '999888777',
}

const BOT_USER_ID = 'bot-user-123'

const TEST_REQUEST: AccessRequest = {
  uuids: ['req-001'],
  requester: 'alice',
  justification: 'Need access for deployment',
  durationMs: 3600000,
  secretNames: ['prod-db-password'],
}

function createRequestWithDuration(durationMs: number): AccessRequest {
  return { ...TEST_REQUEST, durationMs }
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
    it('should POST embed to Bot API and add reactions, returning message ID', async () => {
      // Mock the POST to create message
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: '123456' }),
      })
      // Mock the PUT for approve emoji reaction
      fetchMock.mockResolvedValueOnce({ ok: true })
      // Mock the PUT for deny emoji reaction
      fetchMock.mockResolvedValueOnce({ ok: true })

      const messageId = await channel.sendApprovalRequest(TEST_REQUEST)

      expect(messageId).toBe('123456')
      expect(fetchMock).toHaveBeenCalledTimes(3)

      // Check the message POST
      const [postUrl, postOptions] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(postUrl).toBe(`https://discord.com/api/v10/channels/${TEST_CONFIG.channelId}/messages`)
      expect(postOptions.method).toBe('POST')
      expect(postOptions.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: `Bot ${TEST_CONFIG.botToken}`,
      })

      const body = JSON.parse(postOptions.body as string)
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

      // Check the reaction PUTs
      const [approveUrl] = fetchMock.mock.calls[1] as [string, RequestInit]
      expect(approveUrl).toBe(
        `https://discord.com/api/v10/channels/${TEST_CONFIG.channelId}/messages/123456/reactions/%E2%9C%85/@me`,
      )

      const [denyUrl] = fetchMock.mock.calls[2] as [string, RequestInit]
      expect(denyUrl).toBe(
        `https://discord.com/api/v10/channels/${TEST_CONFIG.channelId}/messages/123456/reactions/%E2%9D%8C/@me`,
      )
    })

    it('should include Bound Command field when commandHash is present', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: '789012' }),
      })
      fetchMock.mockResolvedValueOnce({ ok: true })
      fetchMock.mockResolvedValueOnce({ ok: true })

      const requestWithHash: AccessRequest = {
        ...TEST_REQUEST,
        command: 'echo hello',
        commandHash: 'abc123deadbeef',
      }

      await channel.sendApprovalRequest(requestWithHash)

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      const fields = body.embeds[0].fields
      const boundCommandField = fields.find((f: { name: string }) => f.name === 'Bound Command')
      expect(boundCommandField).toBeDefined()
      expect(boundCommandField.value).toContain('`echo hello`')
      expect(boundCommandField.value).toContain('abc123deadbeef')
    })

    it('should throw on non-ok response from Bot API', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      })

      await expect(channel.sendApprovalRequest(TEST_REQUEST)).rejects.toThrow(
        'Discord API failed: 400 Bad Request',
      )
    })

    it('should format duration as minutes only when less than an hour', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: '123456' }),
      })
      fetchMock.mockResolvedValueOnce({ ok: true })
      fetchMock.mockResolvedValueOnce({ ok: true })

      await channel.sendApprovalRequest(createRequestWithDuration(300000)) // 5 minutes

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      const durationField = body.embeds[0].fields.find(
        (f: { name: string }) => f.name === 'Duration',
      )
      expect(durationField.value).toBe('5m')
    })

    it('should format duration as seconds when less than a minute', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: '123456' }),
      })
      fetchMock.mockResolvedValueOnce({ ok: true })
      fetchMock.mockResolvedValueOnce({ ok: true })

      await channel.sendApprovalRequest(createRequestWithDuration(45000)) // 45 seconds

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      const durationField = body.embeds[0].fields.find(
        (f: { name: string }) => f.name === 'Duration',
      )
      expect(durationField.value).toBe('45s')
    })

    it('should format duration as hours and minutes when both are present', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: '123456' }),
      })
      fetchMock.mockResolvedValueOnce({ ok: true })
      fetchMock.mockResolvedValueOnce({ ok: true })

      await channel.sendApprovalRequest(createRequestWithDuration(5700000)) // 1h 35m

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      const durationField = body.embeds[0].fields.find(
        (f: { name: string }) => f.name === 'Duration',
      )
      expect(durationField.value).toBe('1h 35m')
    })
  })

  describe('waitForResponse', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should return "approved" when approve emoji reaction is found from non-bot user', async () => {
      // First call: check approve emoji -> found with bot and human user
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: BOT_USER_ID, username: 'bot' },
          { id: 'user1', username: 'bob' },
        ],
      })
      // Second call: get bot user ID
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: BOT_USER_ID }),
      })

      const promise = channel.waitForResponse('msg-1', 10000)
      const result = await promise

      expect(result).toBe('approved')
    })

    it('should ignore bot-only reactions and continue polling', async () => {
      // First poll: approve emoji has only bot reaction
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: BOT_USER_ID, username: 'bot' }],
      })
      // Get bot user ID (will be cached after first call)
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: BOT_USER_ID }),
      })
      // First poll: deny emoji has only bot reaction
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: BOT_USER_ID, username: 'bot' }],
      })

      // After sleep, second poll: approve found with human user
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: BOT_USER_ID, username: 'bot' },
          { id: 'user1', username: 'bob' },
        ],
      })

      const promise = channel.waitForResponse('msg-1', 10000)

      // Advance past the poll interval to trigger second iteration
      await vi.advanceTimersByTimeAsync(2500)

      const result = await promise
      expect(result).toBe('approved')
    })

    it('should return "denied" when deny emoji reaction is found from non-bot user', async () => {
      // First call: check approve emoji -> only bot
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: BOT_USER_ID }],
      })
      // Get bot user ID
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: BOT_USER_ID }),
      })
      // Second call: check deny emoji -> found with human
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: BOT_USER_ID }, { id: 'user2', username: 'carol' }],
      })

      const result = await channel.waitForResponse('msg-1', 10000)

      expect(result).toBe('denied')
    })

    it('should return "timeout" when no reactions within timeout window', async () => {
      // Mock bot user ID call
      fetchMock.mockImplementation(async (url: string) => {
        if (url.includes('/users/@me')) {
          return { ok: true, json: async () => ({ id: BOT_USER_ID }) }
        }
        // Return only bot reactions for reaction checks
        return { ok: true, json: async () => [{ id: BOT_USER_ID }] }
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

      // After sleep, second poll: approve found with human user
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'user1' }],
      })
      // Get bot user ID
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: BOT_USER_ID }),
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

    it('should only accept reactions from authorized users when authorizedUserIds is set', async () => {
      const channelWithAuth = new DiscordChannel({
        ...TEST_CONFIG,
        authorizedUserIds: ['authorized-user-1', 'authorized-user-2'],
      })

      // First poll: approve emoji has unauthorized user
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: BOT_USER_ID }, { id: 'unauthorized-user', username: 'stranger' }],
      })
      // Get bot user ID
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: BOT_USER_ID }),
      })
      // First poll: deny emoji has no reactions
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: BOT_USER_ID }],
      })

      // After sleep, second poll: approve has authorized user
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: BOT_USER_ID }, { id: 'authorized-user-1', username: 'admin' }],
      })

      const promise = channelWithAuth.waitForResponse('msg-1', 10000)

      // Advance past the poll interval
      await vi.advanceTimersByTimeAsync(2500)

      const result = await promise
      expect(result).toBe('approved')
    })
  })

  describe('sendNotification', () => {
    it('should POST text content to Bot API', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true })

      await channel.sendNotification('Request approved by bob')

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`https://discord.com/api/v10/channels/${TEST_CONFIG.channelId}/messages`)
      expect(options.method).toBe('POST')
      expect(options.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: `Bot ${TEST_CONFIG.botToken}`,
      })

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
        'Discord API failed: 500 Internal Server Error',
      )
    })
  })
})
