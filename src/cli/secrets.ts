import { Command } from 'commander'
import { createInterface } from 'node:readline'

import { loadConfig } from '../core/config.js'
import { resolveService } from '../core/service.js'

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk: string) => {
      data += chunk
    })
    process.stdin.on('end', () => {
      resolve(data.trim())
    })
    process.stdin.on('error', reject)
  })
}

function promptForValue(): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  })
  return new Promise((resolve) => {
    rl.question('Enter secret value: ', (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

async function resolveValue(optValue?: string): Promise<string> {
  if (optValue !== undefined) {
    return optValue
  }
  if (!process.stdin.isTTY) {
    return readStdin()
  }
  return promptForValue()
}

const secrets = new Command('secrets').description('Manage secrets in the local store')

secrets
  .command('add')
  .description('Add a new secret')
  .requiredOption('--ref <ref>', 'Human-readable ref (URL-safe slug)')
  .option('--value <value>', 'Secret value (reads from stdin if omitted)')
  .option('--tags <tags...>', 'Tags for approval config')
  .action(async (opts: { ref: string; value?: string; tags?: string[] }) => {
    const value = await resolveValue(opts.value)
    if (!value) {
      console.error('Error: secret value must not be empty')
      process.exitCode = 1
      return
    }
    const service = resolveService(loadConfig())
    const result = await service.secrets.add(opts.ref, value, opts.tags)
    console.log(result.uuid)
  })

secrets
  .command('list')
  .description('List all secrets (UUIDs, refs, and tags)')
  .action(async () => {
    try {
      const service = resolveService(loadConfig())
      const items = await service.secrets.list()
      console.log(JSON.stringify(items, null, 2))
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    }
  })

secrets
  .command('remove')
  .description('Remove a secret by ref or UUID')
  .argument('<refOrUuid>', 'Ref or UUID of the secret to remove')
  .action(async (refOrUuid: string) => {
    try {
      const service = resolveService(loadConfig())
      const metadata = await service.secrets.resolve(refOrUuid)
      await service.secrets.remove(metadata.uuid)
      console.log('Removed')
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    }
  })

export { secrets as secretsCommand }
