import { Command } from 'commander'
import { createInterface } from 'node:readline'

import { loadConfig, saveConfig, CONFIG_PATH, type AppConfig } from '../core/config.js'

function promptForInput(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

async function resolveField(
  flagValue: string | undefined,
  promptQuestion: string,
  flagName: string,
): Promise<string> {
  if (flagValue !== undefined) {
    return flagValue
  }
  if (process.stdin.isTTY) {
    return promptForInput(promptQuestion)
  }
  throw new Error(`Missing required: ${flagName} (or run interactively)`)
}

const config = new Command('config').description('Manage 2kc configuration')

config
  .command('init')
  .description('Create configuration file with Discord settings')
  .option('--webhook-url <url>', 'Discord webhook URL')
  .option('--bot-token <token>', 'Discord bot token')
  .option('--channel-id <id>', 'Discord channel ID')
  .option('--default-require-approval', 'Require approval by default', false)
  .option('--approval-timeout <ms>', 'Approval timeout in ms', '300000')
  .action(
    async (opts: {
      webhookUrl?: string
      botToken?: string
      channelId?: string
      defaultRequireApproval: boolean
      approvalTimeout: string
    }) => {
      const webhookUrl = await resolveField(
        opts.webhookUrl,
        'Discord webhook URL: ',
        '--webhook-url',
      )
      const botToken = await resolveField(opts.botToken, 'Discord bot token: ', '--bot-token')
      const channelId = await resolveField(opts.channelId, 'Discord channel ID: ', '--channel-id')

      const appConfig: AppConfig = {
        discord: {
          webhookUrl,
          botToken,
          channelId,
        },
        requireApproval: {},
        defaultRequireApproval: opts.defaultRequireApproval,
        approvalTimeoutMs: parseInt(opts.approvalTimeout, 10),
      }

      if (Number.isNaN(appConfig.approvalTimeoutMs) || appConfig.approvalTimeoutMs <= 0) {
        console.error('Invalid --approval-timeout: must be a positive integer (milliseconds)')
        process.exitCode = 1
        return
      }

      saveConfig(appConfig)
      console.log(`Config saved to ${CONFIG_PATH}`)
    },
  )

config
  .command('show')
  .description('Display current configuration (sensitive values redacted)')
  .action(() => {
    let appConfig: AppConfig
    try {
      appConfig = loadConfig()
    } catch {
      console.error('No config found. Run: 2kc config init')
      process.exitCode = 1
      return
    }

    const redacted = {
      ...appConfig,
      discord: {
        ...appConfig.discord,
        botToken:
          appConfig.discord.botToken.length > 4
            ? appConfig.discord.botToken.slice(0, 4) + '...'
            : appConfig.discord.botToken,
        webhookUrl:
          appConfig.discord.webhookUrl.length > 20
            ? appConfig.discord.webhookUrl.slice(0, 20) + '...'
            : appConfig.discord.webhookUrl,
      },
    }

    console.log(JSON.stringify(redacted, null, 2))
  })

export { config as configCommand }
