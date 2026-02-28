import { Command } from 'commander'
import { join } from 'node:path'
import { z } from 'zod'

import {
  loadConfig,
  saveConfig,
  defaultConfig,
  CONFIG_PATH,
  CONFIG_DIR,
  type AppConfig,
} from '../core/config.js'

const SERVER_PORT_ERROR_MSG = 'Invalid --server-port: must be an integer between 1 and 65535'
const APPROVAL_TIMEOUT_ERROR_MSG =
  'Invalid --approval-timeout: must be a positive integer (milliseconds)'

const ConfigInitOptionsSchema = z.object({
  mode: z.enum(['standalone', 'client'], 'Invalid --mode: must be "standalone" or "client"'),
  serverHost: z.string(),
  serverPort: z.coerce
    .number(SERVER_PORT_ERROR_MSG)
    .int(SERVER_PORT_ERROR_MSG)
    .min(1, SERVER_PORT_ERROR_MSG)
    .max(65535, SERVER_PORT_ERROR_MSG),
  serverAuthToken: z.string().optional(),
  storePath: z.string(),
  botToken: z.string().optional(),
  channelId: z.string().optional(),
  authorizedUserIds: z.string().optional(),
  defaultRequireApproval: z.boolean(),
  approvalTimeout: z.coerce
    .number(APPROVAL_TIMEOUT_ERROR_MSG)
    .int(APPROVAL_TIMEOUT_ERROR_MSG)
    .positive(APPROVAL_TIMEOUT_ERROR_MSG),
})

const config = new Command('config').description('Manage 2kc configuration')

config
  .command('init')
  .description('Create configuration file')
  .option('--mode <mode>', 'Operating mode (standalone or client)', 'standalone')
  .option('--server-host <host>', 'Server host', '127.0.0.1')
  .option('--server-port <port>', 'Server port', '2274')
  .option('--server-auth-token <token>', 'Server auth token')
  .option('--store-path <path>', 'Secret store path', join(CONFIG_DIR, 'secrets.json'))
  .option('--bot-token <token>', 'Discord bot token')
  .option('--channel-id <id>', 'Discord channel ID')
  .option('--authorized-user-ids <ids>', 'Comma-separated Discord user IDs authorized to approve')
  .option('--default-require-approval', 'Require approval by default', false)
  .option('--approval-timeout <ms>', 'Approval timeout in ms', '300000')
  .action(
    (opts: {
      mode: string
      serverHost: string
      serverPort: string
      serverAuthToken?: string
      storePath: string
      botToken?: string
      channelId?: string
      authorizedUserIds?: string
      defaultRequireApproval: boolean
      approvalTimeout: string
    }) => {
      const result = ConfigInitOptionsSchema.safeParse(opts)
      if (!result.success) {
        function formatCliError(issue: z.ZodIssue): string {
          if (issue.path[0] === 'mode') {
            return 'Invalid --mode: must be "standalone" or "client"'
          }
          return issue.message
        }

        result.error.issues.forEach((issue) => {
          console.error(formatCliError(issue))
        })
        process.exitCode = 1
        return
      }

      const validated = result.data

      const appConfig: AppConfig = {
        mode: validated.mode,
        server: {
          host: validated.serverHost,
          port: validated.serverPort,
          ...(validated.serverAuthToken !== undefined
            ? { authToken: validated.serverAuthToken }
            : {}),
        },
        store: {
          path: validated.storePath,
        },
        unlock: defaultConfig().unlock,
        discord:
          validated.botToken && validated.channelId
            ? {
                botToken: validated.botToken,
                channelId: validated.channelId,
                ...(validated.authorizedUserIds
                  ? {
                      authorizedUserIds: validated.authorizedUserIds
                        .split(',')
                        .map((id) => id.trim())
                        .filter((id) => id !== ''),
                    }
                  : {}),
              }
            : undefined,
        requireApproval: {},
        defaultRequireApproval: validated.defaultRequireApproval,
        approvalTimeoutMs: validated.approvalTimeout,
        bindCommand: false,
      }

      saveConfig(appConfig)
      console.log(`Config saved to ${CONFIG_PATH}`)
    },
  )

config
  .command('show')
  .description('Display current configuration (sensitive values redacted)')
  .action(() => {
    const appConfig = loadConfig()

    const redacted: Record<string, unknown> = {
      mode: appConfig.mode,
      server: {
        ...appConfig.server,
        ...(appConfig.server.authToken
          ? {
              authToken:
                appConfig.server.authToken.length > 4
                  ? appConfig.server.authToken.slice(0, 4) + '...'
                  : appConfig.server.authToken,
            }
          : {}),
      },
      store: appConfig.store,
      requireApproval: appConfig.requireApproval,
      defaultRequireApproval: appConfig.defaultRequireApproval,
      approvalTimeoutMs: appConfig.approvalTimeoutMs,
      bindCommand: appConfig.bindCommand,
    }

    if (appConfig.discord) {
      redacted.discord = {
        ...appConfig.discord,
        botToken:
          appConfig.discord.botToken.length > 4
            ? appConfig.discord.botToken.slice(0, 4) + '...'
            : appConfig.discord.botToken,
      }
    }

    console.log(JSON.stringify(redacted, null, 2))
  })

export { config as configCommand }
