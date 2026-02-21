#!/usr/bin/env node
import { Command } from 'commander'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { configCommand } from './config.js'
import { requestCommand } from './request.js'
import { secretsCommand } from './secrets.js'

const pkg = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf-8'),
) as { version: string }

const program = new Command()

program
  .name('2kc')
  .description('A local secret broker with controlled access and approval flows')
  .version(pkg.version)

program.addCommand(secretsCommand)
program.addCommand(configCommand)
program.addCommand(requestCommand)

program.parse()
