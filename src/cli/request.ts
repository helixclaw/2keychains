import { Command } from 'commander'

import { loadConfig } from '../core/config.js'
import { resolveService } from '../core/service.js'

const request = new Command('request')
  .description('Request access to one or more secrets and inject into a command')
  .argument('<uuid...>', 'UUIDs of the secrets to access')
  .requiredOption('--reason <reason>', 'Justification for access')
  .requiredOption('--task <taskRef>', 'Task reference (e.g., ticket ID)')
  .option('--duration <seconds>', 'Grant duration in seconds', '300')
  .requiredOption('--env <varName>', 'Environment variable name for injection')
  .requiredOption('--cmd <command>', 'Command to run with secret injected')
  .action(
    async (
      uuids: string[],
      opts: {
        reason: string
        task: string
        duration: string
        env: string
        cmd: string
      },
    ) => {
      try {
        // 1. Load config and resolve service
        const config = loadConfig()
        const service = resolveService(config)

        // 2. Parse and validate duration
        const durationSeconds = parseInt(opts.duration, 10)
        if (Number.isNaN(durationSeconds) || durationSeconds <= 0) {
          console.error('Invalid --duration: must be a positive integer (seconds)')
          process.exitCode = 1
          return
        }

        // 3. Create access request via service
        const accessRequest = await service.requests.create(
          uuids,
          opts.reason,
          opts.task,
          durationSeconds,
        )

        // 4. Validate grant
        const isValid = await service.grants.validate(accessRequest.id)
        if (!isValid) {
          console.error(`Access request denied: ${uuids.join(', ')}`)
          process.exitCode = 1
          return
        }

        // 5. Inject secret and run command
        const processResult = await service.inject(accessRequest.id, opts.env, opts.cmd)

        // 6. Output result
        if (processResult.stdout) process.stdout.write(processResult.stdout)
        if (processResult.stderr) process.stderr.write(processResult.stderr)
        // Map null exit code (signal-killed processes) to exit code 1 intentionally,
        // so the CLI always reports a non-zero exit when the child did not exit cleanly.
        process.exitCode = processResult.exitCode ?? 1
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)

        if (message.includes('not found')) {
          console.error(`Secret UUID not found: ${uuids.join(', ')}`)
        } else if (message.includes('Grant is not valid')) {
          console.error(`Grant expired: ${uuids.join(', ')}`)
        } else {
          console.error(`Error: ${message}`)
        }

        process.exitCode = 1
      }
    },
  )

export { request as requestCommand }
