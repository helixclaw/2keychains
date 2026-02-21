import { Command } from 'commander'

import { loadConfig } from '../core/config.js'
import { SecretStore } from '../core/secret-store.js'
import { DiscordChannel } from '../channels/discord.js'
import { WorkflowEngine } from '../core/workflow.js'
import { GrantManager } from '../core/grant.js'
import { SecretInjector } from '../core/injector.js'
import { createAccessRequest } from '../core/request.js'
import type { NotificationChannel } from '../channels/channel.js'

async function auditLog(channel: NotificationChannel, message: string): Promise<void> {
  try {
    await channel.sendNotification(message)
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[audit] Warning: failed to send audit log: ${errorMessage}`)
  }
}

function formatAuditMessage(requestId: string, event: string, details: string): string {
  return `[2kc] [${new Date().toISOString()}] [${requestId}] ${event}: ${details}`
}

const request = new Command('request')
  .description('Request access to a secret and inject into a command')
  .argument('<uuid>', 'UUID of the secret to access')
  .requiredOption('--reason <reason>', 'Justification for access')
  .requiredOption('--task <taskRef>', 'Task reference (e.g., ticket ID)')
  .option('--duration <seconds>', 'Grant duration in seconds', '300')
  .requiredOption('--env <varName>', 'Environment variable name for injection')
  .requiredOption('--cmd <command>', 'Command to run with secret injected')
  .action(
    async (
      uuid: string,
      opts: {
        reason: string
        task: string
        duration: string
        env: string
        cmd: string
      },
    ) => {
      try {
        // 1. Load config
        let config
        try {
          config = loadConfig()
        } catch (err: unknown) {
          if (err instanceof Error && err.message.includes('Config file not found')) {
            console.error('Config not found. Run: 2kc config init')
            process.exitCode = 1
            return
          }
          throw err
        }

        // 2. Instantiate components
        const store = new SecretStore()
        const channel = new DiscordChannel(config.discord)
        const grantManager = new GrantManager()
        const injector = new SecretInjector(grantManager, store)

        // 3. Create access request
        const durationSeconds = parseInt(opts.duration, 10)
        if (Number.isNaN(durationSeconds) || durationSeconds <= 0) {
          console.error('Invalid --duration: must be a positive integer (seconds)')
          process.exitCode = 1
          return
        }

        const accessRequest = createAccessRequest(uuid, opts.reason, opts.task, durationSeconds)
        await auditLog(
          channel,
          formatAuditMessage(
            accessRequest.id,
            'Request created',
            `uuid=${uuid}, reason="${opts.reason}", task="${opts.task}", duration=${opts.duration}s`,
          ),
        )

        // 4. Process approval workflow
        const engine = new WorkflowEngine({ store, channel, config })
        const result = await engine.processRequest(accessRequest)
        await auditLog(
          channel,
          formatAuditMessage(
            accessRequest.id,
            `Approval ${result}`,
            `uuid=${uuid}, result=${result}`,
          ),
        )

        if (result !== 'approved') {
          console.error(`Access request ${result}: ${uuid}`)
          process.exitCode = 1
          return
        }

        // 5. Create grant
        const grant = grantManager.createGrant(accessRequest)

        // 6. Inject secret and run command
        const command = ['sh', '-c', opts.cmd]
        await auditLog(
          channel,
          formatAuditMessage(
            accessRequest.id,
            'Secret injected',
            `uuid=${uuid}, env=${opts.env}, command="${opts.cmd}"`,
          ),
        )

        const processResult = await injector.inject(grant.id, opts.env, command)

        await auditLog(
          channel,
          formatAuditMessage(accessRequest.id, 'Grant used', `grantId=${grant.id}, uuid=${uuid}`),
        )

        // 7. Output result
        if (processResult.stdout) process.stdout.write(processResult.stdout)
        if (processResult.stderr) process.stderr.write(processResult.stderr)
        // Map null exit code (signal-killed processes) to exit code 1 intentionally,
        // so the CLI always reports a non-zero exit when the child did not exit cleanly.
        process.exitCode = processResult.exitCode ?? 1
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)

        if (message.includes('not found')) {
          console.error(`Secret UUID not found: ${uuid}`)
        } else if (message.includes('Grant is not valid')) {
          console.error(`Grant expired: ${uuid}`)
        } else {
          console.error(`Error: ${message}`)
        }

        process.exitCode = 1
      }
    },
  )

export { request as requestCommand }
