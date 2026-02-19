import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'

export interface DiscordConfig {
  webhookUrl: string
  botToken: string
  channelId: string
}

export interface AppConfig {
  discord: DiscordConfig
  requireApproval: Record<string, boolean>
  defaultRequireApproval: boolean
  approvalTimeoutMs: number
}

const CONFIG_PATH = resolve(homedir(), '.2kc', 'config.json')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRequireApproval(raw: unknown): Record<string, boolean> {
  if (!isRecord(raw)) return {}
  const result: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'boolean') {
      result[key] = value
    }
  }
  return result
}

export function parseConfig(raw: unknown): AppConfig {
  if (!isRecord(raw)) {
    throw new Error('Config must be a JSON object')
  }

  const discord = raw.discord
  if (!isRecord(discord)) {
    throw new Error('Config must contain a "discord" object')
  }

  const webhookUrl = discord.webhookUrl
  if (typeof webhookUrl !== 'string' || webhookUrl === '') {
    throw new Error('discord.webhookUrl must be a non-empty string')
  }

  const channelId = discord.channelId
  if (typeof channelId !== 'string' || channelId === '') {
    throw new Error('discord.channelId must be a non-empty string')
  }

  const botToken = discord.botToken
  if (typeof botToken !== 'string' || botToken === '') {
    throw new Error('discord.botToken must be a non-empty string')
  }

  return {
    discord: {
      webhookUrl,
      botToken,
      channelId,
    },
    requireApproval: parseRequireApproval(raw.requireApproval),
    defaultRequireApproval:
      typeof raw.defaultRequireApproval === 'boolean' ? raw.defaultRequireApproval : false,
    approvalTimeoutMs:
      typeof raw.approvalTimeoutMs === 'number' && raw.approvalTimeoutMs > 0
        ? raw.approvalTimeoutMs
        : 300_000,
  }
}

export function loadConfig(configPath: string = CONFIG_PATH): AppConfig {
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

  return parseConfig(parsed)
}
