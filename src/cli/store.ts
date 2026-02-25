import { Command } from 'commander'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, renameSync } from 'node:fs'

import type { ScryptParams } from '../core/kdf.js'
import type { SecretsFile } from '../core/types.js'
import { loadConfig, saveConfig } from '../core/config.js'
import { EncryptedSecretStore } from '../core/encrypted-store.js'

// --- Exported helpers (for unit testing) ---

class MutedWritable extends Writable {
  override _write(_chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    callback()
  }
}

export async function promptNewPassword(): Promise<string> {
  const muted = new MutedWritable()
  const rl = createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
  })
  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => {
      process.stderr.write(prompt)
      rl.question('', resolve)
    })

  try {
    const first = await question('Enter new password: ')
    process.stderr.write('\n')
    const second = await question('Confirm password: ')
    process.stderr.write('\n')
    const ba = Buffer.from(first)
    const bb = Buffer.from(second)
    if (ba.length !== bb.length || !timingSafeEqual(ba, bb)) {
      throw new Error('Passwords do not match')
    }
    return first
  } finally {
    rl.close()
  }
}

export async function initStore(
  encryptedPath: string,
  password: string,
  opts: { force?: boolean; params?: ScryptParams } = {},
): Promise<void> {
  if (existsSync(encryptedPath)) {
    if (!opts.force) {
      throw new Error(
        `Encrypted store already exists at ${encryptedPath}. Use --force to overwrite.`,
      )
    }
    unlinkSync(encryptedPath)
  }
  await new EncryptedSecretStore(encryptedPath).initialize(password, opts.params)
}

export async function migrateStore(
  plaintextPath: string,
  encryptedPath: string,
  password: string,
  opts: { force?: boolean; params?: ScryptParams } = {},
): Promise<number> {
  if (!existsSync(plaintextPath)) {
    throw new Error(`No plaintext store found at ${plaintextPath}`)
  }
  if (existsSync(encryptedPath)) {
    if (!opts.force) {
      throw new Error(
        `Encrypted store already exists at ${encryptedPath}. Use --force to overwrite.`,
      )
    }
    unlinkSync(encryptedPath)
  }

  const raw = JSON.parse(readFileSync(plaintextPath, 'utf-8')) as SecretsFile
  if (!Array.isArray(raw?.secrets)) {
    throw new Error('Invalid plaintext store format')
  }

  const encStore = new EncryptedSecretStore(encryptedPath)
  await encStore.initialize(password, opts.params)
  try {
    for (const entry of raw.secrets) {
      encStore.add(entry.ref, entry.value, entry.tags)
    }
  } catch (err) {
    unlinkSync(encryptedPath)
    throw err
  }

  const bakPath = plaintextPath + '.bak'
  if (existsSync(bakPath)) {
    unlinkSync(bakPath)
  }
  renameSync(plaintextPath, bakPath)
  return raw.secrets.length
}

function deriveEncryptedPath(plaintextPath: string): string {
  if (!plaintextPath.endsWith('.json')) {
    throw new Error('store.path must end in .json to derive encrypted path')
  }
  return plaintextPath.replace(/\.json$/, '.enc.json')
}

// --- CLI commands ---

const store = new Command('store').description('Manage the secret store')

store
  .command('init')
  .description('Initialize a new encrypted secret store')
  .option('--force', 'Overwrite existing encrypted store', false)
  .action(async (opts: { force: boolean }) => {
    try {
      const config = loadConfig()
      if (config.store.path.endsWith('.enc.json')) {
        throw new Error('Store is already encrypted')
      }
      const encryptedPath = deriveEncryptedPath(config.store.path)
      const password = await promptNewPassword()
      await initStore(encryptedPath, password, { force: opts.force })
      config.store.path = encryptedPath
      saveConfig(config)
      console.log(`Initialized encrypted store at ${encryptedPath}`)
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    }
  })

store
  .command('migrate')
  .description('Migrate plaintext secrets.json to encrypted secrets.enc.json')
  .option('--force', 'Overwrite existing encrypted store', false)
  .action(async (opts: { force: boolean }) => {
    try {
      const config = loadConfig()
      if (config.store.path.endsWith('.enc.json')) {
        throw new Error('Store is already encrypted')
      }
      const plaintextPath = config.store.path
      const encryptedPath = deriveEncryptedPath(plaintextPath)
      const password = await promptNewPassword()
      const count = await migrateStore(plaintextPath, encryptedPath, password, {
        force: opts.force,
      })
      config.store.path = encryptedPath
      saveConfig(config)
      console.log(`Migrated ${count} secret(s). Old store backed up to ${plaintextPath}.bak`)
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    }
  })

export { store as storeCommand }
