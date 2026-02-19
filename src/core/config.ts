import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface DiscordConfig {
  webhookUrl: string
  botToken: string
  channelId: string
}

export interface AppConfig {
  discord: DiscordConfig
}

export function loadConfig(): AppConfig {
  const configPath = join(homedir(), '.2kc', 'config.json')

  let raw: string
  try {
    raw = readFileSync(configPath, 'utf-8')
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Config file not found: ${configPath}`)
    }
    throw err
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Invalid JSON in config file: ${configPath}`)
  }

  const config = parsed as Record<string, unknown>
  const discord = config.discord as Record<string, unknown> | undefined

  if (
    !discord ||
    typeof discord.webhookUrl !== 'string' ||
    typeof discord.botToken !== 'string' ||
    typeof discord.channelId !== 'string'
  ) {
    throw new Error(
      'Config must include discord.webhookUrl, discord.botToken, and discord.channelId',
    )
  }

  return {
    discord: {
      webhookUrl: discord.webhookUrl,
      botToken: discord.botToken,
      channelId: discord.channelId,
    },
  }
}
