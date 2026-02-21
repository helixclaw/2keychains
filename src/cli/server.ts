import { Command } from 'commander'
import { randomBytes } from 'node:crypto'

const token = new Command('token').description('Manage server authentication tokens')

token
  .command('generate')
  .description('Generate a random 32-byte hex token for server authentication')
  .action(() => {
    console.log(randomBytes(32).toString('hex'))
  })

export const serverCommand = new Command('server')
  .description('Server management commands')
  .addCommand(token)
