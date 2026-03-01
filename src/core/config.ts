import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { z, ZodError } from 'zod'
import { createErrorMap, createMessageBuilder, NonEmptyArray } from 'zod-validation-error'

// Resolve config directory from TKC_HOME env var, defaulting to ~/.2kc
export const CONFIG_DIR = resolve(process.env.TKC_HOME ?? join(homedir(), '.2kc'))

export const CONFIG_PATH = join(CONFIG_DIR, 'config.json')
const DEFAULT_STORE_PATH = join(CONFIG_DIR, 'secrets.enc.json')

export function resolveTilde(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return resolve(homedir(), p.slice(2))
  }
  return p
}

const messageBuilderInner = createMessageBuilder({
  includePath: true, // Includes the field path in the message
  prefix: ' - ',
  prefixSeparator: '', // No separator between prefix and message
  issueSeparator: '\n - ', // Separates multiple issues with a newline
})

const messageBuilder = (issues: ZodError['issues']): string => {
  if (issues.length === 0) {
    return ''
  }

  // weird typescript hack to ensure issues is a NonEmptyArray
  return messageBuilderInner(issues as NonEmptyArray<ZodError['issues'][number]>)
}

z.config({
  customError: createErrorMap({
    // includePath: true, // This option automatically adds the path
    // delimiter: { path: ' -> ' } // Optional: customize the path delimiter
  }),
})

const zNonEmptyString = () => z.string().min(1, 'Expected non-empty string')
const zPortNumber = () =>
  z
    .number()
    .int()
    .min(1, 'Expected port number between 1 and 65535')
    .max(65535, 'Expected port number between 1 and 65535')

// Discord config schema
const DiscordConfigSchema = z.object({
  botToken: zNonEmptyString(),
  channelId: zNonEmptyString(),
  authorizedUserIds: z.array(zNonEmptyString()).optional(),
})

// Server config schema
const ServerConfigSchema = z.object({
  host: zNonEmptyString().default('127.0.0.1'),
  port: zPortNumber().default(2274),
  authToken: zNonEmptyString().optional(),
  sessionTtlMs: z.number().min(1000, 'Expected session TTL to be at least 1000 ms').optional(),
  pollIntervalMs: z
    .number()
    .min(1000, 'Expected poll interval to be at least 1000 ms')
    .default(3000), // set higher to avoid rate limiting issues with Discord bot
})

// Store config schema
const StoreConfigSchema = z
  .object({
    path: zNonEmptyString().optional(),
  })
  .transform((val) => ({
    path: val.path ? resolveTilde(val.path) : DEFAULT_STORE_PATH,
  }))

// Unlock config schema
const UnlockConfigSchema = z.object({
  ttlMs: z.number().positive().default(900_000),
  idleTtlMs: z.number().positive().optional(),
  maxGrantsBeforeRelock: z.number().int().positive().optional(),
})

// Main app config schema
const AppConfigSchema = z.object({
  mode: z.enum(['standalone', 'client']).default('standalone'),
  server: ServerConfigSchema.prefault({}),
  store: StoreConfigSchema.prefault({}),
  unlock: UnlockConfigSchema.prefault({}),
  discord: DiscordConfigSchema.optional(),
  requireApproval: z.record(z.string(), z.boolean()).default({}),
  defaultRequireApproval: z.boolean().default(false),
  approvalTimeoutMs: z.number().positive().default(300_000),
  bindCommand: z.boolean().default(false),
})

// Inferred types from schemas
export type DiscordConfig = z.infer<typeof DiscordConfigSchema>
export type ServerConfig = z.output<typeof ServerConfigSchema>
export type StoreConfig = z.output<typeof StoreConfigSchema>
export type UnlockConfig = z.output<typeof UnlockConfigSchema>
export type AppConfig = z.output<typeof AppConfigSchema>

export function defaultConfig(): AppConfig {
  return AppConfigSchema.parse({})
}

export function parseConfig(raw: unknown): AppConfig {
  return AppConfigSchema.parse(raw ?? {})
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

const configCache: Record<string, AppConfig> = {}

export function getConfig(configPath: string = CONFIG_PATH): AppConfig {
  if (configCache[configPath]) {
    return configCache[configPath]
  }
  try {
    configCache[configPath] = loadConfig(configPath)
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      console.error(`Error loading config:`)
      console.error(messageBuilder(err.issues))
    } else {
      console.error(`Error loading config: ${String(err)}`)
    }
    process.exit(1)
  }
  return configCache[configPath]
}
