import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { migrateStore, initStore } from '../cli/store.js'
import { EncryptedSecretStore } from '../core/encrypted-store.js'
import type { SecretsFile } from '../core/types.js'

// Low-cost scrypt params for fast tests
const TEST_PARAMS = { N: 1024, r: 8, p: 1 }
const PASSWORD = 'migration-test-password'

describe('migrateStore', () => {
  let dir: string
  let plaintextPath: string
  let encryptedPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), '2kc-migrate-test-'))
    plaintextPath = join(dir, 'secrets.json')
    encryptedPath = join(dir, 'secrets.enc.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function writePlaintext(secrets: SecretsFile['secrets']): void {
    writeFileSync(plaintextPath, JSON.stringify({ secrets }), 'utf-8')
  }

  it('encrypts plaintext secrets; decrypting yields original values', async () => {
    writePlaintext([
      {
        uuid: 'abc-123',
        ref: 'my-ref',
        value: 'original-value',
        tags: ['prod'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])

    await migrateStore(plaintextPath, encryptedPath, PASSWORD, { params: TEST_PARAMS })

    const store = new EncryptedSecretStore(encryptedPath)
    await store.unlock(PASSWORD)
    expect(store.getValueByRef('my-ref')).toBe('original-value')
  })

  it('renames plaintext to .bak and removes original', async () => {
    writePlaintext([])

    await migrateStore(plaintextPath, encryptedPath, PASSWORD, { params: TEST_PARAMS })

    expect(existsSync(plaintextPath)).toBe(false)
    expect(existsSync(plaintextPath + '.bak')).toBe(true)
  })

  it('returns count of migrated secrets', async () => {
    writePlaintext([
      {
        uuid: 'uuid-1',
        ref: 'secret-one',
        value: 'value-one',
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        uuid: 'uuid-2',
        ref: 'secret-two',
        value: 'value-two',
        tags: ['tag-a'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])

    const count = await migrateStore(plaintextPath, encryptedPath, PASSWORD, {
      params: TEST_PARAMS,
    })

    expect(count).toBe(2)
  })

  it('throws if plaintext store does not exist', async () => {
    await expect(
      migrateStore(join(dir, 'nonexistent.json'), encryptedPath, PASSWORD, {
        params: TEST_PARAMS,
      }),
    ).rejects.toThrow()
  })

  it('throws if encrypted store already exists (no --force)', async () => {
    writePlaintext([])
    // Pre-create the encrypted store
    await new EncryptedSecretStore(encryptedPath).initialize(PASSWORD, TEST_PARAMS)

    // Re-create plaintext so migrateStore has something to read
    writePlaintext([])

    await expect(
      migrateStore(plaintextPath, encryptedPath, PASSWORD, { params: TEST_PARAMS }),
    ).rejects.toThrow()
  })

  it('overwrites encrypted store with --force', async () => {
    writePlaintext([
      {
        uuid: 'force-uuid',
        ref: 'force-ref',
        value: 'force-value',
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    // Pre-create the encrypted store
    await new EncryptedSecretStore(encryptedPath).initialize(PASSWORD, TEST_PARAMS)

    // Restore plaintext (was not renamed since migrateStore wasn't called yet)
    writePlaintext([
      {
        uuid: 'force-uuid',
        ref: 'force-ref',
        value: 'force-value',
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])

    const count = await migrateStore(plaintextPath, encryptedPath, PASSWORD, {
      force: true,
      params: TEST_PARAMS,
    })

    expect(count).toBe(1)
    const store = new EncryptedSecretStore(encryptedPath)
    await store.unlock(PASSWORD)
    expect(store.getValueByRef('force-ref')).toBe('force-value')
  })

  it('succeeds with empty plaintext store (0 secrets)', async () => {
    writePlaintext([])

    const count = await migrateStore(plaintextPath, encryptedPath, PASSWORD, {
      params: TEST_PARAMS,
    })

    expect(count).toBe(0)
    const store = new EncryptedSecretStore(encryptedPath)
    await store.unlock(PASSWORD)
    expect(store.list()).toHaveLength(0)
  })

  it('preserves tags after migration', async () => {
    writePlaintext([
      {
        uuid: 'tag-uuid',
        ref: 'tagged-secret',
        value: 'tagged-value',
        tags: ['env:prod', 'team:backend'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])

    await migrateStore(plaintextPath, encryptedPath, PASSWORD, { params: TEST_PARAMS })

    const store = new EncryptedSecretStore(encryptedPath)
    await store.unlock(PASSWORD)
    const meta = store.getByRef('tagged-secret')
    expect(meta.tags).toEqual(['env:prod', 'team:backend'])
  })
})

describe('initStore', () => {
  let dir: string
  let encryptedPath: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), '2kc-init-test-'))
    encryptedPath = join(dir, 'secrets.enc.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates an encrypted store that can be unlocked', async () => {
    await initStore(encryptedPath, PASSWORD, { params: TEST_PARAMS })

    const store = new EncryptedSecretStore(encryptedPath)
    await store.unlock(PASSWORD)
    expect(store.isUnlocked).toBe(true)
    expect(store.list()).toHaveLength(0)
  })

  it('throws if encrypted store already exists (no --force)', async () => {
    await initStore(encryptedPath, PASSWORD, { params: TEST_PARAMS })

    await expect(initStore(encryptedPath, PASSWORD, { params: TEST_PARAMS })).rejects.toThrow()
  })

  it('overwrites with --force', async () => {
    await initStore(encryptedPath, PASSWORD, { params: TEST_PARAMS })

    await expect(
      initStore(encryptedPath, 'new-password', { force: true, params: TEST_PARAMS }),
    ).resolves.not.toThrow()

    // Verify the new password works
    const store = new EncryptedSecretStore(encryptedPath)
    await store.unlock('new-password')
    expect(store.isUnlocked).toBe(true)
  })
})
