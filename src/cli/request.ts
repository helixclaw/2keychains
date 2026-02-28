import { Command } from 'commander'

import { loadConfig } from '../core/config.js'
import { resolveService } from '../core/service.js'

const request = new Command('request')
  .description('Request access to one or more secrets and inject into a command')
  .argument('<ref...>', 'Secret refs or UUIDs to access')
  .requiredOption('--reason <reason>', 'Justification for access')
  .requiredOption('--task <taskRef>', 'Task reference (e.g., ticket ID)')
  .option('--duration <seconds>', 'Grant duration in seconds', '300')
  .option('--env <varName>', 'Environment variable name for injection')
  .requiredOption('--cmd <command>', 'Command to run with secret injected')
  .action(
    async (
      refs: string[],
      opts: {
        reason: string
        task: string
        duration: string
        env?: string
        cmd: string
      },
    ) => {
      try {
        // 1. Load config and resolve service
        const config = loadConfig()
        const service = await resolveService(config)

        // 2. Parse and validate duration
        const durationSeconds = parseInt(opts.duration, 10)
        if (Number.isNaN(durationSeconds) || durationSeconds <= 0) {
          console.error('Invalid --duration: must be a positive integer (seconds)')
          process.exitCode = 1
          return
        }

        // 3. Resolve refs to UUIDs
        const uuids: string[] = []
        for (const ref of refs) {
          try {
            const metadata = await service.secrets.resolve(ref)
            uuids.push(metadata.uuid)
          } catch {
            console.error(`Failed to resolve secret: ${ref}`)
            process.exitCode = 1
            return
          }
        }

        // 4. Create access request via service
        const accessRequest = await service.requests.create(
          uuids,
          opts.reason,
          opts.task,
          durationSeconds,
          opts.cmd,
        )

        // 5. Poll for grant status
        const pollIntervalMs = config.server.pollIntervalMs
        const maxWaitMs = 5 * 60 * 1000 // 5 minutes
        const deadline = Date.now() + maxWaitMs
        let grantResult!: Awaited<ReturnType<typeof service.grants.getStatus>>
        while (true) {
          grantResult = await service.grants.getStatus(accessRequest.id)
          if (grantResult.status !== 'pending') break
          if (Date.now() > deadline) {
            console.error(`Timed out waiting for approval: ${refs.join(', ')}`)
            process.exitCode = 1
            return
          }
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
        }
        if (grantResult.status !== 'approved') {
          console.error(`Access request denied: ${refs.join(', ')}`)
          process.exitCode = 1
          return
        }

        // 6. Inject secret and run command
        const processResult = await service.inject(
          accessRequest.id,
          opts.cmd,
          opts.env ? { envVarName: opts.env } : undefined,
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
          console.error(`Secret not found: ${refs.join(', ')}`)
        } else if (message.includes('Grant is not valid')) {
          console.error(`Grant expired: ${refs.join(', ')}`)
        } else {
          console.error(`Error: ${message}`)
        }

        process.exitCode = 1
      }
    },
  )

export { request as requestCommand }
