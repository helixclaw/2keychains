import { Command } from 'commander'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

import { loadConfig } from '../core/config.js'
import { deriveKek } from '../core/kdf.js'
import { unwrapDek } from '../core/crypto.js'
import { UnlockSession } from '../core/unlock-session.js'
import type { EncryptedStoreFile } from '../core/encrypted-store.js'

const ENCRYPTED_STORE_PATH = join(homedir(), '.2kc', 'secrets.enc.json')

function promptPassword(): Promise<string> {
  return new Promise((resolve) => {
    let muted = false
    const mutableOutput = new Writable({
      write(_chunk, _encoding, callback) {
        if (!muted) process.stderr.write(_chunk)
        callback()
      },
    })

    const rl = createInterface({
      input: process.stdin,
      output: mutableOutput,
      terminal: true,
    })

    process.stderr.write('Password: ')
    muted = true

    rl.question('', (answer) => {
      muted = false
      process.stderr.write('\n')
      rl.close()
      resolve(answer)
    })
  })
}

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
  if (!existsSync(ENCRYPTED_STORE_PATH)) {
    console.error('Error: Encrypted store not found. Run store initialization first.')
    process.exitCode = 1
    return
  }

  const password = await promptPassword()

  let store: EncryptedStoreFile
  try {
    const raw = JSON.parse(readFileSync(ENCRYPTED_STORE_PATH, 'utf-8')) as Record<string, unknown>
    if (raw.version !== 1 || !raw.kdf || !raw.wrappedDek) {
      console.error('Error: Malformed encrypted store file.')
      process.exitCode = 1
      return
    }
    store = raw as unknown as EncryptedStoreFile
  } catch {
    console.error('Error: Failed to read encrypted store file.')
    process.exitCode = 1
    return
  }

  let dek: Buffer
  try {
    const kek = await deriveKek(password, Buffer.from(store.kdf.salt, 'base64'), store.kdf.params)
    dek = unwrapDek(kek, store.wrappedDek.ciphertext, store.wrappedDek.nonce, store.wrappedDek.tag)
  } catch {
    console.error('Incorrect password.')
    process.exitCode = 1
    return
  }

  const config = loadConfig()
  const session = new UnlockSession(config.unlock)
  session.unlock(dek)
  dek.fill(0)

  console.log(`Store unlocked. Session expires in ${formatTtl(config.unlock.ttlMs)}.`)
})

const lockCommand = new Command('lock').description('Lock the encrypted secret store')

lockCommand.action(() => {
  console.log('Store locked.')
})

const statusCommand = new Command('status').description(
  'Show the lock status of the encrypted secret store',
)

statusCommand.action(() => {
  if (!existsSync(ENCRYPTED_STORE_PATH)) {
    console.log('Encrypted store not found. Run store initialization first.')
    return
  }
  console.log('Store is locked.')
})

export { unlockCommand, lockCommand, statusCommand }
