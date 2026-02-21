import { Command } from 'commander'

import { installSkill, uninstallSkill } from '../core/openclaw.js'

const openclaw = new Command('openclaw').description('Manage OpenClaw skill integration')

openclaw
  .command('install')
  .description('Install the 2keychains skill into the OpenClaw workspace (creates a symlink)')
  .action(() => {
    try {
      const result = installSkill()
      console.log(result)
    } catch (err) {
      console.error((err as Error).message)
      process.exitCode = 1
    }
  })

openclaw
  .command('uninstall')
  .description('Uninstall the 2keychains skill from the OpenClaw workspace (removes the symlink)')
  .action(() => {
    try {
      const result = uninstallSkill()
      console.log(result)
    } catch (err) {
      console.error((err as Error).message)
      process.exitCode = 1
    }
  })

export { openclaw as openclawCommand }
