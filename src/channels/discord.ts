import type { NotificationChannel } from './channel.js'
import type { AccessRequest } from '../core/types.js'

const APPROVE_EMOJI = '\u2705'
const DENY_EMOJI = '\u274C'
const POLL_INTERVAL_MS = 2500
const DISCORD_API_BASE = 'https://discord.com/api/v10'

export interface DiscordChannelConfig {
  botToken: string
  channelId: string
  authorizedUserIds?: string[]
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    const remainingMinutes = minutes % 60
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  }
  if (minutes > 0) {
    return `${minutes}m`
  }
  return `${seconds}s`
}

export class DiscordChannel implements NotificationChannel {
  private readonly botToken: string
  private readonly channelId: string
  private readonly authorizedUserIds?: string[]
  private cachedBotUserId?: string

  constructor(config: DiscordChannelConfig) {
    this.botToken = config.botToken
    this.channelId = config.channelId
    this.authorizedUserIds = config.authorizedUserIds
  }

  async sendApprovalRequest(request: AccessRequest): Promise<string> {
    const fields: { name: string; value: string; inline?: boolean }[] = [
      { name: 'UUIDs', value: request.uuids.join(', '), inline: true },
      { name: 'Requester', value: request.requester, inline: true },
      { name: 'Secrets', value: request.secretNames.join(', '), inline: true },
      { name: 'Justification', value: request.justification },
      { name: 'Duration', value: formatDuration(request.durationMs), inline: true },
    ]

    if (request.commandHash) {
      fields.push({
        name: 'Bound Command',
        value: `\`${request.command}\`\nHash: ${request.commandHash}`,
      })
    }

    const embed = {
      title: 'Access Request',
      color: 0xffa500,
      fields,
    }

    const url = `${DISCORD_API_BASE}/channels/${this.channelId}/messages`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${this.botToken}`,
      },
      body: JSON.stringify({ embeds: [embed] }),
    })

    if (!response.ok) {
      throw new Error(`Discord API failed: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as { id: string }
    const messageId = data.id

    // Add approval reactions to the message
    await this.addReaction(messageId, APPROVE_EMOJI)
    await this.addReaction(messageId, DENY_EMOJI)

    return messageId
  }

  async waitForResponse(
    messageId: string,
    timeoutMs: number,
  ): Promise<'approved' | 'denied' | 'timeout'> {
    const deadline = Date.now() + timeoutMs

    // Approve takes precedence if both reactions are present
    while (true) {
      const approveFound = await this.checkReactions(messageId, APPROVE_EMOJI)
      if (approveFound) return 'approved'

      const denyFound = await this.checkReactions(messageId, DENY_EMOJI)
      if (denyFound) return 'denied'

      if (Date.now() >= deadline) return 'timeout'

      await this.sleep(POLL_INTERVAL_MS)
    }
  }

  async sendNotification(message: string): Promise<void> {
    const url = `${DISCORD_API_BASE}/channels/${this.channelId}/messages`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${this.botToken}`,
      },
      body: JSON.stringify({ content: message }),
    })

    if (!response.ok) {
      throw new Error(`Discord API failed: ${response.status} ${response.statusText}`)
    }
  }

  private async checkReactions(messageId: string, emoji: string): Promise<boolean> {
    const url = `${DISCORD_API_BASE}/channels/${this.channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`
    const response = await fetch(url, {
      headers: { Authorization: `Bot ${this.botToken}` },
    })

    if (!response.ok) {
      if (response.status === 404) return false
      throw new Error(`Discord reactions API failed: ${response.status} ${response.statusText}`)
    }
    const json = await response.json()
    const users = json as { id: string }[]

    // Get the bot's user ID to filter it out
    const botUserId = await this.getBotUserId()

    // Filter out the bot's own reactions
    const nonBotUsers = users.filter((user) => user.id !== botUserId)

    // If authorizedUserIds is set, only count reactions from those users
    if (this.authorizedUserIds && this.authorizedUserIds.length > 0) {
      const authorizedReactions = nonBotUsers.filter((user) =>
        this.authorizedUserIds!.includes(user.id),
      )
      return authorizedReactions.length > 0
    }

    return nonBotUsers.length > 0
  }

  private async getBotUserId(): Promise<string> {
    if (this.cachedBotUserId) {
      return this.cachedBotUserId
    }

    const url = `${DISCORD_API_BASE}/users/@me`
    const response = await fetch(url, {
      headers: { Authorization: `Bot ${this.botToken}` },
    })

    if (!response.ok) {
      throw new Error(`Discord API failed: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as { id: string }
    this.cachedBotUserId = data.id
    return data.id
  }

  private async addReaction(messageId: string, emoji: string): Promise<void> {
    const url = `${DISCORD_API_BASE}/channels/${this.channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`
    const response = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bot ${this.botToken}` },
    })

    if (!response.ok) {
      throw new Error(`Discord API failed: ${response.status} ${response.statusText}`)
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
