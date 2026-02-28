import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { homedir } from 'node:os'

// Resolve config directory from TKC_HOME env var, defaulting to ~/.2kc
export const CONFIG_DIR = resolve(process.env.TKC_HOME ?? join(homedir(), '.2kc'))

export interface DiscordConfig {
  botToken: string
  channelId: string
  authorizedUserIds?: string[]
}

export interface ServerConfig {
  host: string
  port: number
  authToken?: string
  sessionTtlMs?: number
}

export interface StoreConfig {
  path: string
}

export interface UnlockConfig {
  ttlMs: number
  idleTtlMs?: number
  maxGrantsBeforeRelock?: number
}

export interface AppConfig {
  mode: 'standalone' | 'client'
  server: ServerConfig
  store: StoreConfig
  unlock: UnlockConfig
  discord?: DiscordConfig
  requireApproval: Record<string, boolean>
  defaultRequireApproval: boolean
  approvalTimeoutMs: number
  bindCommand: boolean
}

export const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

export function resolveTilde(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return resolve(homedir(), p.slice(2))
  }
  return p
}

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

function parseDiscordConfig(raw: unknown): DiscordConfig | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isRecord(raw)) {
    throw new Error('discord must be an object')
  }

  const channelId = raw.channelId
  if (typeof channelId !== 'string' || channelId === '') {
    throw new Error('discord.channelId must be a non-empty string')
  }

  const botToken = raw.botToken
  if (typeof botToken !== 'string' || botToken === '') {
    throw new Error('discord.botToken must be a non-empty string')
  }

  const result: DiscordConfig = { botToken, channelId }

  if (raw.authorizedUserIds !== undefined) {
    if (!Array.isArray(raw.authorizedUserIds)) {
      throw new Error('discord.authorizedUserIds must be an array')
    }
    for (const id of raw.authorizedUserIds) {
      if (typeof id !== 'string' || id === '') {
        throw new Error('discord.authorizedUserIds must contain non-empty strings')
      }
    }
    result.authorizedUserIds = raw.authorizedUserIds as string[]
  }

  return result
}

function parseServerConfig(raw: unknown): ServerConfig {
  const defaults: ServerConfig = { host: '127.0.0.1', port: 2274 }
  if (raw === undefined || raw === null) return defaults
  if (!isRecord(raw)) {
    throw new Error('server must be an object')
  }

  const host = raw.host !== undefined ? raw.host : defaults.host
  if (typeof host !== 'string' || host === '') {
    throw new Error('server.host must be a non-empty string')
  }

  const port = raw.port !== undefined ? raw.port : defaults.port
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('server.port must be an integer between 1 and 65535')
  }

  const result: ServerConfig = { host, port }

  if (raw.authToken !== undefined) {
    if (typeof raw.authToken !== 'string' || raw.authToken === '') {
      throw new Error('server.authToken must be a non-empty string when provided')
    }
    result.authToken = raw.authToken
  }

  if (raw.sessionTtlMs !== undefined) {
    if (typeof raw.sessionTtlMs !== 'number' || raw.sessionTtlMs < 1000) {
      throw new Error('server.sessionTtlMs must be at least 1000ms')
    }
    result.sessionTtlMs = raw.sessionTtlMs
  }

  return result
}

function parseStoreConfig(raw: unknown): StoreConfig {
  const defaultPath = join(CONFIG_DIR, 'secrets.enc.json')
  if (raw === undefined || raw === null) return { path: defaultPath }
  if (!isRecord(raw)) {
    throw new Error('store must be an object')
  }

  const path = raw.path !== undefined ? raw.path : defaultPath
  if (typeof path !== 'string' || path === '') {
    throw new Error('store.path must be a non-empty string')
  }

  return { path: resolveTilde(path) }
}

function parseUnlockConfig(raw: unknown): UnlockConfig {
  const defaults: UnlockConfig = { ttlMs: 900_000 }
  if (raw === undefined || raw === null) return defaults
  if (!isRecord(raw)) {
    throw new Error('unlock must be an object')
  }

  const ttlMs = raw.ttlMs !== undefined ? raw.ttlMs : defaults.ttlMs
  if (typeof ttlMs !== 'number' || ttlMs <= 0) {
    throw new Error('unlock.ttlMs must be a positive number')
  }

  const result: UnlockConfig = { ttlMs }

  if (raw.idleTtlMs !== undefined) {
    if (typeof raw.idleTtlMs !== 'number' || raw.idleTtlMs <= 0) {
      throw new Error('unlock.idleTtlMs must be a positive number')
    }
    result.idleTtlMs = raw.idleTtlMs
  }

  if (raw.maxGrantsBeforeRelock !== undefined) {
    if (
      typeof raw.maxGrantsBeforeRelock !== 'number' ||
      !Number.isInteger(raw.maxGrantsBeforeRelock) ||
      raw.maxGrantsBeforeRelock <= 0
    ) {
      throw new Error('unlock.maxGrantsBeforeRelock must be a positive integer')
    }
    result.maxGrantsBeforeRelock = raw.maxGrantsBeforeRelock
  }

  return result
}

export function defaultConfig(): AppConfig {
  return {
    mode: 'standalone',
    server: { host: '127.0.0.1', port: 2274 },
    store: { path: join(CONFIG_DIR, 'secrets.enc.json') },
    unlock: { ttlMs: 900_000 },
    discord: undefined,
    requireApproval: {},
    defaultRequireApproval: false,
    approvalTimeoutMs: 300_000,
    bindCommand: false,
  }
}

export function parseConfig(raw: unknown): AppConfig {
  if (!isRecord(raw)) {
    throw new Error('Config must be a JSON object')
  }

  // Parse mode
  const mode = raw.mode !== undefined ? raw.mode : 'standalone'
  if (mode !== 'standalone' && mode !== 'client') {
    throw new Error('mode must be "standalone" or "client"')
  }

  return {
    mode,
    server: parseServerConfig(raw.server),
    store: parseStoreConfig(raw.store),
    unlock: parseUnlockConfig(raw.unlock),
    discord: parseDiscordConfig(raw.discord),
    requireApproval: parseRequireApproval(raw.requireApproval),
    defaultRequireApproval:
      typeof raw.defaultRequireApproval === 'boolean' ? raw.defaultRequireApproval : false,
    approvalTimeoutMs:
      typeof raw.approvalTimeoutMs === 'number' && raw.approvalTimeoutMs > 0
        ? raw.approvalTimeoutMs
        : 300_000,
    bindCommand: typeof raw.bindCommand === 'boolean' ? raw.bindCommand : false,
  }
}

export function loadConfig(configPath: string = CONFIG_PATH): AppConfig {
  let raw: string
  try {
    raw = readFileSync(configPath, 'utf-8')
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultConfig()
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

export function saveConfig(config: AppConfig, configPath: string = CONFIG_PATH): void {
  const dir = dirname(configPath)
  mkdirSync(dir, { recursive: true })
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  chmodSync(configPath, 0o600)
}

let cachedConfig: AppConfig | null = null
let cachedConfigPath: string | null = null

export function getConfig(configPath: string = CONFIG_PATH): AppConfig {
  if (cachedConfig !== null && cachedConfigPath === configPath) {
    return cachedConfig
  }
  cachedConfig = loadConfig(configPath)
  cachedConfigPath = configPath
  return cachedConfig
}

export function clearConfigCache(): void {
  cachedConfig = null
  cachedConfigPath = null
}
