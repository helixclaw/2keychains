import { Command } from 'commander'

import { loadConfig } from '../core/config.js'
import { resolveService } from '../core/service.js'

const inject = new Command('inject')
  .description('Run a command with secrets injected by scanning env vars for 2k:// placeholders')
  .requiredOption('--reason <reason>', 'Justification for access')
  .requiredOption('--task <taskRef>', 'Task reference (e.g., ticket ID)')
  .option('--duration <seconds>', 'Grant duration in seconds', '300')
  .option('--vars <varList>', 'Comma-separated list of env var names to check (default: scan all)')
  .requiredOption('--cmd <command>', 'Command to run with secrets injected')
  .action(
    async (opts: {
      reason: string
      task: string
      duration: string
      vars?: string
      cmd: string
    }) => {
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

        // 3. Scan env vars for 2k:// placeholders
        const varsToCheck = opts.vars
          ? opts.vars.split(',').map((v) => v.trim())
          : Object.keys(process.env)

        const placeholders: { envVar: string; ref: string }[] = []
        for (const varName of varsToCheck) {
          const value = process.env[varName]
          if (value && value.startsWith('2k://')) {
            const ref = value.slice(5) // Remove '2k://' prefix
            placeholders.push({ envVar: varName, ref })
          }
        }

        if (placeholders.length === 0) {
          console.error(
            'No 2k:// placeholders found in environment variables' +
              (opts.vars ? ` (checked: ${opts.vars})` : ''),
          )
          process.exitCode = 1
          return
        }

        // 4. Resolve refs to UUIDs
        const uuids: string[] = []
        for (const { envVar, ref } of placeholders) {
          try {
            const metadata = await service.secrets.resolve(ref)
            uuids.push(metadata.uuid)
          } catch {
            console.error(`Failed to resolve secret ref '${ref}' from ${envVar}`)
            process.exitCode = 1
            return
          }
        }

        // 5. Create access request via service
        const accessRequest = await service.requests.create(
          uuids,
          opts.reason,
          opts.task,
          durationSeconds,
          opts.cmd,
        )

        // 6. Poll for grant status
        const pollIntervalMs = config.server.pollIntervalMs
        const maxWaitMs = 5 * 60 * 1000 // 5 minutes
        const deadline = Date.now() + maxWaitMs
        let grantResult!: Awaited<ReturnType<typeof service.grants.getStatus>>
        while (true) {
          grantResult = await service.grants.getStatus(accessRequest.id)
          if (grantResult.status !== 'pending') break
          if (Date.now() > deadline) {
            console.error(
              `Timed out waiting for approval: ${placeholders.map((p) => p.ref).join(', ')}`,
            )
            process.exitCode = 1
            return
          }
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
        }
        if (grantResult.status !== 'approved') {
          console.error(`Access request denied: ${placeholders.map((p) => p.ref).join(', ')}`)
          process.exitCode = 1
          return
        }

        // 7. Inject secrets and run command
        const processResult = await service.inject(accessRequest.id, opts.cmd)

        // 8. Output result
        if (processResult.stdout) process.stdout.write(processResult.stdout)
        if (processResult.stderr) process.stderr.write(processResult.stderr)
        // Map null exit code (signal-killed processes) to exit code 1 intentionally,
        // so the CLI always reports a non-zero exit when the child did not exit cleanly.
        process.exitCode = processResult.exitCode ?? 1
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)

        if (message.includes('not found')) {
          console.error(`Secret not found`)
        } else if (message.includes('Grant is not valid')) {
          console.error(`Grant expired`)
        } else {
          console.error(`Error: ${message}`)
        }

        process.exitCode = 1
      }
    },
  )

export { inject as injectCommand }
