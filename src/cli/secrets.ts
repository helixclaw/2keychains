import { Command } from 'commander'
import { createInterface } from 'node:readline'

import { SecretStore } from '../core/secret-store.js'

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
  .requiredOption('--name <name>', 'Human-readable name')
  .option('--value <value>', 'Secret value (reads from stdin if omitted)')
  .option('--tags <tags...>', 'Tags for approval config')
  .action(async (opts: { name: string; value?: string; tags?: string[] }) => {
    const value = await resolveValue(opts.value)
    if (!value) {
      console.error('Error: secret value must not be empty')
      process.exitCode = 1
      return
    }
    const store = new SecretStore()
    const uuid = store.add(opts.name, value, opts.tags)
    console.log(uuid)
  })

secrets
  .command('list')
  .description('List all secrets (UUIDs and tags only)')
  .action(() => {
    const store = new SecretStore()
    const items = store.list()
    console.log(JSON.stringify(items, null, 2))
  })

secrets
  .command('remove')
  .description('Remove a secret by UUID')
  .argument('<uuid>', 'UUID of the secret to remove')
  .action((uuid: string) => {
    const store = new SecretStore()
    store.remove(uuid)
    console.log('Removed')
  })

export { secrets as secretsCommand }
