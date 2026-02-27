#!/usr/bin/env node
import { Command } from 'commander'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { configCommand } from './config.js'
import { injectCommand } from './inject.js'
import { openclawCommand } from './openclaw.js'
import { requestCommand } from './request.js'
import { secretsCommand } from './secrets.js'
import { serverCommand } from './server.js'
import { storeCommand } from './store.js'
import { unlockCommand, lockCommand, statusCommand } from './unlock.js'

const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf-8'),
) as { version: string }

const program = new Command()

program
  .name('2kc')
  .description('A local secret broker with controlled access and approval flows')
  .version(pkg.version)

program.addCommand(openclawCommand)
program.addCommand(secretsCommand)
program.addCommand(configCommand)
program.addCommand(requestCommand)
program.addCommand(injectCommand)
program.addCommand(serverCommand)
program.addCommand(storeCommand)
program.addCommand(unlockCommand)
program.addCommand(lockCommand)
program.addCommand(statusCommand)

program.parse()
