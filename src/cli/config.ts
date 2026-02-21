import { Command } from 'commander'

import { loadConfig, saveConfig, CONFIG_PATH, type AppConfig } from '../core/config.js'

const config = new Command('config').description('Manage 2kc configuration')

config
  .command('init')
  .description('Create configuration file')
  .option('--mode <mode>', 'Operating mode (standalone or client)', 'standalone')
  .option('--server-host <host>', 'Server host', '127.0.0.1')
  .option('--server-port <port>', 'Server port', '2274')
  .option('--server-auth-token <token>', 'Server auth token')
  .option('--store-path <path>', 'Secret store path', '~/.2kc/secrets.json')
  .option('--webhook-url <url>', 'Discord webhook URL')
  .option('--bot-token <token>', 'Discord bot token')
  .option('--channel-id <id>', 'Discord channel ID')
  .option('--default-require-approval', 'Require approval by default', false)
  .option('--approval-timeout <ms>', 'Approval timeout in ms', '300000')
  .action(
    (opts: {
      mode: string
      serverHost: string
      serverPort: string
      serverAuthToken?: string
      storePath: string
      webhookUrl?: string
      botToken?: string
      channelId?: string
      defaultRequireApproval: boolean
      approvalTimeout: string
    }) => {
      if (opts.mode !== 'standalone' && opts.mode !== 'client') {
        console.error('Invalid --mode: must be "standalone" or "client"')
        process.exitCode = 1
        return
      }

      const port = parseInt(opts.serverPort, 10)
      if (Number.isNaN(port) || port < 1 || port > 65535) {
        console.error('Invalid --server-port: must be an integer between 1 and 65535')
        process.exitCode = 1
        return
      }

      const approvalTimeoutMs = parseInt(opts.approvalTimeout, 10)
      if (Number.isNaN(approvalTimeoutMs) || approvalTimeoutMs <= 0) {
        console.error('Invalid --approval-timeout: must be a positive integer (milliseconds)')
        process.exitCode = 1
        return
      }

      const appConfig: AppConfig = {
        mode: opts.mode,
        server: {
          host: opts.serverHost,
          port,
          ...(opts.serverAuthToken !== undefined ? { authToken: opts.serverAuthToken } : {}),
        },
        store: {
          path: opts.storePath,
        },
        discord:
          opts.webhookUrl && opts.botToken && opts.channelId
            ? {
                webhookUrl: opts.webhookUrl,
                botToken: opts.botToken,
                channelId: opts.channelId,
              }
            : undefined,
        requireApproval: {},
        defaultRequireApproval: opts.defaultRequireApproval,
        approvalTimeoutMs,
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
    }

    if (appConfig.discord) {
      redacted.discord = {
        ...appConfig.discord,
        botToken:
          appConfig.discord.botToken.length > 4
            ? appConfig.discord.botToken.slice(0, 4) + '...'
            : appConfig.discord.botToken,
        webhookUrl:
          appConfig.discord.webhookUrl.length > 20
            ? appConfig.discord.webhookUrl.slice(0, 20) + '...'
            : appConfig.discord.webhookUrl,
      }
    }

    console.log(JSON.stringify(redacted, null, 2))
  })

export { config as configCommand }
