import { Command } from 'commander'
import { existsSync } from 'node:fs'

import { loadConfig, getConfig } from '../core/config.js'
import { resolveService, LocalService } from '../core/service.js'
import { SessionLock } from '../core/session-lock.js'
import { promptPassword } from './password-prompt.js'

function formatTtl(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`
  }
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`
  }
  const hours = Math.round(ms / 3_600_000)
  return `${hours} hour${hours === 1 ? '' : 's'}`
}

const unlockCommand = new Command('unlock').description('Unlock the encrypted secret store')

unlockCommand.action(async () => {
  const config = loadConfig()

  if (config.mode === 'client') {
    console.error('Error: Unlock persistence is not supported in client mode.')
    process.exitCode = 1
    return
  }

  if (!existsSync(config.store.path)) {
    console.error('Error: Encrypted store not found. Run store initialization first.')
    process.exitCode = 1
    return
  }

  const password = await promptPassword()
  const service = (await resolveService(config)) as LocalService

  try {
    await service.unlock(password)
    console.log(`Store unlocked. Session expires in ${formatTtl(config.unlock.ttlMs)}.`)
  } catch {
    console.error('Incorrect password.')
    process.exitCode = 1
  }
})

const lockCommand = new Command('lock').description('Lock the encrypted secret store')

lockCommand.action(async () => {
  const config = getConfig()
  const service = (await resolveService(config)) as LocalService
  service.lock()
  console.log('Store locked.')
})

const statusCommand = new Command('status').description(
  'Show the lock status of the encrypted secret store',
)

statusCommand.action(() => {
  const config = getConfig()
  if (!existsSync(config.store.path)) {
    console.log('Encrypted store not found. Run store initialization first.')
    return
  }
  const sessionLock = new SessionLock(config.unlock)

  if (sessionLock.exists()) {
    console.log('Store is unlocked.')
  } else {
    console.log('Store is locked.')
  }
})

export { unlockCommand, lockCommand, statusCommand }
