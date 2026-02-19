import type { NotificationChannel } from './channel.js'
import type { AccessRequest } from '../core/types.js'

const APPROVE_EMOJI = '\u2705'
const DENY_EMOJI = '\u274C'
const POLL_INTERVAL_MS = 2500
const DISCORD_API_BASE = 'https://discord.com/api/v10'

export interface DiscordChannelConfig {
  webhookUrl: string
  botToken: string
  channelId: string
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
  private readonly webhookUrl: string
  private readonly botToken: string
  private readonly channelId: string

  constructor(config: DiscordChannelConfig) {
    this.webhookUrl = config.webhookUrl
    this.botToken = config.botToken
    this.channelId = config.channelId
  }

  async sendApprovalRequest(request: AccessRequest): Promise<string> {
    const embed = {
      title: 'Access Request',
      color: 0xffa500,
      fields: [
        { name: 'UUID', value: request.uuid, inline: true },
        { name: 'Requester', value: request.requester, inline: true },
        { name: 'Secret', value: request.secretName, inline: true },
        { name: 'Justification', value: request.justification },
        {
          name: 'Duration',
          value: formatDuration(request.durationMs),
          inline: true,
        },
      ],
    }

    const url = `${this.webhookUrl}?wait=true`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    })

    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`)
    }

    const data = (await response.json()) as { id: string }
    return data.id
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
    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    })

    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`)
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

    const users = (await response.json()) as unknown[]
    return users.length > 0
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
